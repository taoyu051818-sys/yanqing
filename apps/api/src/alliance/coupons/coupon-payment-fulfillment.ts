import type { Prisma } from '../../generated/prisma/client.js';
import { ConflictException } from '@nestjs/common';
import type { PaidOrderContext } from '../../orders/paid-order-context.js';

type CouponPaymentContext = Pick<PaidOrderContext, 'now' | 'paymentActorId'> & {
  readonly tx: {
    couponCode: Pick<
      Prisma.TransactionClient['couponCode'],
      'findUnique' | 'updateMany'
    >;
    couponTemplate: Pick<Prisma.TransactionClient['couponTemplate'], 'update'>;
  };
  readonly order: Pick<
    PaidOrderContext['order'],
    'id' | 'consumedCouponCode' | 'payableCents'
  >;
};

export async function redeemPaidOrderCoupon({
  tx,
  order,
  paymentActorId,
  now,
}: CouponPaymentContext): Promise<void> {
  if (order.consumedCouponCode) {
    const coupon = await tx.couponCode.findUnique({
      where: { code: order.consumedCouponCode },
      include: { template: true },
    });
    if (!coupon) throw new ConflictException('订单优惠券不存在');
    if (coupon.status !== 'CLAIMED') {
      // The discount is part of the order snapshot, but the coupon itself
      // is a one-time resource.  Without this guard two orders created with
      // the same claimed code could both be paid and silently receive the
      // same benefit.  Failing the payment finalisation rolls the whole
      // transaction back, leaving the second order pending for a safe retry.
      throw new ConflictException('订单优惠券已被使用或已失效');
    }
    if (coupon.expiresAt <= now)
      throw new ConflictException('订单优惠券已过期');
    if (coupon.attributionOrderId && coupon.attributionOrderId !== order.id) {
      throw new ConflictException('订单优惠券已锁定到其他订单');
    }
    const redeemed = await tx.couponCode.updateMany({
      where: {
        id: coupon.id,
        status: 'CLAIMED',
        OR: [{ attributionOrderId: null }, { attributionOrderId: order.id }],
      },
      data: {
        status: 'REDEEMED',
        redeemedAt: now,
        redeemedById: paymentActorId,
        redeemedMerchantId: coupon.template.merchantId,
        attributionOrderId: order.id,
        attributedAmountCents: order.payableCents,
      },
    });
    if (redeemed.count !== 1)
      throw new ConflictException('订单优惠券已被并发使用，请重新下单');
    await tx.couponTemplate.update({
      where: { id: coupon.templateId },
      data: { redeemedCount: { increment: 1 } },
    });
  }
}
