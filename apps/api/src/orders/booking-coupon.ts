import { ConflictException } from '@nestjs/common';
import { BusinessType, type Prisma } from '../generated/prisma/client.js';

type Client = Pick<Prisma.TransactionClient, 'couponCode'>;
type CouponOrder = {
  id: string;
  memberId: string;
  businessType: BusinessType;
  consumedCouponCode?: string | null;
  parameterSnapshot?: unknown;
};

/** CLAIMED + attributionOrderId reserves a coupon; only REDEEMED counts as usage. */
export async function payableBookingCoupon(tx: Client, order: CouponOrder, now = new Date()) {
  if (order.businessType !== BusinessType.VENUE) return null;
  const couponId = (order.parameterSnapshot as { couponId?: string } | null)?.couponId;
  if (!order.consumedCouponCode && !couponId) return null;
  const coupon = await tx.couponCode.findUnique({
    where: order.consumedCouponCode ? { code: order.consumedCouponCode } : { id: couponId! },
    include: { template: { include: { merchant: { select: { status: true } } } } },
  });
  if (!coupon) throw new ConflictException('订单优惠券不存在，请取消后重新下单');
  if (!coupon.template.code.startsWith('NEWCOMER') && !coupon.template.allowVenueBooking)
    throw new ConflictException('此订单使用的商户券已不支持订场，请取消后重新选择优惠下单');
  if (!order.consumedCouponCode || coupon.holderId !== order.memberId || (couponId && couponId !== coupon.id))
    throw new ConflictException('订单优惠券不属于当前会员或记录不一致');
  if (coupon.status !== 'CLAIMED') throw new ConflictException('订单优惠券已被使用或已失效');
  if (coupon.expiresAt <= now || coupon.template.validTo <= now) throw new ConflictException('订单优惠券已过期');
  if (!coupon.template.enabled || coupon.template.merchant.status !== 'ACTIVE' || coupon.template.validFrom > now)
    throw new ConflictException('订单优惠券活动或商户不可用');
  if (coupon.attributionOrderId && coupon.attributionOrderId !== order.id)
    throw new ConflictException('订单优惠券已锁定到其他订单，请先完成或取消原订单');
  return coupon;
}

export async function reserveBookingCoupon(tx: Client, order: CouponOrder, now = new Date()) {
  const coupon = await payableBookingCoupon(tx, order, now);
  if (!coupon) return;
  const reserved = await tx.couponCode.updateMany({
    where: { id: coupon.id, status: 'CLAIMED', holderId: order.memberId, expiresAt: { gt: now },
      OR: [{ attributionOrderId: null }, { attributionOrderId: order.id }] },
    data: { attributionOrderId: order.id },
  });
  if (reserved.count !== 1) throw new ConflictException('订单优惠券已被其他操作使用，请刷新后重试');
}

export async function releaseBookingCoupon(tx: Client, order: CouponOrder) {
  if (order.businessType !== BusinessType.VENUE || !order.consumedCouponCode) return;
  await tx.couponCode.updateMany({
    where: { code: order.consumedCouponCode, status: 'CLAIMED', attributionOrderId: order.id },
    data: { attributionOrderId: null },
  });
}
