import { EVENT_MANAGER_ROLES } from '../competition/event-competition-policy.js';
import {
  serial,
  isPrismaErrorCode,
  normaliseText,
  normaliseOptionalText,
  assertCommandKey,
} from '../shared/event-command-support.js';
import { eventTeamCancellationRefundKey } from './event-registration-policy.js';
import { promoteNextEventWaitlist } from './event-waitlist.js';
import { transitionOrder } from '../../orders/order-transition.js';
import {
  cancelZeroAmountActivityOrder,
  isZeroAmountConfirmedActivityOrder,
} from '../../orders/zero-amount-activity-order.js';
import {
  Inject,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { AuthUser } from '../../common/auth/auth-user.js';
import { PrismaService } from '../../database/prisma.service.js';
import {
  EventStatus,
  OrderStatus,
  PaymentStatus,
  Prisma,
  RefundStatus,
  RegistrationStatus,
} from '../../generated/prisma/client.js';
import { orderCreationCommandHash } from '../../orders/order-creation-idempotency.js';
import type { CancelEventRegistrationDto } from '../events.dto.js';
import { ACTIVE_REFUND_STATUSES } from './event-refund-policy.js';

@Injectable()
export class EventWithdrawalService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /** Withdraw one fixed-doubles registration without bypassing finance. */
  async cancelRegistration(
    eventId: string,
    dto: CancelEventRegistrationDto,
    actor: AuthUser,
  ) {
    const reason = normaliseText(dto.reason);
    const idempotencyKey = normaliseText(dto.idempotencyKey);
    if (reason.length < 2) {
      throw new BadRequestException('退出原因至少2个字符');
    }
    assertCommandKey(idempotencyKey, '参赛退出幂等键');
    const commandHashFor = (teamId: string) =>
      orderCreationCommandHash({
        kind: 'EVENT_REGISTRATION_CANCEL',
        eventId,
        teamId,
        reason,
        actorId: actor.sub,
      });
    const refundKeyFor = (teamId: string) =>
      eventTeamCancellationRefundKey(teamId, idempotencyKey);

    const replay = async () => {
      const existing = await this.prisma.eventTeam.findUnique({
        where: { cancelIdempotencyKey: idempotencyKey },
        include: {
          order: { include: { refunds: true } },
        },
      });
      if (!existing) return null;
      if (
        existing.eventId !== eventId ||
        existing.cancelledById !== actor.sub ||
        existing.cancelCommandHash !== commandHashFor(existing.id)
      ) {
        throw new ConflictException('参赛退出幂等键已用于不同命令');
      }
      const refund =
        existing.order?.refunds.find(
          (item) => item.idempotencyKey === refundKeyFor(existing.id),
        ) ?? null;
      return {
        registration: existing,
        refund,
        outcome: existing.cancellationPending
          ? 'REFUND_REQUESTED'
          : refund?.status === RefundStatus.REJECTED
            ? 'REFUND_REJECTED'
            : existing.status === RegistrationStatus.REFUNDED
              ? 'REFUNDED'
              : 'CANCELLED',
        idempotent: true,
      };
    };
    const existingReplay = await replay();
    if (existingReplay) return existingReplay;

    try {
      return await this.prisma.$transaction(
        async (tx) => {
          const event = await tx.event.findUnique({
            where: { id: eventId },
            select: { id: true, status: true, startsAt: true },
          });
          if (!event) throw new NotFoundException('赛事不存在');
          const now = new Date();
          if (
            event.status !== EventStatus.OPEN &&
            event.status !== EventStatus.FULL
          ) {
            throw new ConflictException('赛事当前状态不允许退出报名');
          }
          if (event.startsAt <= now) {
            throw new ConflictException('赛事已开赛，不能自助退出');
          }
          const isManager = actor.roles.some((role) =>
            EVENT_MANAGER_ROLES.includes(role),
          );
          const requestedTeamId = normaliseOptionalText(dto.teamId);
          const team = await tx.eventTeam.findFirst({
            where: {
              eventId,
              id: requestedTeamId,
              status: {
                in: [
                  RegistrationStatus.WAITLISTED,
                  RegistrationStatus.REGISTERED,
                  RegistrationStatus.PAID,
                ],
              },
              captainId: isManager && requestedTeamId ? undefined : actor.sub,
            },
            include: {
              order: {
                include: {
                  refunds: true,
                },
              },
            },
            orderBy: { createdAt: 'desc' },
          });
          if (!team) {
            throw new NotFoundException('没有可退出的赛事报名');
          }
          if (team.captainId !== actor.sub && !isManager) {
            throw new ForbiddenException('仅队长或赛事管理员可退出报名');
          }
          if (team.cancelIdempotencyKey) {
            if (
              team.cancelIdempotencyKey === idempotencyKey &&
              team.cancelledById === actor.sub &&
              team.cancelCommandHash === commandHashFor(team.id)
            ) {
              const refund =
                team.order?.refunds.find(
                  (item) => item.idempotencyKey === refundKeyFor(team.id),
                ) ?? null;
              return {
                registration: team,
                refund,
                outcome: team.cancellationPending
                  ? 'REFUND_REQUESTED'
                  : refund?.status === RefundStatus.REJECTED
                    ? 'REFUND_REJECTED'
                    : team.status === RegistrationStatus.REFUNDED
                      ? 'REFUNDED'
                      : 'CANCELLED',
                idempotent: true,
              };
            }
            throw new ConflictException('该报名已经提交过另一退出命令');
          }
          const commandHash = commandHashFor(team.id);
          const evidence = {
            cancelReason: reason,
            cancelIdempotencyKey: idempotencyKey,
            cancelCommandHash: commandHash,
            cancelledById: actor.sub,
            cancelRequestedAt: now,
          };

          const zeroAmountOrder =
            team.status === RegistrationStatus.PAID &&
            isZeroAmountConfirmedActivityOrder(team.order);
          if (
            team.status === RegistrationStatus.WAITLISTED ||
            team.status === RegistrationStatus.REGISTERED ||
            zeroAmountOrder
          ) {
            if (
              team.status === RegistrationStatus.REGISTERED &&
              (!team.order || team.order.status !== OrderStatus.PENDING)
            ) {
              throw new ConflictException('待支付订单状态已变化，请刷新后重试');
            }
            const changed = await tx.eventTeam.updateMany({
              where: {
                id: team.id,
                status: team.status,
                cancelIdempotencyKey: null,
              },
              data: {
                ...evidence,
                status: RegistrationStatus.CANCELLED,
                paymentDueAt: null,
                cancellationPending: false,
                cancellationResolvedAt: now,
                cancelledAt: now,
              },
            });
            if (changed.count !== 1) {
              throw new ConflictException('报名状态已变化，请使用原命令重试');
            }
            if (team.order) {
              if (zeroAmountOrder) {
                await cancelZeroAmountActivityOrder(
                  tx,
                  team.order,
                  actor,
                  reason,
                  now,
                );
              } else {
                const cancelled = await transitionOrder(tx, 'CANCEL_UNPAID', {
                  where: { id: team.order.id, status: OrderStatus.PENDING },
                  data: { status: OrderStatus.CANCELLED, cancelledAt: now },
                });
                if (cancelled.count !== 1) {
                  throw new ConflictException(
                    '待支付订单状态已变化，请刷新后重试',
                  );
                }
              }
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
            const promotion = await promoteNextEventWaitlist(
              tx,
              eventId,
              actor.sub,
              actor.roles[0],
              now,
            );
            const registration = {
              ...team,
              ...evidence,
              status: RegistrationStatus.CANCELLED,
              paymentDueAt: null,
              cancellationPending: false,
              cancellationResolvedAt: now,
              cancelledAt: now,
            };
            await tx.auditLog.create({
              data: {
                actorId: actor.sub,
                actorRole: actor.roles[0],
                action: 'EVENT_REGISTRATION_CANCELLED',
                objectType: 'EventTeam',
                objectId: team.id,
                reason,
                oldValue: { status: team.status } as never,
                newValue: {
                  status: RegistrationStatus.CANCELLED,
                  orderId: team.orderId,
                  promotedTeamIds: promotion.promotions.map(
                    (item) => item.registration.id,
                  ),
                } as never,
              },
            });
            return {
              registration,
              refund: null,
              outcome: 'CANCELLED',
              promotion,
            };
          }

          if (!team.order || team.order.status !== OrderStatus.PAID) {
            throw new ConflictException('已支付订单状态已变化，请刷新后重试');
          }
          const activeRefunds = team.order.refunds.filter((refund) =>
            ACTIVE_REFUND_STATUSES.includes(refund.status),
          );
          if (activeRefunds.length) {
            throw new ConflictException('订单已有待处理退款，不能重复申请退出');
          }
          const amountCents = team.order.paidCents - team.order.refundedCents;
          if (amountCents <= 0) {
            throw new ConflictException('订单已无可退金额');
          }
          const changed = await tx.eventTeam.updateMany({
            where: {
              id: team.id,
              status: RegistrationStatus.PAID,
              cancellationPending: false,
              cancelIdempotencyKey: null,
            },
            data: {
              ...evidence,
              cancellationPending: true,
              cancellationResolvedAt: null,
            },
          });
          if (changed.count !== 1) {
            throw new ConflictException('报名状态已变化，请使用原命令重试');
          }
          const refund = await tx.refund.create({
            data: {
              refundNo: serial('RF'),
              idempotencyKey: refundKeyFor(team.id),
              orderId: team.order.id,
              requestedById: actor.sub,
              amountCents,
              reason: `赛事报名退出：${reason}`,
              status: RefundStatus.REQUESTED,
              originalOrderStatus: team.order.status,
            },
          });
          const orderChanged = await transitionOrder(tx, 'REQUEST_REFUND', {
            where: { id: team.order.id, status: OrderStatus.PAID },
            data: { status: OrderStatus.REFUND_PENDING },
          });
          if (orderChanged.count !== 1) {
            throw new ConflictException('订单状态已变化，请使用原命令重试');
          }
          await tx.auditLog.create({
            data: {
              actorId: actor.sub,
              actorRole: actor.roles[0],
              action: 'EVENT_REGISTRATION_REFUND_REQUESTED',
              objectType: 'Refund',
              objectId: refund.id,
              reason,
              newValue: {
                eventId,
                eventTeamId: team.id,
                orderId: team.order.id,
                amountCents,
                financeApprovalRequired: true,
                seatRetainedUntilRefundSuccess: true,
              } as never,
            },
          });
          return {
            registration: {
              ...team,
              ...evidence,
              cancellationPending: true,
              cancellationResolvedAt: null,
            },
            refund,
            outcome: 'REFUND_REQUESTED',
          };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (
        isPrismaErrorCode(error, 'P2002') ||
        isPrismaErrorCode(error, 'P2034')
      ) {
        const concurrent = await replay();
        if (concurrent) return concurrent;
        throw new ConflictException('参赛退出发生并发冲突，请使用原命令重试');
      }
      throw error;
    }
  }
}
