import { releasePendingOrderResources } from '../../orders/pending-order-resources.js';
import { requireOrderTransition } from '../../orders/order-transition.js';
import { reserveBookingCoupon } from '../../orders/booking-coupon.js';
import { membershipPurchaseUnavailable } from '../../memberships/membership-entitlements.js';
import { gamePaymentUnavailable } from '../../games/game-registration-policy.js';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';
import {
  AppRole,
  BusinessType,
  EventStatus,
  OrderStatus,
  PaymentChannel,
  PaymentStatus,
  Prisma,
  RefundStatus,
  RegistrationStatus,
} from '../../generated/prisma/client.js';
import { assertGoodsStockAvailable } from '../../inventory/goods-stock.js';
import { OrderFinalizerService } from '../order-finalizer.service.js';
import { promoteNextEventWaitlist } from '../../events/registration/event-waitlist.js';
import { captureCancelledOrderPayment } from '../late-payment.js';
import { TransactionNotice, businessSerial } from './wechat-notice-types.js';

export async function finalizeWechatPayment(
  prisma: PrismaService,
  finalizer: OrderFinalizerService,
  notice: TransactionNotice,
) {
  return prisma.$transaction(
    async (tx) => {
      const order = await tx.order.findUnique({
        where: { orderNo: notice.out_trade_no },
        include: {
          items: true,
          membership: { include: { product: true } },
          member: { select: { openId: true } },
          eventTeam: { include: { event: true } },
          gameRegistration: { include: { game: true } },
          payments: {
            where: { channel: PaymentChannel.WECHAT },
            orderBy: { createdAt: 'desc' },
          },
        },
      });
      if (!order) throw new BadRequestException('微信支付订单不存在');
      if (notice.amount.total !== order.payableCents)
        throw new BadRequestException('微信支付通知金额不一致');
      const payment = order.payments[0];
      if (!payment) throw new BadRequestException('微信支付记录不存在');
      if (
        payment.status === PaymentStatus.SUCCEEDED &&
        order.status !== OrderStatus.PENDING
      )
        return { accepted: true, idempotent: true };
      const now = new Date();
      if (order.status === OrderStatus.CANCELLED && order.paidCents === 0) {
        return captureCancelledOrderPayment(
          tx,
          order,
          payment.id,
          notice.transaction_id,
          now,
        );
      }
      if (order.membership && order.status === OrderStatus.PENDING) {
        const reason = await membershipPurchaseUnavailable(
          tx,
          order.membership.memberId,
          order.membership.product.level,
          order.membership.id,
          now,
        );
        if (reason) {
          await requireOrderTransition(tx, 'CANCEL_UNPAID', {
            where: { id: order.id, status: OrderStatus.PENDING },
            data: { status: OrderStatus.CANCELLED, cancelledAt: now },
          });
          await releasePendingOrderResources(tx, order, {
            cause: 'PAYMENT_UNAVAILABLE',
            now,
          });
          return captureCancelledOrderPayment(
            tx,
            { ...order, status: OrderStatus.CANCELLED },
            payment.id,
            notice.transaction_id,
            now,
            `会员权益冲突，未授予新权益：${reason}`,
          );
        }
      }
      if (
        order.businessType === BusinessType.GAME &&
        order.status === OrderStatus.PENDING &&
        gamePaymentUnavailable(order.gameRegistration, order.createdAt, now)
      ) {
        // The external payment succeeded, but the seat is no longer payable.
        // Close this reservation before recording a compensation-only refund.
        await requireOrderTransition(tx, 'CANCEL_UNPAID', {
          where: { id: order.id, status: OrderStatus.PENDING },
          data: { status: OrderStatus.CANCELLED, cancelledAt: now },
        });
        await releasePendingOrderResources(tx, order, {
          cause: 'PAYMENT_UNAVAILABLE',
          now,
        });
        const captured = await captureCancelledOrderPayment(
          tx,
          { ...order, status: OrderStatus.CANCELLED },
          payment.id,
          notice.transaction_id,
          now,
        );
        return captured;
      }
      const invalidEventReservation =
        order.businessType === BusinessType.EVENT &&
        order.eventTeam &&
        (order.eventTeam.status !== RegistrationStatus.REGISTERED ||
          !order.eventTeam.paymentDueAt ||
          order.eventTeam.paymentDueAt <= now ||
          (order.eventTeam.event.status !== EventStatus.OPEN &&
            order.eventTeam.event.status !== EventStatus.FULL) ||
          order.eventTeam.event.startsAt <= now);
      if (invalidEventReservation && order.eventTeam) {
        await tx.payment.update({
          where: { id: payment.id },
          data: {
            status: PaymentStatus.SUCCEEDED,
            providerTradeNo: notice.transaction_id,
            paidAt: now,
            providerPayload: {
              provider: 'wechat',
              transactionId: notice.transaction_id,
              lateEventPayment: true,
            },
          },
        });
        await requireOrderTransition(tx, 'CANCEL_UNPAID', {
          where: { id: order.id, status: OrderStatus.PENDING },
          data: { status: OrderStatus.CANCELLED, cancelledAt: now },
        });
        await requireOrderTransition(tx, 'CAPTURE_COMPENSATION', {
          where: { id: order.id, status: OrderStatus.CANCELLED },
          data: {
            status:
              order.payableCents > 0
                ? OrderStatus.REFUND_PENDING
                : OrderStatus.CANCELLED,
            paymentChannel: PaymentChannel.WECHAT,
            paidCents: order.payableCents,
            paidAt: now,
            cancelledAt: order.payableCents > 0 ? undefined : now,
          },
        });
        await tx.eventTeam.updateMany({
          where: {
            id: order.eventTeam.id,
            status: { not: RegistrationStatus.REFUNDED },
          },
          data: {
            status: RegistrationStatus.CANCELLED,
            paymentDueAt: null,
            cancelledAt: now,
          },
        });
        let refund = null;
        if (order.payableCents > 0) {
          refund = await tx.refund.upsert({
            where: { idempotencyKey: `EVENT_LATE_PAYMENT:${order.id}` },
            update: {},
            create: {
              refundNo: businessSerial('RF'),
              idempotencyKey: `EVENT_LATE_PAYMENT:${order.id}`,
              orderId: order.id,
              requestedById: order.memberId,
              amountCents: order.payableCents,
              reason: '赛事报名支付回调晚于席位保留截止，原路退款待财务审批',
              status: RefundStatus.REQUESTED,
              originalOrderStatus: OrderStatus.PAID,
            },
          });
        }
        await promoteNextEventWaitlist(
          tx,
          order.eventTeam.eventId,
          order.memberId,
          AppRole.MEMBER,
          now,
        );
        await tx.auditLog.create({
          data: {
            actorId: order.memberId,
            actorRole: AppRole.MEMBER,
            action: 'EVENT_LATE_PAYMENT_REFUND_REQUESTED',
            objectType: 'Order',
            objectId: order.id,
            reason: '支付成功回调到达时赛事席位保留已失效',
            newValue: {
              paymentId: payment.id,
              providerTradeNo: notice.transaction_id,
              amountCents: order.payableCents,
              refundId: refund?.id ?? null,
              financeApprovalRequired: order.payableCents > 0,
            } as never,
          },
        });
        return {
          accepted: true,
          latePayment: true,
          refundReviewRequired: order.payableCents > 0,
        };
      }
      if (
        order.businessType === BusinessType.GOODS &&
        order.status === OrderStatus.PENDING
      ) {
        // Validate every line before any fulfillment writes. Never swallow a
        // failed finalizer after it may already have changed stock or benefits.
        let unavailable: string | undefined;
        try {
          await assertGoodsStockAvailable(tx, order.items);
        } catch (error) {
          if (
            !(error instanceof BadRequestException) &&
            !(error instanceof ConflictException)
          )
            throw error;
          unavailable = error.message;
        }
        if (unavailable) {
          await requireOrderTransition(tx, 'CANCEL_UNPAID', {
            where: { id: order.id, status: OrderStatus.PENDING },
            data: { status: OrderStatus.CANCELLED, cancelledAt: now },
          });
          return captureCancelledOrderPayment(
            tx,
            { ...order, status: OrderStatus.CANCELLED },
            payment.id,
            notice.transaction_id,
            now,
            `商品无法出库，未交付商品：${unavailable}`,
          );
        }
      }
      if (
        order.businessType === BusinessType.VENUE &&
        order.status === OrderStatus.PENDING
      ) {
        let unavailable: string | undefined;
        try {
          await reserveBookingCoupon(tx, order, now);
        } catch (error) {
          if (!(error instanceof ConflictException)) throw error;
          unavailable = error.message;
        }
        if (unavailable) {
          // External money already exists. Preserve it and request compensation;
          // never roll it back merely because its discounted booking cannot be delivered.
          await requireOrderTransition(tx, 'CANCEL_UNPAID', {
            where: { id: order.id, status: OrderStatus.PENDING },
            data: { status: OrderStatus.CANCELLED, cancelledAt: now },
          });
          await releasePendingOrderResources(tx, order, {
            cause: 'PAYMENT_UNAVAILABLE',
            now,
          });
          return captureCancelledOrderPayment(
            tx,
            { ...order, status: OrderStatus.CANCELLED },
            payment.id,
            notice.transaction_id,
            now,
            `优惠券订场无法履约，未交付场地：${unavailable}`,
          );
        }
      }
      const succeeded = await tx.payment.update({
        where: { id: payment.id },
        data: {
          status: PaymentStatus.SUCCEEDED,
          providerTradeNo: notice.transaction_id,
          paidAt: now,
          providerPayload: {
            provider: 'wechat',
            transactionId: notice.transaction_id,
          },
        },
      });
      await finalizer.finalize(
        tx,
        order,
        { ...succeeded, amountCents: succeeded.amountCents },
        succeeded.operatorId,
        AppRole.MEMBER,
        now,
      );
      return { accepted: true };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}
