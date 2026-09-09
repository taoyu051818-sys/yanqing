import { ConflictException } from '@nestjs/common';
import type { AuthUser } from '../common/auth/auth-user.js';
import { BusinessType, OrderStatus, PaymentStatus, Prisma, RewardStatus } from '../generated/prisma/client.js';

type ActivityOrder = {
  id: string;
  businessType: BusinessType;
  status: OrderStatus;
  payableCents: number;
  paidCents: number;
  refundedCents: number;
  completedAt: Date | null;
};

export function isZeroAmountConfirmedActivityOrder(order: ActivityOrder | null | undefined): boolean {
  return Boolean(order &&
    (order.businessType === BusinessType.EVENT || order.businessType === BusinessType.GAME) &&
    (order.status === OrderStatus.PAID || order.status === OrderStatus.CHECKED_IN) &&
    order.payableCents === 0 && order.paidCents === 0 && order.refundedCents === 0 &&
    order.completedAt === null);
}

/** Cancel with the registration in the caller's transaction; preserve the
 * successful zero confirmation as history rather than inventing a refund. */
export async function cancelZeroAmountActivityOrder(
  tx: Prisma.TransactionClient,
  order: ActivityOrder | null,
  actor: AuthUser,
  reason: string,
  now: Date,
) {
  if (!order || !isZeroAmountConfirmedActivityOrder(order))
    throw new ConflictException('订单不是可直接取消的零元活动订单');
  const changed = await tx.order.updateMany({
    where: {
      id: order.id, status: order.status, businessType: order.businessType,
      payableCents: 0, paidCents: 0, refundedCents: 0, completedAt: null,
      // Inconsistent financial evidence must be reviewed, not silently closed.
      payments: { none: { amountCents: { gt: 0 }, status: { in: [
        PaymentStatus.CREATED, PaymentStatus.PROCESSING, PaymentStatus.SUCCEEDED, PaymentStatus.REFUNDED,
      ] } } },
      refunds: { none: {} },
    },
    data: { status: OrderStatus.CANCELLED, cancelledAt: now },
  });
  if (changed.count !== 1)
    throw new ConflictException('零元订单状态或付款证据已变化，请核对后重试');
  await tx.referralReward.updateMany({
    where: { triggerOrderId: order.id, status: { in: [RewardStatus.PENDING_OBSERVATION, RewardStatus.AVAILABLE] } },
    data: { status: RewardStatus.REVERSED, reversedAt: now },
  });
  await tx.auditLog.create({ data: {
    actorId: actor.sub, actorRole: actor.roles[0], action: 'ZERO_AMOUNT_ORDER_CANCELLED',
    objectType: 'Order', objectId: order.id, reason,
    oldValue: { status: order.status },
    newValue: { status: OrderStatus.CANCELLED, cancelledAt: now.toISOString(), amountCents: 0, refundRequired: false },
  } });
}
