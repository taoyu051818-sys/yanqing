import { ConfigService } from '@nestjs/config'
import { describe, expect, it, vi } from 'vitest'

import type { AuthUser } from '../common/auth/auth-user.js'
import {
  AppRole,
  PaymentChannel,
  PaymentStatus,
  RefundStatus,
} from '../generated/prisma/enums.js'
import { OrdersService } from './orders.service.js'

const member: AuthUser = {
  sub: 'member-1',
  displayName: '会员',
  roles: [AppRole.MEMBER],
}
const finance: AuthUser = {
  sub: 'finance-1',
  displayName: '财务',
  roles: [AppRole.FINANCE],
}
const requestedAt = new Date('2026-09-01T01:00:00.000Z')
const approvedAt = new Date('2026-09-01T02:00:00.000Z')
const completedAt = new Date('2026-09-01T03:00:00.000Z')

const sensitiveKeys = [
  'orderId',
  'userId',
  'operatorId',
  'idempotencyKey',
  'paymentNo',
  'refundNo',
  'requestedById',
  'approvedById',
  'providerPayload',
  'providerTradeNo',
  'providerRefundNo',
  'originalOrderStatus',
]

function expectNoSensitiveFields(result: Record<string, unknown>) {
  for (const key of sensitiveKeys) expect(result).not.toHaveProperty(key)
}

function service(prisma: Record<string, unknown>) {
  return new OrdersService(
    prisma as never,
    new ConfigService({ PAYMENT_PROVIDER: 'wechat' }),
    {} as never,
    {} as never,
  )
}

describe('OrdersService command response privacy', () => {
  it('projects an idempotent WeChat payment and preserves only its client signature package', async () => {
    const wechatPay = {
      timeStamp: '1788224400',
      nonceStr: 'nonce',
      package: 'prepay_id=client-required',
      signType: 'RSA',
      paySign: 'signature',
    }
    const payment = {
      id: 'payment-secret',
      paymentNo: 'PAY-SECRET',
      orderId: 'order-1',
      userId: member.sub,
      operatorId: member.sub,
      channel: PaymentChannel.WECHAT,
      amountCents: 6800,
      status: PaymentStatus.PROCESSING,
      idempotencyKey: 'payment-secret-key',
      providerTradeNo: 'provider-secret',
      providerPayload: { provider: 'wechat', wechatPay },
      createdAt: requestedAt,
      paidAt: null,
    }
    const orders = service({
      eventTeam: { findUnique: vi.fn().mockResolvedValue(null) },
      payment: { findUnique: vi.fn().mockResolvedValue(payment) },
    })

    const result = await orders.pay(
      payment.orderId,
      { channel: PaymentChannel.WECHAT, idempotencyKey: payment.idempotencyKey },
      member,
    )

    expect(result).toEqual({
      status: PaymentStatus.PROCESSING,
      amountCents: 6800,
      channel: PaymentChannel.WECHAT,
      createdAt: requestedAt,
      paidAt: null,
      wechatPay,
    })
    expectNoSensitiveFields(result)
    expect(JSON.stringify(result)).not.toContain('provider-secret')
  })

  it('projects request, approval and rejection refunds without persistence metadata', async () => {
    const baseRefund = {
      id: 'refund-secret',
      refundNo: 'RF-SECRET',
      orderId: 'order-secret',
      requestedById: member.sub,
      approvedById: finance.sub,
      idempotencyKey: 'refund-secret-key',
      providerRefundNo: 'provider-refund-secret',
      originalOrderStatus: 'PAID',
      amountCents: 3200,
      reason: '临时有事',
      requestedAt,
      approvedAt,
      completedAt,
    }
    const requestService = service({
      order: {
        findUnique: vi.fn().mockResolvedValue({
          id: baseRefund.orderId,
          memberId: member.sub,
        }),
      },
      refund: {
        findUnique: vi.fn().mockResolvedValue({
          ...baseRefund,
          status: RefundStatus.REQUESTED,
          approvedAt: null,
          completedAt: null,
        }),
      },
    })
    const requested = await requestService.requestRefund(
      baseRefund.orderId,
      {
        amountCents: baseRefund.amountCents,
        reason: baseRefund.reason,
        idempotencyKey: baseRefund.idempotencyKey,
      },
      member,
    )

    const approveService = service({
      $transaction: vi.fn(async (work: (tx: any) => unknown) =>
        work({
          refund: {
            findUnique: vi.fn().mockResolvedValue({
              ...baseRefund,
              status: RefundStatus.SUCCEEDED,
            }),
          },
        }),
      ),
    })
    const approved = await approveService.approveRefund(
      baseRefund.id,
      { reason: '审批通过' },
      finance,
    )

    const rejectService = service({
      $transaction: vi.fn(async (work: (tx: any) => unknown) =>
        work({
          refund: {
            findUnique: vi.fn().mockResolvedValue({
              ...baseRefund,
              status: RefundStatus.REJECTED,
            }),
          },
        }),
      ),
    })
    const rejected = await rejectService.rejectRefund(
      baseRefund.id,
      { reason: '证据不足' },
      finance,
    )

    expect(requested).toEqual({
      id: 'refund-secret',
      status: RefundStatus.REQUESTED,
      amountCents: 3200,
      reason: '临时有事',
      requestedAt,
      approvedAt: null,
      completedAt: null,
    })
    expect(approved.status).toBe(RefundStatus.SUCCEEDED)
    expect(rejected.status).toBe(RefundStatus.REJECTED)
    for (const result of [requested, approved, rejected]) {
      expectNoSensitiveFields(result)
      expect(JSON.stringify(result)).not.toContain('provider-refund-secret')
      expect(JSON.stringify(result)).not.toContain('refund-secret-key')
    }
  })
})
