import { transitionOrder } from './order-transition.js';
import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import type { AuthUser } from '../common/auth/auth-user.js';
import type { PrismaService } from '../database/prisma.service.js';
import { AppRole, BookingStatus, BusinessType, OrderStatus, PaymentStatus, Prisma, RewardStatus } from '../generated/prisma/client.js';
import { orderResponse } from './order-response.js';

/** Close an unused free reservation, preserving its zero-payment evidence. */
export async function cancelZeroAmountVenueOrder(db: PrismaService, orderId: string, actor: AuthUser, reason: string, requestId: string) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await db.$transaction(async tx => {
        const order = await tx.order.findUnique({ where: { id: orderId }, include: { bookings: true, items: true } });
        if (!order) throw new NotFoundException('订单不存在');
        if (order.memberId !== actor.sub && !actor.roles.some(role => [AppRole.FRONT_DESK, AppRole.ADMIN, AppRole.SUPER_ADMIN].includes(role as never)))
          throw new ForbiddenException('仅会员本人、前台或管理员可取消预约');
        if (order.businessType !== BusinessType.VENUE || order.payableCents !== 0 || order.paidCents !== 0 || order.refundedCents !== 0)
          throw new ConflictException('仅零元场地预约可直接取消');
        if (order.status === OrderStatus.CANCELLED) return orderResponse(order);
        const now = new Date();
        if (order.status !== OrderStatus.PAID || order.completedAt || !order.bookings.length ||
          order.bookings.some(booking => booking.status !== BookingStatus.CONFIRMED || booking.startsAt <= now))
          throw new ConflictException('仅未开始、未核销的免费预约可取消');
        const changed = await transitionOrder(tx, 'CANCEL_FREE', {
          where: { id: orderId, businessType: BusinessType.VENUE, status: OrderStatus.PAID,
            payableCents: 0, paidCents: 0, refundedCents: 0, completedAt: null,
            payments: { none: { amountCents: { gt: 0 }, status: { in: [PaymentStatus.CREATED, PaymentStatus.PROCESSING, PaymentStatus.SUCCEEDED, PaymentStatus.REFUNDED] } } },
            refunds: { none: {} },
          },
          data: { status: OrderStatus.CANCELLED, cancelledAt: now },
        });
        if (changed.count !== 1) throw new ConflictException('订单状态或付款记录已变化，请刷新后重试');
        const released = await tx.courtBooking.updateMany({
          where: { orderId, status: BookingStatus.CONFIRMED, startsAt: { gt: now } },
          data: { status: BookingStatus.CANCELLED, holdExpiresAt: null },
        });
        if (released.count !== order.bookings.length) throw new ConflictException('预约状态已变化，请刷新后重试');
        if (order.consumedCouponCode) {
          const coupon = await tx.couponCode.findUnique({ where: { code: order.consumedCouponCode } });
          if (!coupon || coupon.status !== 'REDEEMED' || coupon.attributionOrderId !== orderId || coupon.holderId !== order.memberId)
            throw new ConflictException('预约优惠券记录不一致，请联系工作人员核对');
          const restored = await tx.couponCode.updateMany({
            where: { id: coupon.id, status: 'REDEEMED', attributionOrderId: orderId },
            data: { status: coupon.expiresAt > now ? 'CLAIMED' : 'EXPIRED', redeemedAt: null, redeemedById: null,
              redeemedMerchantId: null, attributionOrderId: null, attributedAmountCents: 0, idempotencyKey: null },
          });
          const counted = await tx.couponTemplate.updateMany({ where: { id: coupon.templateId, redeemedCount: { gt: 0 } }, data: { redeemedCount: { decrement: 1 } } });
          if (restored.count !== 1 || counted.count !== 1) throw new ConflictException('优惠券状态已变化，请核对后重试');
        }
        await tx.referralReward.updateMany({
          where: { triggerOrderId: orderId, status: { in: [RewardStatus.PENDING_OBSERVATION, RewardStatus.AVAILABLE] } },
          data: { status: RewardStatus.REVERSED, reversedAt: now },
        });
        await tx.auditLog.create({ data: { actorId: actor.sub, actorRole: actor.roles[0], action: 'ZERO_AMOUNT_VENUE_CANCELLED',
          objectType: 'Order', objectId: orderId, requestId, reason,
          oldValue: { status: order.status }, newValue: { status: OrderStatus.CANCELLED, bookingStatus: BookingStatus.CANCELLED, refundRequired: false, couponRestored: Boolean(order.consumedCouponCode) },
        } });
        return orderResponse(await tx.order.findUniqueOrThrow({ where: { id: orderId }, include: { bookings: true, items: true } }));
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (cause) {
      if (!(cause instanceof Prisma.PrismaClientKnownRequestError) || cause.code !== 'P2034') throw cause;
      if (attempt === 2) throw new ConflictException('预约正在被其他操作处理，请刷新后重试');
    }
  }
}
