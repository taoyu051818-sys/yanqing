// Only pre-filter known-invalid coupons. Price and period rules remain server-owned.
export function selectableBookingCoupons(coupons: any[], now = Date.now()) {
  return coupons.filter(coupon => {
    const template = coupon.template
    return coupon.status === 'CLAIMED' && Boolean(coupon.code) && new Date(coupon.expiresAt).getTime() > now &&
      template && (coupon.bookingUsage ? coupon.bookingUsage.eligible : template.allowVenueBooking === true || template.code?.startsWith('NEWCOMER')) && template.enabled !== false &&
      (!template.validFrom || new Date(template.validFrom).getTime() <= now) &&
      (!template.validTo || new Date(template.validTo).getTime() > now) &&
      (!template.merchant?.status || template.merchant.status === 'ACTIVE')
  })
}
