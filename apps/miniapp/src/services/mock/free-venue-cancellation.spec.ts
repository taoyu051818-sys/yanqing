import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mockRequest } from './router'
import { mockLogin } from './core'
import { getOrders } from './venue'
import { getPriceRules, savePriceRules, getVenueBookings, saveVenueBookings } from './state'
const storage = new Map<string, any>()
vi.stubGlobal('uni', { getStorageSync: (key: string) => storage.get(key) ?? '', setStorageSync: (key: string, value: unknown) => storage.set(key, value), removeStorageSync: (key: string) => storage.delete(key) })
const command = { date: '2090-09-07', courtId: 'court-1', slotId: 'slot-H07', sourceChannel: 'MINI_PROGRAM', creationIdempotencyKey: 'free-venue-create' }
beforeEach(() => { storage.clear(); mockLogin('MEMBER'); savePriceRules(getPriceRules().map(row => ({ ...row, priceCents: 0, newcomerPriceCents: 0 }))) })
async function book() {
  const order = await mockRequest<any>('POST', '/venues/bookings', command)
  expect(order.payableCents).toBe(0)
  await mockRequest('POST', `/orders/${order.id}/pay`, { channel: 'WECHAT', idempotencyKey: 'free-venue-pay', expectedDebitAmount: 0 })
  return order.id
}
const cancel = (id: string) => mockRequest<any>('POST', `/orders/${id}/cancel`, { reason: '会员取消免费预约', idempotencyKey: 'free-venue-cancel' })
describe('mock free venue cancellation', () => {
  it('releases the slot and retains zero confirmation evidence after retries', async () => {
    const id = await book()
    expect(await cancel(id)).toMatchObject({ status: 'CANCELLED' })
    expect(await cancel(id)).toMatchObject({ status: 'CANCELLED' })
    expect(getOrders().find(row => row.id === id)).toMatchObject({ status: 'CANCELLED', paidCents: 0, paymentStatus: 'SUCCEEDED' })
    expect(getVenueBookings().find(row => row.orderId === id)?.status).toBe('CANCELLED')
    expect(await mockRequest<any>('POST', '/venues/bookings', { ...command, creationIdempotencyKey: 'free-venue-rebook' })).toMatchObject({ status: 'PENDING' })
  })
  it.each(['started', 'checked'])('rejects a %s booking', async mode => {
    const id = await book()
    saveVenueBookings(getVenueBookings().map(row => row.orderId === id ? { ...row, ...(mode === 'started' ? { startsAt: new Date(Date.now() - 1).toISOString() } : { status: 'CHECKED_IN' }) } : row))
    await expect(cancel(id)).rejects.toThrow('仅未开始')
    expect(getOrders().find(row => row.id === id)?.status).toBe('PAID')
  })
})
