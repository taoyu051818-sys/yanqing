import {
  transitionOrder,
  requireOrderTransition,
} from '../../orders/order-transition.js';
import {
  cancelZeroAmountActivityOrder,
  isZeroAmountConfirmedActivityOrder,
} from '../../orders/zero-amount-activity-order.js';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import type { AuthUser } from '../../common/auth/auth-user.js';
import { PrismaService } from '../../database/prisma.service.js';
import {
  AppRole,
  BookingStatus,
  GameStatus,
  OrderStatus,
  PaymentStatus,
  Prisma,
  RegistrationStatus,
  RefundStatus,
} from '../../generated/prisma/client.js';
import { type CancelGameDto } from '../games.dto.js';
import { orderCreationCommandHash } from '../../orders/order-creation-idempotency.js';
import {
  serial,
  gameCancellationResponse,
  isPrismaErrorCode,
  GAME_STATUSES_ALLOWED_TO_CANCEL,
  ACTIVE_GAME_CANCEL_REFUND_STATUSES,
} from '../shared/games-support.js';

import { assertGameOperator } from '../shared/games-policy.js';

export async function cancel(
  prisma: PrismaService,
  gameId: string,
  dto: CancelGameDto,
  actor: AuthUser,
) {
  if (
    !actor.roles.some((role) =>
      [AppRole.HOST, AppRole.ADMIN, AppRole.SUPER_ADMIN].includes(
        role as never,
      ),
    )
  ) {
    throw new ForbiddenException('仅本局主理人或管理员可取消球局');
  }
  const reason = dto.reason.trim();
  const idempotencyKey = dto.idempotencyKey.trim();
  if (reason.length < 2 || reason.length > 300) {
    throw new BadRequestException('取消原因长度必须为2-300个字符');
  }
  if (idempotencyKey.length < 8 || idempotencyKey.length > 100) {
    throw new BadRequestException('球局取消幂等键长度必须为8-100个字符');
  }
  const commandHash = orderCreationCommandHash({
    kind: 'GAME_CANCEL',
    gameId,
    reason,
    actorId: actor.sub,
  });

  const replay = async () => {
    const existing = await prisma.game.findUnique({
      where: { cancelIdempotencyKey: idempotencyKey },
    });
    if (!existing) return null;
    if (
      existing.id !== gameId ||
      existing.cancelledById !== actor.sub ||
      existing.cancelCommandHash !== commandHash
    ) {
      throw new ConflictException('球局取消幂等键已用于不同命令');
    }
    return gameCancellationResponse({ game: existing, idempotent: true });
  };
  const existingReplay = await replay();
  if (existingReplay) return existingReplay;

  try {
    return await prisma.$transaction(
      async (tx) => {
        const current = await tx.game.findUnique({ where: { id: gameId } });
        if (!current) throw new NotFoundException('球局不存在');
        assertGameOperator(current.hostId, actor);
        if (current.status === GameStatus.CANCELLED) {
          if (
            current.cancelIdempotencyKey === idempotencyKey &&
            current.cancelledById === actor.sub &&
            current.cancelCommandHash === commandHash
          ) {
            return gameCancellationResponse({
              game: current,
              idempotent: true,
            });
          }
          throw new ConflictException('球局已经由另一取消命令处理');
        }
        if (!GAME_STATUSES_ALLOWED_TO_CANCEL.includes(current.status)) {
          throw new ConflictException(
            `球局当前状态为 ${current.status}，不可取消`,
          );
        }
        const now = new Date();
        if (current.startsAt <= now) {
          throw new ConflictException('球局已开赛，不能执行开赛前取消');
        }

        const registrations = await tx.gameRegistration.findMany({
          where: {
            gameId,
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
        const refundPlans = registrations.flatMap((registration) => {
          const order = registration.order;
          if (!order || order.paidCents <= order.refundedCents) return [];
          const activeRefunds = order.refunds.filter((refund) =>
            ACTIVE_GAME_CANCEL_REFUND_STATUSES.includes(refund.status),
          );
          const activeRefundCents = activeRefunds.reduce(
            (sum, refund) => sum + refund.amountCents,
            0,
          );
          const amountCents = Math.max(
            0,
            order.paidCents - order.refundedCents - activeRefundCents,
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
            throw new ConflictException('球局退款缺少可恢复的原订单状态证据');
          }
          return amountCents > 0
            ? [{ registration, order, amountCents, originalOrderStatus }]
            : [];
        });
        const cancelPolicySnapshot = {
          version: 1,
          decidedAt: now.toISOString(),
          eligibility: 'FULL_REMAINING_PAID_AMOUNT',
          approvalRequired: true,
          approvalRoles: [AppRole.FINANCE, AppRole.ADMIN, AppRole.SUPER_ADMIN],
          actorScope: current.hostId === actor.sub ? 'HOST_OWNER' : 'ADMIN',
          registrationCount: registrations.length,
          pendingOrderCount: registrations.filter(
            (registration) =>
              registration.order?.status === OrderStatus.PENDING,
          ).length,
          waitlistCount: registrations.filter(
            (registration) =>
              registration.status === RegistrationStatus.WAITLISTED,
          ).length,
          refundRequestCount: refundPlans.length,
          refundRequestedCents: refundPlans.reduce(
            (sum, plan) => sum + plan.amountCents,
            0,
          ),
        };
        const changed = await tx.game.updateMany({
          where: {
            id: gameId,
            status: current.status,
            startsAt: { gt: now },
          },
          data: {
            status: GameStatus.CANCELLED,
            cancelReason: reason,
            cancelPolicySnapshot,
            cancelIdempotencyKey: idempotencyKey,
            cancelCommandHash: commandHash,
            cancelledById: actor.sub,
            cancelledAt: now,
          },
        });
        if (changed.count !== 1) {
          throw new ConflictException('球局状态已变化，请刷新后重试取消');
        }

        const cancelledBookings = await tx.courtBooking.updateMany({
          where: { gameId, status: { not: BookingStatus.CANCELLED } },
          data: { status: BookingStatus.CANCELLED },
        });
        const cancelledRegistrationIds: string[] = [];
        let cancelledPendingOrders = 0;
        for (const registration of registrations) {
          const cancelled = await tx.gameRegistration.updateMany({
            where: { id: registration.id, status: registration.status },
            data: {
              status: RegistrationStatus.CANCELLED,
              checkedInAt: null,
            },
          });
          if (cancelled.count !== 1) continue;
          cancelledRegistrationIds.push(registration.id);
          if (isZeroAmountConfirmedActivityOrder(registration.order)) {
            await cancelZeroAmountActivityOrder(
              tx,
              registration.order,
              actor,
              reason,
              now,
            );
            continue;
          }
          if (registration.order?.status !== OrderStatus.PENDING) continue;
          const cancelledOrder = await transitionOrder(tx, 'CANCEL_UNPAID', {
            where: { id: registration.order.id, status: OrderStatus.PENDING },
            data: { status: OrderStatus.CANCELLED, cancelledAt: now },
          });
          if (cancelledOrder.count !== 1)
            throw new ConflictException('待支付订单状态已变化，请重试取消');
          cancelledPendingOrders += cancelledOrder.count;
          await tx.payment.updateMany({
            where: {
              orderId: registration.order.id,
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

        const refundRequests: Array<{
          id: string;
          orderId: string;
          amountCents: number;
          status: RefundStatus;
        }> = [];
        for (const plan of refundPlans) {
          const refundIdempotencyKey = `GAME_CANCEL:${gameId}:${plan.order.id}`;
          const refundReason = `球局取消：${reason}`;
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
            throw new ConflictException('球局取消退款幂等键已用于不同退款命令');
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
              action: 'GAME_CANCELLATION_REFUND_REQUESTED',
              objectType: 'Refund',
              objectId: refund.id,
              reason,
              newValue: {
                gameId,
                gameRegistrationId: plan.registration.id,
                orderId: plan.order.id,
                amountCents: plan.amountCents,
                status: RefundStatus.REQUESTED,
                financeApprovalRequired: true,
              } as never,
            },
          });
          refundRequests.push(refund);
        }

        const game = await tx.game.findUniqueOrThrow({ where: { id: gameId } });
        await tx.auditLog.create({
          data: {
            actorId: actor.sub,
            actorRole: actor.roles[0],
            action: 'GAME_CANCELLED',
            objectType: 'Game',
            objectId: gameId,
            reason,
            oldValue: { status: current.status } as never,
            newValue: {
              status: GameStatus.CANCELLED,
              cancelPolicySnapshot,
              cancelledBookingCount: cancelledBookings.count,
              cancelledPendingOrders,
              cancelledRegistrationIds,
              refundRequestIds: refundRequests.map((refund) => refund.id),
            } as never,
          },
        });
        return gameCancellationResponse({
          game,
          cancelledBookingCount: cancelledBookings.count,
          cancelledPendingOrders,
          cancelledRegistrationIds,
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
      throw new ConflictException('球局取消发生并发冲突，请使用原命令重试');
    }
    throw error;
  }
}
