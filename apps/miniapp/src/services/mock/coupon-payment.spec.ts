import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mockRequest } from './router'
import { mockLogin, mockUser } from './core'
import { getCoupons, saveCoupons, getCouponTemplates, saveCouponTemplates, getMerchants } from './state'
const storage = new Map<string, any>()
vi.stubGlobal('uni', { getStorageSync: (key: string) => storage.get(key) ?? '', setStorageSync: (key: string, value: unknown) => storage.set(key, value), removeStorageSync: (key: string) => storage.delete(key) })
beforeEach(() => {
  storage.clear(); mockLogin('MEMBER')
  const merchantId = getMerchants()[0].id
  saveCouponTemplates([{ id: 'coupon-template-test', code: 'VENUE_COUPON_TEST', merchantId, enabled: true, allowVenueBooking: true, faceValueCents: 1000,
    validFrom: '2020-01-01', validTo: '2091-01-01', redeemedCount: 0 }])
  saveCoupons([{ id: 'coupon-test', code: 'coupon-code-test', templateId: 'coupon-template-test', merchantId, holderId: mockUser().id, status: 'CLAIMED', expiresAt: '2091-01-01' }])
})
const book = (courtId: string, suffix: string) => mockRequest<any>('POST', '/venues/bookings', { date: '2090-09-07', courtId, slotId: 'slot-H07', sourceChannel: 'MINI_PROGRAM', couponCode: 'coupon-code-test', creationIdempotencyKey: 'coupon-book-' + suffix })
const pay = (id: string) => mockRequest<any>('POST', `/orders/${id}/pay`, { channel: 'WECHAT', idempotencyKey: 'coupon-pay-' + id })
describe('mock coupon payment boundaries', () => {
  it('uses a coupon once and blocks a second pending order without changing the first', async () => {
    const a = await book('court-1', 'a'), b = await book('court-3', 'b')
    await pay(a.id); await pay(a.id)
    const quote = await mockRequest<any>('GET', `/orders/${b.id}/payment-options`)
    expect(quote.options.every((row: any) => !row.enabled)).toBe(true)
    await expect(pay(b.id)).rejects.toThrow('优惠券')
    expect(getCoupons()[0]).toMatchObject({ status: 'REDEEMED', attributionOrderId: a.id })
    expect(getCouponTemplates()[0].redeemedCount).toBe(1)
  })
  it('restores a coupon after cancelling a confirmed fully discounted booking', async () => {
    saveCouponTemplates(getCouponTemplates().map(row => ({ ...row, faceValueCents: 3000 })))
    const a = await book('court-1', 'free')
    expect(a.payableCents).toBe(0)
    await pay(a.id)
    await mockRequest('POST', `/orders/${a.id}/cancel`, { reason: '取消免费预约', idempotencyKey: 'coupon-free-cancel' })
    expect(getCoupons()[0]).toMatchObject({ status: 'CLAIMED', attributionOrderId: null })
    expect(getCouponTemplates()[0].redeemedCount).toBe(0)
    expect(await book('court-1', 'again')).toMatchObject({ payableCents: 0 })
  })
})
