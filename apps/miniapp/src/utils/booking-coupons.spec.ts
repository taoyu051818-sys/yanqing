import { describe, expect, it } from 'vitest'
import { selectableBookingCoupons } from './booking-coupons'
const now = Date.parse('2026-09-05T10:00:00Z')
const coupon = (overrides: Record<string, any> = {}) => ({
  id: 'owned', code: 'SAFE-CODE', status: 'CLAIMED', expiresAt: '2026-10-01T00:00:00Z',
  template: { allowVenueBooking: true, enabled: true, validFrom: '2026-09-01T00:00:00Z', validTo: '2026-10-01T00:00:00Z', merchant: { status: 'ACTIVE' } },
  ...overrides,
})
describe('booking coupon choices', () => {
  it('accepts a claimed unexpired coupon without estimating server-owned prices', () => {
    expect(selectableBookingCoupons([coupon()], now)).toHaveLength(1)
  })
  it.each(['AVAILABLE', 'REDEEMED', 'EXPIRED', 'VOIDED'])('excludes %s coupons', status => {
    expect(selectableBookingCoupons([coupon({ status })], now)).toEqual([])
  })
  it('rejects merchant-only coupons even when already claimed', () => {
    const current = coupon(); current.template.allowVenueBooking = false
    expect(selectableBookingCoupons([current], now)).toEqual([])
  })
  it('rejects expiry boundary, malformed dates, missing codes and disabled partners', () => {
    for (const value of [
      coupon({ expiresAt: new Date(now).toISOString() }),
      coupon({ expiresAt: 'bad date' }), coupon({ code: '' }),
      coupon({ template: { enabled: false } }),
      coupon({ template: { merchant: { status: 'DISABLED' } } }),
      coupon({ template: { validFrom: '2026-09-06T00:00:00Z' } }),
      coupon({ template: { validTo: new Date(now).toISOString() } }),
    ]) expect(selectableBookingCoupons([value], now)).toEqual([])
  })
})
