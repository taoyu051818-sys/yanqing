import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mockRequest } from './router'
import { mockLogin } from './core'
import { availability, getOrders } from './venue'
import { getPriceRules, savePriceRules, saveVenueBookings } from './state'

const storage = new Map<string, any>()
vi.stubGlobal('uni', { getStorageSync: (key: string) => storage.get(key) ?? '', setStorageSync: (key: string, value: unknown) => storage.set(key, value), removeStorageSync: (key: string) => storage.delete(key) })
const date = '2090-09-07'
describe('hourly venue booking', () => {
  beforeEach(() => { storage.clear(); mockLogin('MEMBER') })
  it('offers 17 continuous one-hour slots with hourly tariffs including midnight', () => {
    const { slots } = availability(date)
    expect(slots).toHaveLength(17)
    slots.forEach((slot, index) => {
      expect(slot.startMinutes).toBe((7 + index) * 60)
      expect(slot.endMinutes - slot.startMinutes).toBe(60)
      expect(slot.price?.priceCents).toBeGreaterThan(0)
    })
    expect(slots[0].price?.priceCents).toBe(3000)
    expect(slots[16].endMinutes).toBe(1440)
  })
  it('creates one hour, rejects a duplicate, allows the adjacent hour and frees a cancelled hour', async () => {
    const create = (slotId: string, key: string) => mockRequest('POST', '/venues/bookings', { date, courtId: 'court-1', slotId, sourceChannel: 'MINI_PROGRAM', creationIdempotencyKey: key }) as Promise<any>
    const first = await create('slot-H07', 'hourly-first-booking')
    expect(first.payableCents).toBe(3000)
    expect(new Date(first.bookings[0].endsAt).getTime() - new Date(first.bookings[0].startsAt).getTime()).toBe(3_600_000)
    await expect(create('slot-H07', 'hourly-duplicate-booking')).rejects.toThrow('预订')
    const second = await create('slot-H08', 'hourly-adjacent-booking')
    expect(second.id).not.toBe(first.id)
    await mockRequest('POST', `/orders/${first.id}/cancel`, { reason: '小时预约取消测试', idempotencyKey: 'hourly-cancel-first' })
    expect((await create('slot-H07', 'hourly-rebook-freed')).id).not.toBe(first.id)
    expect(getOrders().find(order => order.id === second.id)?.status).toBe('PENDING')
    const midnight = await create('slot-H23', 'hourly-midnight-booking')
    expect(midnight.bookings[0].endsAt).toBe('2090-09-07T16:00:00.000Z')
  })
  it('keeps a legacy two-hour reservation blocking both new hours', async () => {
    saveVenueBookings([{ id: 'historical', courtId: 'court-1', status: 'CONFIRMED', startsAt: `${date}T09:00:00+08:00`, endsAt: `${date}T11:00:00+08:00` }])
    for (const slotId of ['slot-H09', 'slot-H10']) {
      await expect(mockRequest('POST', '/venues/bookings', { date, courtId: 'court-1', slotId, sourceChannel: 'MINI_PROGRAM', creationIdempotencyKey: `legacy-overlap-${slotId}` })).rejects.toThrow('预订')
    }
  })
  it('upgrades persisted mock prices once without resetting historical bookings or money', () => {
    const original = [{ id: 'legacy-order', payableCents: 6801, status: 'PAID' }]
    storage.set('yanqing_mock_orders', original)
    savePriceRules([{ id: 'legacy-price', code: 'PRICE_S1', timeSlotId: 'slot-1', priceCents: 6801, newcomerPriceCents: null, version: 3, enabled: true }])
    const rules = getPriceRules()
    expect(rules.filter(rule => ['slot-H07', 'slot-H08'].includes(rule.timeSlotId)).map(rule => rule.priceCents)).toEqual([3400, 3401])
    expect(rules[0].newcomerPriceCents).toBeNull()
    expect(getPriceRules()).toEqual(rules)
    expect(storage.get('yanqing_mock_orders')).toEqual(original)
  })
})
