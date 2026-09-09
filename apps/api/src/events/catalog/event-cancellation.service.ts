import { assertEventManager } from '../competition/event-competition-policy.js';
import {
  serial,
  isPrismaErrorCode,
  normaliseText,
  assertCommandKey,
} from '../shared/event-command-support.js';
import {
  transitionOrder,
  requireOrderTransition,
} from '../../orders/order-transition.js';
import {
  cancelZeroAmountActivityOrder,
  isZeroAmountConfirmedActivityOrder,
} from '../../orders/zero-amount-activity-order.js';
import {
  Inject,
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { AuthUser } from '../../common/auth/auth-user.js';
import { PrismaService } from '../../database/prisma.service.js';
import {
  AppRole,
  EventStatus,
  OrderStatus,
  PaymentStatus,
  Prisma,
  RefundStatus,
  RegistrationStatus,
} from '../../generated/prisma/client.js';
import { orderCreationCommandHash } from '../../orders/order-creation-idempotency.js';
import type { CancelEventDto } from '../events.dto.js';
import { eventCancellationResponse } from '../shared/event-responses.js';
import { ACTIVE_REFUND_STATUSES } from '../registration/event-refund-policy.js';

const EVENT_CANCELLABLE_STATUSES: readonly EventStatus[] = [
  EventStatus.DRAFT,
  EventStatus.OPEN,
  EventStatus.FULL,
];

@Injectable()
export class EventCancellationService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async cancel(eventId: string, dto: CancelEventDto, actor: AuthUser) {
    assertEventManager(actor);
    const reason = normaliseText(dto.reason);
    const idempotencyKey = normaliseText(dto.idempotencyKey);
    if (reason.length < 2) throw new BadRequestException('取消原因至少2个字符');
    assertCommandKey(idempotencyKey, '赛事取消幂等键');
    const commandHash = orderCreationCommandHash({
      kind: 'EVENT_CANCEL',
      eventId,
      reason,
      actorId: actor.sub,
    });

    const replay = async () => {
      const existing = await this.prisma.event.findUnique({
        where: { cancelIdempotencyKey: idempotencyKey },
      });
      if (!existing) return null;
      if (
        existing.id !== eventId ||
        existing.cancelledById !== actor.sub ||
        existing.cancelCommandHash !== commandHash
      ) {
        throw new ConflictException('赛事取消幂等键已用于不同命令');
      }
      return eventCancellationResponse({ event: existing, idempotent: true });
    };
    const existingReplay = await replay();
    if (existingReplay) return existingReplay;

    try {
      return await this.prisma.$transaction(
        async (tx) => {
          const current = await tx.event.findUnique({
            where: { id: eventId },
          });
          if (!current) throw new NotFoundException('赛事不存在');
          if (current.status === EventStatus.CANCELLED) {
            if (
              current.cancelIdempotencyKey === idempotencyKey &&
              current.cancelledById === actor.sub &&
              current.cancelCommandHash === commandHash
            ) {
              return eventCancellationResponse({
                event: current,
                idempotent: true,
              });
            }
            throw new ConflictException('赛事已经由另一取消命令处理');
          }
          if (!EVENT_CANCELLABLE_STATUSES.includes(current.status)) {
            throw new ConflictException(
              `赛事当前状态为 ${current.status}，不可取消`,
            );
          }
          const now = new Date();
          if (current.startsAt <= now) {
            throw new ConflictException('赛事已开赛，不能执行开赛前取消');
          }

          const teams = await tx.eventTeam.findMany({
            where: {
              eventId,
              status: {
                in: [
                  RegistrationStatus.WAITLISTED,
                  RegistrationStatus.REGISTERED,
                  RegistrationStatus.PAID,
                  RegistrationStatus.CHECKED_IN,
                ],
              },
            },
            include: { order: { include: { refunds: true } } },
            orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          });
          const refundPlans = teams.flatMap((team) => {
            const order = team.order;
            if (!order || order.paidCents <= order.refundedCents) return [];
            const activeRefunds = order.refunds.filter((refund) =>
              ACTIVE_REFUND_STATUSES.includes(refund.status),
            );
            const pending = activeRefunds.reduce(
              (sum, refund) => sum + refund.amountCents,
              0,
            );
            const amountCents = Math.max(
              0,
              order.paidCents - order.refundedCents - pending,
            );
            const originalOrderStatus =
              order.refundedCents > 0
                ? OrderStatus.PARTIALLY_REFUNDED
                : order.status === OrderStatus.REFUND_PENDING
                  ? activeRefunds[0]?.originalOrderStatus
                  : order.status;
            if (
              !originalOrderStatus ||
              ![
                OrderStatus.PAID,
                OrderStatus.CHECKED_IN,
                OrderStatus.COMPLETED,
                OrderStatus.PARTIALLY_REFUNDED,
              ].includes(originalOrderStatus as never)
            ) {
              throw new ConflictException('赛事退款缺少可恢复的原订单状态证据');
            }
            return amountCents > 0
              ? [{ team, order, amountCents, originalOrderStatus }]
              : [];
          });
          const cancelPolicySnapshot = {
            version: 1,
            decidedAt: now.toISOString(),
            eligibility: 'FULL_REMAINING_PAID_AMOUNT',
            approvalRequired: true,
            approvalRoles: [
              AppRole.FINANCE,
              AppRole.ADMIN,
              AppRole.SUPER_ADMIN,
            ],
            pendingOrders: teams.filter(
              (team) => team.order?.status === OrderStatus.PENDING,
            ).length,
            waitlistedTeams: teams.filter(
              (team) => team.status === RegistrationStatus.WAITLISTED,
            ).length,
            refundRequestCount: refundPlans.length,
            refundRequestedCents: refundPlans.reduce(
              (sum, plan) => sum + plan.amountCents,
              0,
            ),
          };
          const changed = await tx.event.updateMany({
            where: {
              id: eventId,
              status: current.status,
              startsAt: { gt: now },
            },
            data: {
              status: EventStatus.CANCELLED,
              cancelReason: reason,
              cancelPolicySnapshot,
              cancelIdempotencyKey: idempotencyKey,
              cancelCommandHash: commandHash,
              cancelledById: actor.sub,
              cancelledAt: now,
            },
          });
          if (changed.count !== 1) {
            throw new ConflictException('赛事状态已变化，请刷新后重试取消');
          }

          let cancelledPendingOrders = 0;
          let cancelledWaitlist = 0;
          for (const team of teams) {
            if (team.status === RegistrationStatus.WAITLISTED) {
              cancelledWaitlist += 1;
            }
            if (team.order?.status === OrderStatus.PENDING) {
              const cancelled = await transitionOrder(tx, 'CANCEL_UNPAID', {
                where: { id: team.order.id, status: OrderStatus.PENDING },
                data: { status: OrderStatus.CANCELLED, cancelledAt: now },
              });
              if (cancelled.count !== 1)
                throw new ConflictException('待支付订单状态已变化，请重试取消');
              cancelledPendingOrders += cancelled.count;
              await tx.payment.updateMany({
                where: {
                  orderId: team.order.id,
                  status: {
                    in: [
                      PaymentStatus.CREATED,
                      PaymentStatus.PROCESSING,
                      PaymentStatus.FAILED,
                    ],
                  },
                },
                data: { status: PaymentStatus.CLOSED },
              });
            }
            if (isZeroAmountConfirmedActivityOrder(team.order)) {
              await cancelZeroAmountActivityOrder(
                tx,
                team.order,
                actor,
                reason,
                now,
              );
            }
            await tx.eventTeam.updateMany({
              where: {
                id: team.id,
                status: team.status,
              },
              data: {
                status: RegistrationStatus.CANCELLED,
                paymentDueAt: null,
                cancellationPending: false,
                cancellationResolvedAt: team.cancelRequestedAt
                  ? (team.cancellationResolvedAt ?? now)
                  : undefined,
                cancelledAt: now,
              },
            });
          }

          const refundRequests = [];
          for (const plan of refundPlans) {
            const refundIdempotencyKey = `EVENT_CANCEL:${eventId}:${plan.order.id}`;
            const refundReason = `赛事取消：${reason}`;
            const existingRefund = await tx.refund.findUnique({
              where: { idempotencyKey: refundIdempotencyKey },
            });
            if (
              existingRefund &&
              (existingRefund.orderId !== plan.order.id ||
                existingRefund.requestedById !== actor.sub ||
                existingRefund.amountCents !== plan.amountCents ||
                existingRefund.reason !== refundReason)
            ) {
              throw new ConflictException(
                '赛事取消退款幂等键已用于不同退款命令',
              );
            }
            const refund =
              existingRefund ??
              (await tx.refund.create({
                data: {
                  refundNo: serial('RF'),
                  idempotencyKey: refundIdempotencyKey,
                  orderId: plan.order.id,
                  requestedById: actor.sub,
                  amountCents: plan.amountCents,
                  reason: refundReason,
                  status: RefundStatus.REQUESTED,
                  originalOrderStatus: plan.originalOrderStatus,
                },
              }));
            // A whole-activity cancellation can top up an existing refund request.
            // Its order is already pending review; only new review states transition.
            if (plan.order.status !== OrderStatus.REFUND_PENDING) {
              await requireOrderTransition(tx, 'REQUEST_REFUND', {
                where: {
                  id: plan.order.id,
                  status: {
                    in: [
                      OrderStatus.PAID,
                      OrderStatus.CHECKED_IN,
                      OrderStatus.COMPLETED,
                      OrderStatus.PARTIALLY_REFUNDED,
                    ],
                  },
                },
                data: { status: OrderStatus.REFUND_PENDING },
              });
            }
            await tx.auditLog.create({
              data: {
                actorId: actor.sub,
                actorRole: actor.roles[0],
                action: 'EVENT_CANCELLATION_REFUND_REQUESTED',
                objectType: 'Refund',
                objectId: refund.id,
                reason,
                newValue: {
                  eventId,
                  eventTeamId: plan.team.id,
                  orderId: plan.order.id,
                  amountCents: plan.amountCents,
                  status: RefundStatus.REQUESTED,
                  financeApprovalRequired: true,
                } as never,
              },
            });
            refundRequests.push(refund);
          }

          const event = await tx.event.findUniqueOrThrow({
            where: { id: eventId },
          });
          await tx.auditLog.create({
            data: {
              actorId: actor.sub,
              actorRole: actor.roles[0],
              action: 'EVENT_CANCELLED',
              objectType: 'Event',
              objectId: eventId,
              reason,
              oldValue: { status: current.status } as never,
              newValue: {
                status: EventStatus.CANCELLED,
                cancelPolicySnapshot,
                cancelledPendingOrders,
                cancelledWaitlist,
                refundRequestIds: refundRequests.map((refund) => refund.id),
              } as never,
            },
          });
          return eventCancellationResponse({
            event,
            cancelledPendingOrders,
            cancelledWaitlist,
            refundRequests,
          });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (isPrismaErrorCode(error, 'P2002')) {
        const concurrent = await replay();
        if (concurrent) return concurrent;
      }
      if (isPrismaErrorCode(error, 'P2034')) {
        throw new ConflictException('赛事取消发生并发冲突，请使用原命令重试');
      }
      throw error;
    }
  }
}
