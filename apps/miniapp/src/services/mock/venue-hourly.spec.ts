import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mockRequest } from './router'
import { mockLogin, mockUser } from './core'
import { availability, getOrders } from './venue'
import { getPriceRules, savePriceRules, saveVenueBookings } from './state'

const storage = new Map<string, any>()
vi.stubGlobal('uni', { getStorageSync: (key: string) => storage.get(key) ?? '', setStorageSync: (key: string, value: unknown) => storage.set(key, value), removeStorageSync: (key: string) => storage.delete(key) })
const date = '2090-09-07'
describe('hourly venue booking', () => {
  beforeEach(() => { storage.clear(); mockLogin('MEMBER') })
  it.each(['ADMIN', 'SUPER_ADMIN', 'FRONT_DESK'] as const)('lets %s book personally without selecting a customer or opening a shift', async role => {
    mockLogin(role)
    const response = await mockRequest<any>('POST', '/venues/bookings', { date, courtId: 'court-1', slotId: 'slot-H09', sourceChannel: 'MINI_PROGRAM', creationIdempotencyKey: 'staff-personal-' + role })
    const order = getOrders().find(item => item.id === response.id)
    expect(order?.memberId).toBe(mockUser().id)
    expect(order?.parameterSnapshot.operatorAssisted).toBe(false)
    expect(order?.createdById).toBe(mockUser().id)
  })
  it('filters and paginates the assisted-booking member directory', async () => {
    mockLogin('SUPER_ADMIN')
    const filtered = await mockRequest<any>('GET', '/members', { keyword: '小周', page: 1, pageSize: 20 })
    expect(filtered.items.map((member: any) => member.id)).toEqual(['member-2'])
    expect(filtered.total).toBe(1)
    const second = await mockRequest<any>('GET', '/members', { page: 2, pageSize: 1 })
    expect(second.items.map((member: any) => member.id)).toEqual(['member-2'])
    expect(second.total).toBe(2)
    mockLogin('FRONT_DESK')
    const byPhone = await mockRequest<any>('GET', '/members', { keyword: '13800000007' })
    expect(byPhone.items.map((member: any) => member.id)).toEqual(['member-2'])
    expect(byPhone.items[0].phone).not.toBe('13800000007')
  })
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
  it.each(['ADMIN', 'SUPER_ADMIN', 'FRONT_DESK'] as const)('lets %s create a reasoned past booking for a member while preserving occupancy', async role => {
    mockLogin(role)
    if (role === 'FRONT_DESK') await mockRequest('POST', '/operations/shifts/open', { openingCashCents: 0 })
    const command = { date: '2026-09-01', courtId: 'court-1', slotId: 'slot-H09', memberId: 'member-2', sourceChannel: 'STORE_VISIT', overrideReason: '补录已协调同场使用', creationIdempotencyKey: 'past-override-first' }
    const first = await mockRequest<any>('POST', '/venues/bookings', command)
    expect(first.bookings[0].operatorOverride).toBe(true)
    expect(first.bookings[0].overrideReason).toBeUndefined()
    expect((await mockRequest<any>('POST', '/venues/bookings', command)).id).toBe(first.id)
    const second = await mockRequest<any>('POST', '/venues/bookings', { ...command, creationIdempotencyKey: 'past-override-second' })
    expect(second.id).not.toBe(first.id)
    expect(getOrders().find(o => o.id === first.id)?.status).toBe('PENDING')
    expect(getOrders().find(o => o.id === second.id)?.parameterSnapshot.assistedBookingOverride.actorId).toBe(mockUser().id)
    await expect(mockRequest('POST', '/venues/bookings', { ...command, creationIdempotencyKey: 'past-self', memberId: undefined, sourceChannel: 'MINI_PROGRAM' })).rejects.toThrow('代会员')
  })
  it('does not grant exception discovery or booking to a member', async () => {
    await expect(mockRequest('GET', '/venues/availability/assisted', { date })).rejects.toThrow()
    await expect(mockRequest('POST', '/venues/bookings', { date, courtId: 'court-1', slotId: 'slot-H09', overrideReason: '自行跳过限制' })).rejects.toThrow('代会员')
  })
  it('selects a noon price change using the actual hour', () => {
    const rules = getPriceRules().filter(rule => rule.timeSlotId !== 'slot-H18')
    const base = { timeSlotId: 'slot-H18', weekdayMask: 127, enabled: true, version: 1 }
    savePriceRules([...rules, { ...base, id: 'old', code: 'old', effectiveFrom: '2020-01-01T00:00:00+08:00', effectiveTo: date + 'T12:00:00+08:00', priceCents: 5000 }, { ...base, id: 'new', code: 'new', effectiveFrom: date + 'T12:00:00+08:00', priceCents: 8000 }])
    expect(availability(date).slots.find(slot => slot.id === 'slot-H18')?.price?.priceCents).toBe(8000)
  })

})
