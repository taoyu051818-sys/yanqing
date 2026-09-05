import type { CourtAvailability } from '../../types/domain'
import { getPriceRules, getVenueBookings, getVenueClosures, saveVenueBookings } from './state'
import { hourlyVenueSlots } from './venue-catalog'

export function availability(date: string): CourtAvailability {
  const courts = getMockVenueCourts().map((court) => ({
    id: court.id,
    name: court.name,
    usage: court.usage,
    enabled: court.enabled,
  }))
  const slots = hourlyVenueSlots.map((slot) => {
    const rule = resolveMockPriceRule(date, slot.id)
    return {
      id: slot.id,
      label: slot.label,
      startMinutes: slot.startMinutes,
      endMinutes: slot.endMinutes,
      period: slot.period,
      enabled: true,
      price: rule ? {
        priceCents: rule.priceCents,
        newcomerPriceCents: rule.newcomerPriceCents,
      } : undefined,
    }
  })
  const seedBookings: any[] = [
    { courtId: 'court-2', startsAt: `${date}T09:00:00+08:00`, endsAt: `${date}T11:00:00+08:00`, status: 'CONFIRMED', usage: 'PUBLIC' },
    { courtId: 'court-8', startsAt: `${date}T19:00:00+08:00`, endsAt: `${date}T21:00:00+08:00`, status: 'CONFIRMED', usage: 'PUBLIC' },
  ]
  // getOrders performs the shared mock expiry transition before availability
  // reads the booking ledger, keeping both views consistent.
  getOrders()
  const dayStart = new Date(`${date}T00:00:00+08:00`).getTime()
  const dayEnd = dayStart + 86_400_000
  const persisted = getVenueBookings()
  const activePersisted = persisted.filter((booking) => {
    if (booking.status === 'CANCELLED') return false
    return new Date(booking.startsAt).getTime() < dayEnd && new Date(booking.endsAt).getTime() > dayStart
  })
  const bookings = [...seedBookings, ...activePersisted].map((booking) => ({
    courtId: booking.courtId,
    startsAt: booking.startsAt,
    endsAt: booking.endsAt,
    status: booking.status,
    usage: booking.usage,
  }))
  const closures = getVenueClosures()
    .filter((closure) =>
      closure.status === 'ACTIVE' &&
      new Date(closure.startsAt).getTime() < dayEnd &&
      new Date(closure.endsAt).getTime() > dayStart,
    )
    .map((closure) => ({
      courtId: closure.courtId,
      startsAt: closure.startsAt,
      endsAt: closure.endsAt,
      status: closure.status,
    })) as CourtAvailability['closures']
  return { date, courts, slots, bookings, closures }
}

export function getMockVenueCourts() {
  return Array.from({ length: 20 }, (_, index) => ({
    id: `court-${index + 1}`,
    code: `C${String(index + 1).padStart(2, '0')}`,
    number: index + 1,
    name: `${index + 1}号场`,
    usage: index < 16 ? 'PUBLIC' : 'TRAINING',
    enabled: true,
  }))
}

export function resolveMockPriceRule(date: string, slotId: string) {
  const pricingAt = new Date(`${date}T00:00:00+08:00`).getTime()
  const weekdayBit = 1 << new Date(`${date}T00:00:00Z`).getUTCDay()
  return getPriceRules()
    .filter((candidate) =>
      candidate.enabled === true &&
      (candidate.timeSlotId === slotId || candidate.timeSlotId == null) &&
      new Date(candidate.effectiveFrom).getTime() <= pricingAt &&
      (!candidate.effectiveTo || new Date(candidate.effectiveTo).getTime() > pricingAt) &&
      (Number(candidate.weekdayMask) & weekdayBit) !== 0,
    )
    .sort((left, right) =>
      Number(Boolean(right.timeSlotId)) - Number(Boolean(left.timeSlotId)) ||
      new Date(right.effectiveFrom).getTime() - new Date(left.effectiveFrom).getTime() ||
      Number(right.version) - Number(left.version),
    )[0]
}

export const seedOrders = [
  { id: 'order-venue-1', orderNo: 'YQ202608290001', title: '3号场 · 晚场一', status: 'PAID', businessType: 'VENUE', payableCents: 8800, paidCents: 8800, refundedCents: 0, createdAt: new Date().toISOString(), member: { displayName: '延庆会员小林' } },
  { id: 'order-training-1', orderNo: 'YQ202608290002', title: '成人进阶双打课包', status: 'PENDING', businessType: 'TRAINING', payableCents: 128000, paidCents: 0, refundedCents: 0, createdAt: new Date(Date.now() - 86400000).toISOString(), member: { displayName: '延庆会员小林' } },
]

export function getOrders() {
  const orders = (uni.getStorageSync('yanqing_mock_orders') as any[]) || seedOrders.map((item) => ({ ...item }))
  const now = Date.now()
  const bookings = getVenueBookings()
  const expiredOrderIds = new Set(
    bookings
      .filter((booking: any) =>
        booking.status === 'HELD' &&
        booking.holdExpiresAt &&
        new Date(booking.holdExpiresAt).getTime() <= now,
      )
      .map((booking: any) => booking.orderId)
      .filter(Boolean),
  )
  if (!expiredOrderIds.size) return orders
  const cancelledAt = new Date(now).toISOString()
  const updatedOrders = orders.map((order) =>
    expiredOrderIds.has(order.id) && order.status === 'PENDING'
      ? {
          ...order,
          status: 'CANCELLED',
          cancelledAt,
          bookings: (order.bookings || []).map((booking: any) => ({
            ...booking,
            status: booking.status === 'HELD' ? 'CANCELLED' : booking.status,
            holdExpiresAt: null,
          })),
        }
      : order,
  )
  uni.setStorageSync('yanqing_mock_orders', updatedOrders)
  saveVenueBookings(bookings.map((booking: any) =>
    expiredOrderIds.has(booking.orderId) && booking.status === 'HELD'
      ? { ...booking, status: 'CANCELLED', holdExpiresAt: null }
      : booking,
  ))
  return updatedOrders
}

export function saveOrders(orders: any[]) { uni.setStorageSync('yanqing_mock_orders', orders) }
