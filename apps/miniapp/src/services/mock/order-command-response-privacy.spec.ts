import { beforeEach, describe, expect, it, vi } from 'vitest'

import { mockRequest } from './router'
import { getOrders, saveOrders } from './venue'

const storage = new Map<string, unknown>()

vi.stubGlobal('uni', {
  getStorageSync: (key: string) => storage.get(key) ?? '',
  setStorageSync: (key: string, value: unknown) => storage.set(key, value),
  removeStorageSync: (key: string) => storage.delete(key),
})

const request = <T = any>(method: string, url: string, data: object = {}) =>
  mockRequest<T>(method, url, data)
const login = (role: string) => request('POST', '/auth/dev-login', { role })
const forbidden = [
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

function expectPublic(result: Record<string, unknown>) {
  for (const key of forbidden) expect(result).not.toHaveProperty(key)
}

describe('mock payment and refund command response privacy', () => {
  beforeEach(async () => {
    storage.clear()
    await login('MEMBER')
    saveOrders([
      {
        id: 'privacy-order',
        orderNo: 'PRIVACY-ORDER',
        memberId: 'user-member',
        businessType: 'VENUE',
        status: 'PENDING',
        title: '隐私响应验收订单',
        payableCents: 6800,
        paidCents: 0,
        refundedCents: 0,
        items: [],
      },
      ...getOrders(),
    ])
  })

  it('returns a WeChat signature package without payment persistence fields', async () => {
    const payment = await request<any>('POST', '/orders/privacy-order/pay', {
      channel: 'WECHAT',
      idempotencyKey: 'privacy-payment-key',
    })

    expect(payment).toMatchObject({
      status: 'SUCCEEDED',
      amountCents: 6800,
      channel: 'WECHAT',
      wechatPay: {
        signType: 'RSA',
        paySign: expect.any(String),
      },
    })
    expectPublic(payment)
    expect(payment).toHaveProperty('createdAt')
    expect(payment).toHaveProperty('paidAt')
  })

  it('returns refund lifecycle fields without refund, actor or provider metadata', async () => {
    await request('POST', '/orders/privacy-order/pay', {
      channel: 'WECHAT',
      idempotencyKey: 'privacy-payment-key',
    })
    const requested = await request<any>('POST', '/orders/privacy-order/refunds', {
      amountCents: 6800,
      reason: '无法到场',
      idempotencyKey: 'privacy-refund-key',
    })
    expectPublic(requested)

    const internalRefund = getOrders()
      .find((order) => order.id === 'privacy-order')!
      .refunds[0]
    await login('FINANCE')
    const approved = await request<any>(
      'POST',
      `/orders/refunds/${internalRefund.id}/approve`,
      { reason: '核对通过' },
    )

    expect(approved).toMatchObject({
      status: 'SUCCEEDED',
      amountCents: 6800,
      reason: '无法到场',
    })
    expectPublic(approved)
    expect(approved).toHaveProperty('requestedAt')
    expect(approved).toHaveProperty('approvedAt')
    expect(approved).toHaveProperty('completedAt')
  })
})
