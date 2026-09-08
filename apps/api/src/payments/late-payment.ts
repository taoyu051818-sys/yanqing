import { randomUUID } from 'node:crypto'
import { ConflictException } from '@nestjs/common'
import {
  AppRole,
  OrderStatus,
  PaymentChannel,
  PaymentStatus,
  Prisma,
  RefundStatus,
} from '../generated/prisma/client.js'

type CancelledOrder = {
  id: string
  memberId: string
  payableCents: number
  paidCents: number
  status: OrderStatus
}

/** Capture external money without restoring a cancelled booking or granting benefits. */
export async function captureCancelledOrderPayment(
  tx: Prisma.TransactionClient,
  order: CancelledOrder,
  paymentId: string,
  tradeNo: string,
  now: Date,
  unavailableReason?: string,
) {
  if (order.status !== OrderStatus.CANCELLED || order.paidCents !== 0) {
    throw new ConflictException('迟到付款订单状态需人工核对')
  }
  await tx.payment.update({
    where: { id: paymentId },
    data: {
      status: PaymentStatus.SUCCEEDED,
      providerTradeNo: tradeNo,
      paidAt: now,
      providerPayload: {
        provider: 'wechat',
        transactionId: tradeNo,
        lateCancelledPayment: true,
      },
    },
  })
  await tx.order.update({
    where: { id: order.id },
    data: {
      status:
        order.payableCents > 0
          ? OrderStatus.REFUND_PENDING
          : OrderStatus.CANCELLED,
      paidCents: order.payableCents,
      paidAt: now,
      paymentChannel: PaymentChannel.WECHAT,
    },
  })
  const refund =
    order.payableCents > 0
      ? await tx.refund.upsert({
          where: { idempotencyKey: `SYSTEM:LATE_PAYMENT:${order.id}` },
          update: {},
          create: {
            refundNo: 'RF' + randomUUID().replace(/-/g, '').slice(0, 30),
            idempotencyKey: `SYSTEM:LATE_PAYMENT:${order.id}`,
            orderId: order.id,
            requestedById: order.memberId,
            amountCents: order.payableCents,
            reason: unavailableReason ? `${unavailableReason}；待财务原路退款` : '订单已取消后收到微信付款，未授予权益，待财务原路退款',
            originalOrderStatus: OrderStatus.PAID,
            status: RefundStatus.REQUESTED,
            compensationOnly: true,
          },
        })
      : null
  if (refund && (refund.orderId !== order.id || !refund.compensationOnly)) {
    throw new ConflictException('迟到付款补偿记录冲突，请联系管理员')
  }
  await tx.riskEvent.upsert({
    where: { dedupKey: `late-payment:${order.id}` },
    update: { lastSeenAt: now },
    create: {
      dedupKey: `late-payment:${order.id}`,
      ruleCode: 'BOSS_LATE_PAYMENT',
      severity: 'HIGH',
      orderId: order.id,
      objectType: 'Order',
      objectId: order.id,
      summary: unavailableReason ? '无法履约订单收到付款，需核对并原路退款' : '已取消订单收到付款，需核对并原路退款',
      lastSeenAt: now,
      evidence: {
        amountCents: order.payableCents,
        paymentId,
        refundId: refund?.id ?? null,
        benefitsGranted: false,
        ...(unavailableReason ? { unavailableReason } : {}),
      },
    },
  })
  await tx.auditLog.create({
    data: {
      actorId: order.memberId,
      actorRole: AppRole.MEMBER,
      action: 'CANCELLED_ORDER_PAYMENT_CAPTURED',
      objectType: 'Order',
      objectId: order.id,
      reason: unavailableReason ?? '微信成功付款晚于本地订单取消',
      newValue: {
        paymentId,
        providerTradeNo: tradeNo,
        amountCents: order.payableCents,
        refundId: refund?.id ?? null,
        compensationOnly: true,
      },
    },
  })
  return {
    accepted: true,
    latePayment: true,
    refundReviewRequired: Boolean(refund),
  }
}
