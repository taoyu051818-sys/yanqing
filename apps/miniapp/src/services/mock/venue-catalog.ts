export const hourlyVenueSlots = Array.from({ length: 17 }, (_, index) => {
  const hour = index + 7
  const code = `H${String(hour).padStart(2, '0')}`
  return {
    id: `slot-${code}`, code,
    label: `${String(hour).padStart(2, '0')}:00–${String(hour + 1).padStart(2, '0')}:00`,
    startMinutes: hour * 60, endMinutes: (hour + 1) * 60,
    period: hour < 9 ? 'EARLY' as const : hour < 17 ? 'DAYTIME' as const : 'PRIME' as const,
    enabled: true,
    priceCents: hour < 12 ? 3000 : hour < 14 ? 3500 : hour < 17 ? 3000 : hour < 19 ? 5000 : hour < 21 ? 6000 : 4000,
  }
})
