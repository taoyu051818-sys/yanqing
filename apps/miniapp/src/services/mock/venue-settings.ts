import { hourlyVenueSlots } from './venue-catalog'
export function getMockVenueSettings() {
  return uni.getStorageSync('yanqing_mock_venue_settings') || { revision: '', name: '延庆金羽羽毛球馆', address: '', contactPhone: '', latitude: null, longitude: null, opensAtHour: 7, closesAtHour: 24 }
}
export function getMockVenueSlots() {
  const settings = uni.getStorageSync('yanqing_mock_venue_settings')
  if (!settings) return hourlyVenueSlots
  const slots = [...hourlyVenueSlots]
  for (let hour = settings.opensAtHour; hour < settings.closesAtHour; hour++) {
    if (!slots.some(slot => slot.startMinutes === hour * 60)) slots.push({ id: `slot-H${String(hour).padStart(2, '0')}`, code: `H${String(hour).padStart(2, '0')}`, label: `${String(hour).padStart(2, '0')}:00–${String(hour + 1).padStart(2, '0')}:00`, startMinutes: hour * 60, endMinutes: (hour + 1) * 60, period: hour < 9 ? 'EARLY' : hour < 17 ? 'DAYTIME' : 'PRIME', enabled: true, priceCents: 0 })
  }
  return slots.map(slot => ({ ...slot, enabled: slot.startMinutes >= settings.opensAtHour * 60 && slot.endMinutes <= settings.closesAtHour * 60 })).sort((a, b) => a.startMinutes - b.startMinutes)
}
