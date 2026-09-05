import { describe, expect, it, vi } from 'vitest'
import { plainToInstance } from 'class-transformer'
import { validate } from 'class-validator'
import { AppRole, BusinessType, PaymentChannel } from '../generated/prisma/enums.js'
import { OrdersService } from './orders.service.js'
import { pendingPaymentDeadline } from './pending-order-policy.js'
import { PayOrderDto } from './orders.dto.js'

const actor = { sub: 'member-1', roles: [AppRole.MEMBER], displayName: '测试会员' }
function setup(type = 'RECHARGE', overrides: Record<string, any> = {}) {
  const order: any = { id: 'order-1', orderNo: 'ORDER-1', memberId: actor.sub, title: '测试购买',
    status: 'PENDING', businessType: type, createdAt: new Date(), payableCents: 1001, bookings: [], payments: [],
    items: [{ itemId: 'goods-1', name: '羽毛球', quantity: 2 }], refunds: [], parameterSnapshot: {},
    member: { openId: 'private-open-id', accounts: [
      { type: 'CASH_PRINCIPAL', balance: 2000, frozenBalance: 1500 },
      { type: 'GIFT_BALANCE', balance: 5000, frozenBalance: 0 },
      { type: 'BADMINTON_COIN', balance: 101, frozenBalance: 0 },
    ] }, ...overrides }
  const tx: any = {
    order: {
      findFirst: vi.fn().mockResolvedValue(order), findUnique: vi.fn().mockResolvedValue(order),
      updateMany: vi.fn(async ({ data }) => { Object.assign(order, data); return { count: 1 } }),
      findUniqueOrThrow: vi.fn(async () => order),
    },
    payment: { findUnique: vi.fn().mockResolvedValue(null), create: vi.fn().mockResolvedValue({ id: 'payment-1' }), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    systemParameter: { findFirst: vi.fn().mockResolvedValue({ value: 10 }) },
    account: { findUnique: vi.fn().mockResolvedValue({ id: 'account-1', balance: 2000, frozenBalance: 1500, version: 1 }), updateMany: vi.fn() },
    accountTransaction: { create: vi.fn() },
    trainingEnrollment: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    memberSubscription: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    courtBooking: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    couponCode: { findUnique: vi.fn().mockResolvedValue(null) },
    inventoryItem: { findMany: vi.fn().mockResolvedValue([{ id: 'goods-1', name: '羽毛球', stock: 10 }]) },
    auditLog: { create: vi.fn().mockResolvedValue({}) },
    event: { findUnique: vi.fn().mockResolvedValue({ id: 'event-1', status: 'COMPLETED' }) },
    eventTeam: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    game: { findUnique: vi.fn().mockResolvedValue({ id: 'game-1', status: 'OPEN', capacity: 4 }), updateMany: vi.fn() },
    gameRegistration: { updateMany: vi.fn().mockResolvedValue({ count: 1 }), count: vi.fn().mockResolvedValue(0), findFirst: vi.fn().mockResolvedValue(null) },
  }
  const prisma: any = { ...tx, order: { ...tx.order, findMany: vi.fn().mockResolvedValue([]) },
    $transaction: vi.fn(async callback => callback(tx)) }
  const closeOrder = vi.fn().mockResolvedValue({})
  const service = new OrdersService(prisma, { get: () => 'wechat' } as never, {} as never, { closeOrder } as never)
  return { service, order, tx, prisma, closeOrder }
}
describe('purchase cancellation and expiry', () => {
  it.each(['MEMBERSHIP','RECHARGE','GOODS','TRAINING'])('cancels %s atomically without moving money or inventory', async type => {
    const { service, tx } = setup(type)
    expect(await service.cancelPending('order-1', { idempotencyKey: 'cancel-first-1' }, actor)).toMatchObject({ status: 'CANCELLED' })
    await service.cancelPending('order-1', { idempotencyKey: 'cancel-first-1' }, actor)
    expect(tx.order.updateMany).toHaveBeenCalledOnce()
    expect(tx.auditLog.create).toHaveBeenCalledOnce()
    expect(tx.account.updateMany).not.toHaveBeenCalled()
    expect(tx.courtBooking.updateMany).not.toHaveBeenCalled()
    if (type === 'TRAINING') expect(tx.trainingEnrollment.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { status: 'CANCELLED', seatReservedUntil: null } }))
    if (type === 'MEMBERSHIP') expect(tx.memberSubscription.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { status: 'CANCELLED' } }))
  })
  it('does not allow another member to cancel', async () => {
    const { service, tx } = setup()
    await expect(service.cancelPending('order-1', { idempotencyKey: 'cancel-other-1' }, { ...actor, sub: 'other' })).rejects.toThrow('仅会员本人')
    expect(tx.order.updateMany).not.toHaveBeenCalled()
  })
  it('leaves event team cleanup in its domain workflow', async () => {
    const { service } = setup('EVENT')
    await expect(service.cancelPending('order-1', { idempotencyKey: 'cancel-event-1' }, actor)).rejects.toThrow('赛事报名详情')
  })
  it('does not locally cancel when WeChat cannot close a processing payment', async () => {
    const { service, tx, closeOrder } = setup('GOODS', { payments: [{ status: 'PROCESSING', channel: 'WECHAT' }] })
    closeOrder.mockRejectedValue(new Error('已支付，等待同步'))
    await expect(service.cancelPending('order-1', { idempotencyKey: 'cancel-wx-1' }, actor)).rejects.toThrow('已支付')
    expect(tx.order.updateMany).not.toHaveBeenCalled()
  })
  it('rechecks a concurrent payment before any release', async () => {
    const { service, tx, prisma, order } = setup('TRAINING')
    prisma.order.findUnique = vi.fn().mockResolvedValue(order)
    tx.order.findUnique.mockResolvedValue({ ...order, status: 'PAID' })
    await expect(service.cancelPending('order-1', { idempotencyKey: 'cancel-race-1' }, actor)).rejects.toThrow('状态已经变化')
    expect(tx.trainingEnrollment.updateMany).not.toHaveBeenCalled()
  })
  it('automatically closes a timed-out purchase with a system audit', async () => {
    const { service, prisma, order, tx } = setup('GOODS', { createdAt: new Date(Date.now() - 16 * 60000) })
    prisma.order.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([order])
    expect(await service.expirePendingOrders()).toBe(1)
    expect(tx.auditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ actorId: undefined, action: 'GOODS_ORDER_AUTO_CANCELLED' }) })
  })
  it('auto-cancel of a game releases only its seat, never its courts', async () => {
    const { service, prisma, order, tx } = setup('GAME', { createdAt: new Date(Date.now() - 16 * 60000), gameRegistration: { id: 'registration-1', gameId: 'game-1', status: 'REGISTERED' } })
    prisma.order.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([order])
    expect(await service.expirePendingOrders()).toBe(1)
    expect(tx.gameRegistration.updateMany).toHaveBeenCalledOnce()
    expect(tx.courtBooking.updateMany).not.toHaveBeenCalled()
  })
  it('expires an event reservation through remote-close-safe cancellation', async () => {
    const { service, prisma, order, tx, closeOrder } = setup('EVENT', {
      payments: [{ status: 'PROCESSING', channel: 'WECHAT' }],
      eventTeam: { id: 'team-1', eventId: 'event-1', status: 'REGISTERED', paymentDueAt: new Date(Date.now() - 60000) },
    })
    prisma.order.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([order])
    expect(await service.expirePendingOrders()).toBe(1)
    expect(closeOrder).toHaveBeenCalledOnce()
    expect(tx.eventTeam.updateMany).toHaveBeenCalledOnce()
    expect(tx.courtBooking.updateMany).not.toHaveBeenCalled()
  })
  it('uses domain deadlines before the generic 15 minute fallback', () => {
    const createdAt = new Date('2026-09-05T01:00:00Z')
    expect(pendingPaymentDeadline({ status: 'PENDING', businessType: 'GOODS', createdAt })?.toISOString()).toBe('2026-09-05T01:15:00.000Z')
    expect(pendingPaymentDeadline({ status: 'PAID', businessType: 'GOODS', createdAt })).toBeNull()
    expect(pendingPaymentDeadline({ status: 'PENDING', businessType: 'TRAINING', createdAt, trainingEnrollment: { seatReservedUntil: '2026-09-05T01:30:00Z' } })?.toISOString()).toBe('2026-09-05T01:30:00.000Z')
  })
})
describe('order payment preflight', () => {
  it('uses current coin parameter and excludes frozen balances without leaking account identity', async () => {
    const { service, tx } = setup('MEMBERSHIP')
    const result = await service.paymentOptions('order-1', actor)
    expect(result.options.find(item => item.channel === 'BADMINTON_COIN')).toMatchObject({ debitAmount: 101, availableBalance: 101, enabled: true })
    expect(result.options.find(item => item.channel === 'CASH_PRINCIPAL')).toMatchObject({ availableBalance: 500, enabled: false })
    expect(JSON.stringify(result)).not.toContain('private-open-id')
    expect(tx.order.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'order-1', memberId: actor.sub } }))
    expect(tx.order.updateMany).not.toHaveBeenCalled()
  })
  it('never offers balance-funded recharge', async () => {
    const { service } = setup()
    const result = await service.paymentOptions('order-1', actor)
    expect(result.options.filter(item => item.enabled).map(item => item.channel)).toEqual(['WECHAT'])
  })
  it('returns a stock failure before trying to pay', async () => {
    const { service, tx } = setup('GOODS')
    tx.inventoryItem.findMany.mockResolvedValue([{ id: 'goods-1', name: '羽毛球', stock: 0 }])
    expect((await service.paymentOptions('order-1', actor)).options.every(item => !item.enabled && item.reason.includes('库存不足'))).toBe(true)
  })
  it('disables expired orders and non-linked WeChat accounts', async () => {
    const { service, order } = setup('RECHARGE', { createdAt: new Date(0) })
    expect((await service.paymentOptions(order.id, actor)).options.every(item => !item.enabled)).toBe(true)
    order.createdAt = new Date(); order.member.openId = null
    expect((await service.paymentOptions(order.id, actor)).options[0].reason).toContain('微信登录')
  })
  it('disables alternate channels while a WeChat payment is processing', async () => {
    const { service } = setup('MEMBERSHIP', { payments: [{ channel: 'WECHAT', status: 'PROCESSING' }] })
    expect((await service.paymentOptions('order-1', actor)).options.filter(item => item.enabled).map(item => item.channel)).toEqual(['WECHAT'])
  })
  it('rejects a changed coin quote before debiting', async () => {
    const { service, tx } = setup('MEMBERSHIP')
    await expect(service.pay('order-1', { channel: PaymentChannel.BADMINTON_COIN, idempotencyKey: 'quote-test-1', expectedDebitAmount: 100 }, actor)).rejects.toThrow('报价已变化')
    expect(tx.account.updateMany).not.toHaveBeenCalled()
  })
  it('payment command cannot spend frozen cash even without a quote', async () => {
    const { service, tx } = setup('MEMBERSHIP')
    await expect(service.pay('order-1', { channel: PaymentChannel.CASH_PRINCIPAL, idempotencyKey: 'frozen-test-1' }, actor)).rejects.toThrow('账户余额不足')
    expect(tx.account.updateMany).not.toHaveBeenCalled()
  })
  it('blocks old pending venue orders using a merchant-only coupon', async () => {
    const { service, tx } = setup('VENUE', { parameterSnapshot: { couponId: 'coupon-1' } })
    tx.couponCode.findUnique.mockResolvedValue({ template: { code: 'COFFEE', allowVenueBooking: false } })
    expect((await service.paymentOptions('order-1', actor)).options.every(item => !item.enabled && item.reason.includes('商户券'))).toBe(true)
    await expect(service.pay('order-1', { channel: PaymentChannel.WECHAT, idempotencyKey: 'old-coupon-1' }, actor)).rejects.toThrow('商户券')
    expect(tx.payment.create).not.toHaveBeenCalled()
  })
  it('validates quote amounts at the request boundary', async () => {
    for (const value of [-1, 1.5, 'n/a']) {
      expect((await validate(plainToInstance(PayOrderDto, { channel: 'WECHAT', idempotencyKey: 'valid-key', expectedDebitAmount: value }))).length).toBeGreaterThan(0)
    }
  })
})
