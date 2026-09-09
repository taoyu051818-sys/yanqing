import { describe, expect, it, vi } from 'vitest'
import { WechatPayService } from './wechat-pay.service.js'
import { OrdersService } from '../orders/orders.service.js'
import { OrderFinalizerService } from './order-finalizer.service.js'

const kinds = [
  'VENUE',
  'GAME',
  'EVENT',
  'GOODS',
  'RECHARGE',
  'MEMBERSHIP',
  'TRAINING',
]
function fixture(kind: string) {
  const order: any = {
    id: 'order',
    orderNo: 'TEST-LATE',
    memberId: 'member',
    businessType: kind,
    status: 'CANCELLED',
    payableCents: 8800,
    paidCents: 0,
    refundedCents: 0,
    items: [],
    membership: null,
    member: { openId: 'test' },
    eventTeam: null,
    payments: [
      {
        id: 'payment',
        paymentNo: 'TEST-PAY',
        operatorId: 'member',
        status: 'CLOSED',
        channel: 'WECHAT',
        amountCents: 8800,
      },
    ],
  }
  const refunds: any[] = []
  const tx: any = {
    order: {
      findUnique: vi.fn(async () => order),
      updateMany: vi.fn(async ({ where, data }) => {
        if (order.status !== where.status) return { count: 0 }
        Object.assign(order, data)
        return { count: 1 }
      }),
    },
    payment: {
      update: vi.fn(async ({ data }) => Object.assign(order.payments[0], data)),
    },
    refund: {
      upsert: vi.fn(async ({ create }) => {
        const row = { ...create, id: 'refund' }
        refunds.push(row)
        return row
      }),
      findUnique: vi.fn(async () => ({ ...refunds[0], order })),
      update: vi.fn(async ({ data }) => Object.assign(refunds[0], data)),
    },
    riskEvent: { upsert: vi.fn().mockResolvedValue({}) },
    auditLog: { create: vi.fn().mockResolvedValue({}) },
  }
  const prisma = { $transaction: async (run: any) => run(tx) }
  const config = {
    get: (key: string) => (key === 'PAYMENT_PROVIDER' ? 'wechat' : undefined),
  }
  const finalizer = new OrderFinalizerService({} as never)
  const finalize = vi.spyOn(finalizer, 'finalize')
  const service = new WechatPayService(
    config as never,
    prisma as never,
    finalizer,
  )
  vi.spyOn(service as any, 'verifyWechatSignature').mockImplementation(() => {})
  vi.spyOn(service as any, 'decrypt').mockReturnValue({
    out_trade_no: 'TEST-LATE',
    transaction_id: 'TEST-WX',
    trade_state: 'SUCCESS',
    amount: { total: 8800 },
  })
  const receive = () =>
    service.handleNotification(
      Buffer.from(
        JSON.stringify({ event_type: 'TRANSACTION.SUCCESS', resource: {} }),
      ),
      {
        'wechatpay-timestamp': String(Math.floor(Date.now() / 1000)),
        'wechatpay-nonce': 'test',
        'wechatpay-signature': 'test',
        'wechatpay-serial': 'test',
      },
    )
  return { order, refunds, tx, prisma, config, service, finalize, receive }
}
describe('late payment compensation', () => {
  it.each(kinds)(
    'captures cancelled %s payment once without granting benefits',
    async (kind) => {
      const f = fixture(kind)
      expect(await f.receive()).toMatchObject({
        accepted: true,
        latePayment: true,
        refundReviewRequired: true,
      })
      expect(f.order).toMatchObject({
        status: 'REFUND_PENDING',
        paidCents: 8800,
      })
      expect(f.refunds[0]).toMatchObject({
        compensationOnly: true,
        status: 'REQUESTED',
        amountCents: 8800,
      })
      expect(f.finalize).not.toHaveBeenCalled()
      await f.receive()
      expect(f.refunds).toHaveLength(1)
      expect(f.tx.riskEvent.upsert).toHaveBeenCalledOnce()
    },
  )
  it.each(kinds)(
    'refunds cancelled %s payment without reversing ungranted benefits',
    async (kind) => {
      const f = fixture(kind)
      await f.receive()
      const createRefund = vi
        .fn()
        .mockResolvedValue({ refundId: 'WX-REFUND', status: 'PROCESSING' })
      const orders = new OrdersService(
        f.prisma as never,
        f.config as never,
        {} as never,
        { createRefund } as never,
      )
      const actor = {
        sub: 'finance',
        roles: ['FINANCE'],
        displayName: '财务',
      } as never
      await expect(
        orders.rejectRefund('refund', { reason: '不予退款' }, actor),
      ).rejects.toThrow('强制退款不可驳回')
      await orders.approveRefund('refund', { reason: '核对迟到付款' }, actor)
      expect(createRefund).toHaveBeenCalledWith(
        expect.objectContaining({ refundCents: 8800, totalCents: 8800 }),
      )
      const notice = {
        out_refund_no: f.refunds[0].refundNo,
        refund_id: 'WX-REFUND',
        refund_status: 'SUCCESS',
        amount: { refund: 8800, total: 8800 },
      }
      await (f.service as any).finalizeRefund(notice)
      expect(f.order).toMatchObject({ status: 'REFUNDED', refundedCents: 8800 })
      await (f.service as any).finalizeRefund(notice)
      expect(f.order.refundedCents).toBe(8800)
      // This fixture deliberately has no account/inventory/membership mutation APIs.
      // Using a normal business refund path would throw instead of passing.
    },
  )
})
