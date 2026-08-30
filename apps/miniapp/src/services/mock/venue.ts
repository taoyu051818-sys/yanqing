import type { CourtAvailability } from '../../types/domain'
import { getVenueBookings, getVenueClosures, saveVenueBookings } from './state'

const slotLabels = ['晨练', '上午一', '上午二', '午间', '下午一', '下午二', '晚场一', '晚场二']

function shanghaiDate(value: unknown): string {
  const date = new Date(String(value || ''))
  if (Number.isNaN(date.getTime())) return ''
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return `${values.year}-${values.month}-${values.day}`
}

export function availability(date: string): CourtAvailability {
  const courts = Array.from({ length: 20 }, (_, index) => ({
    id: `court-${index + 1}`,
    code: `C${String(index + 1).padStart(2, '0')}`,
    number: index + 1,
    name: `${index + 1}号场`,
    usage: index < 16 ? 'PUBLIC' : 'TRAINING',
    enabled: true,
  }))
  const starts = [420, 540, 660, 780, 900, 1020, 1140, 1260]
  const slots = starts.map((startMinutes, index) => ({
    id: `slot-${index + 1}`,
    code: `S${index + 1}`,
    label: slotLabels[index],
    startMinutes,
    endMinutes: startMinutes + 120,
    price: { priceCents: index >= 6 ? 8800 : 6800, newcomerPriceCents: index === 0 ? 4800 : null },
  }))
  const seedBookings: any[] = [
    { courtId: 'court-2', startsAt: `${date}T09:00:00+08:00`, endsAt: `${date}T11:00:00+08:00`, status: 'CONFIRMED', usage: 'PUBLIC' },
    { courtId: 'court-8', startsAt: `${date}T19:00:00+08:00`, endsAt: `${date}T21:00:00+08:00`, status: 'CONFIRMED', usage: 'PUBLIC' },
  ]
  const now = Date.now()
  const persisted = getVenueBookings()
  // A held booking has a ten-minute expiry just like the API.  Prune expired
  // holds on read so retries cannot permanently hide a court slot.
  const activePersisted = persisted.filter((booking) => {
    if (booking.status === 'CANCELLED') return false
    if (booking.status === 'HELD' && booking.holdExpiresAt && new Date(booking.holdExpiresAt).getTime() <= now) return false
    return shanghaiDate(booking.startsAt) === date
  })
  if (activePersisted.length !== persisted.filter((booking) => booking.status !== 'CANCELLED').length) {
    saveVenueBookings(persisted.filter((booking) => booking.status !== 'CANCELLED' && !(booking.status === 'HELD' && booking.holdExpiresAt && new Date(booking.holdExpiresAt).getTime() <= now)))
  }
  const bookings = [...seedBookings, ...activePersisted]
  const dayStart = new Date(`${date}T00:00:00+08:00`).getTime()
  const dayEnd = dayStart + 86_400_000
  const closures = getVenueClosures().filter((closure) =>
    closure.status === 'ACTIVE' &&
    new Date(closure.startsAt).getTime() < dayEnd &&
    new Date(closure.endsAt).getTime() > dayStart,
  ) as CourtAvailability['closures']
  return { date, courts, slots, bookings, closures }
}

export const seedOrders = [
  { id: 'order-venue-1', orderNo: 'YQ202608290001', title: '3号场 · 晚场一', status: 'PAID', businessType: 'VENUE', payableCents: 8800, paidCents: 8800, refundedCents: 0, createdAt: new Date().toISOString(), member: { displayName: '延庆会员小林' } },
  { id: 'order-training-1', orderNo: 'YQ202608290002', title: '成人进阶双打课包', status: 'PENDING', businessType: 'TRAINING', payableCents: 128000, paidCents: 0, refundedCents: 0, createdAt: new Date(Date.now() - 86400000).toISOString(), member: { displayName: '延庆会员小林' } },
]

export function getOrders() {
  return (uni.getStorageSync('yanqing_mock_orders') as any[]) || seedOrders.map((item) => ({ ...item }))
}

export function saveOrders(orders: any[]) { uni.setStorageSync('yanqing_mock_orders', orders) }
