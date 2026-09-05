import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mockRequest } from './router'
import { resetCatalogState, getMemberAccounts, getMemberAccountTransactions } from './state'
const storage = new Map<string, any>()
vi.stubGlobal('uni', { getStorageSync: (key: string) => storage.get(key) ?? '', setStorageSync: (key: string, value: unknown) => storage.set(key, value), removeStorageSync: (key: string) => storage.delete(key) })
const request = (method: string, url: string, data: any = {}) => mockRequest<any>(method, url, data)
const login = (role: string) => request('POST', '/auth/dev-login', { role })
const order = (type = 'MEMBERSHIP') => ({ id: 'closeout-order', orderNo: 'CLOSEOUT-1', title: '验收订单', memberId: 'user-member', businessType: type, status: 'PENDING', payableCents: 1000, paidCents: 0, refundedCents: 0, createdAt: new Date().toISOString(), parameterSnapshot: {}, membership: { status: 'FROZEN' } })
describe('journey closeout mock contracts', () => {
  beforeEach(async () => { storage.clear(); resetCatalogState(); await login('MEMBER') })
  it('returns selectable staff names with string roles and no private profile fields', async () => {
    await login('FRONT_DESK')
    const result = await request('GET', '/members/leads/owners')
    expect(result.items.length).toBeGreaterThan(0)
    expect(result.items.every((item: any) => item.roles.length && item.roles.every((role: any) => typeof role === 'string'))).toBe(true)
    expect(Object.keys(result.items[0]).sort()).toEqual(['displayName', 'id', 'roles'])
  })
  it('denies the staff directory to ordinary members', async () => {
    await expect(request('GET', '/members/leads/owners')).rejects.toThrow()
  })
  it('cancels unpaid memberships and expires unpaid purchases without changing assets', async () => {
    storage.set('yanqing_mock_orders', [order()])
    const before = JSON.stringify(getMemberAccounts())
    await request('POST', '/orders/closeout-order/cancel', { reason: '行程有变', idempotencyKey: 'cancel-closeout' })
    expect(storage.get('yanqing_mock_orders')[0].membership.status).toBe('CANCELLED')
    storage.set('yanqing_mock_orders', [{ ...order('RECHARGE'), createdAt: new Date(Date.now() - 16 * 60_000).toISOString() }])
    await request('GET', '/orders')
    expect(storage.get('yanqing_mock_orders')[0].status).toBe('CANCELLED')
    expect(JSON.stringify(getMemberAccounts())).toBe(before)
  })
  it('debits and refunds the original balance exactly once through independent approval', async () => {
    const created = await request('POST', '/memberships/purchase', { productId: 'member-regular', creationIdempotencyKey: 'closeout-purchase' })
    const quote = await request('GET', '/orders/' + created.id + '/payment-options')
    const choice = quote.options.find((item: any) => item.channel === 'CASH_PRINCIPAL')
    const before = choice.availableBalance
    await request('POST', '/orders/' + created.id + '/pay', { channel: choice.channel, expectedDebitAmount: choice.debitAmount, idempotencyKey: 'closeout-pay' })
    expect(getMemberAccounts()['user-member'].find(item => item.type === choice.channel)?.balance).toBe(before - choice.debitAmount)
    const refund = await request('POST', '/orders/' + created.id + '/refunds', { reason: '行程有变', idempotencyKey: 'closeout-refund' })
    await login('FINANCE')
    await request('POST', '/orders/refunds/' + refund.id + '/approve', { reason: '核对原交易后批准' })
    await request('POST', '/orders/refunds/' + refund.id + '/approve', { reason: '重试' })
    expect(getMemberAccounts()['user-member'].find(item => item.type === choice.channel)?.balance).toBe(before)
    expect(getMemberAccountTransactions().filter(item => item.reasonCode === 'ORDER_REFUND')).toHaveLength(1)
  })
})
