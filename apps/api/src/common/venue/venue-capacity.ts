type Interval = { startsAt: Date; endsAt: Date };
export type CapacityCourt = { id: string; createdAt?: Date };
export type CapacitySlot = {
  id: string;
  label: string;
  startMinutes: number;
  endMinutes: number;
};
export type CapacityBooking = Interval & { courtId: string; status: string };
export type CapacityClosure = Interval & { courtId: string };
const DAY = 86400000,
  OFFSET = 8 * 3600000;

export function coveredMinutes(
  intervals: Interval[],
  start: number,
  end: number,
) {
  const clipped = intervals
    .map((i) => [Math.max(start, +i.startsAt), Math.min(end, +i.endsAt)])
    .filter((i) => i[1] > i[0])
    .sort((a, b) => a[0] - b[0]);
  let total = 0,
    until = start;
  for (const [a, b] of clipped) {
    total += Math.max(0, b - Math.max(a, until));
    until = Math.max(until, b);
  }
  return total / 60000;
}

/** The caller supplies one snapshot of the currently enabled courts and slots. */
export function venueCapacityRows<T extends CapacitySlot>(
  courts: CapacityCourt[],
  slots: T[],
  bookings: CapacityBooking[],
  closures: CapacityClosure[],
  start: Date,
  end: Date,
) {
  const midnight = Math.floor((+start + OFFSET) / DAY) * DAY - OFFSET;
  return slots.map((slot) => {
    let availableMinutes = 0,
      occupiedMinutes = 0,
      closedMinutes = 0;
    for (let day = midnight; day < +end; day += DAY) {
      const a = Math.max(+start, day + slot.startMinutes * 60000);
      const b = Math.min(+end, day + slot.endMinutes * 60000);
      if (b <= a) continue;
      for (const court of courts) {
        const courtStart = Math.max(a, court.createdAt ? +court.createdAt : a);
        if (courtStart >= b) continue;
        const closed = closures.filter((i) => i.courtId === court.id);
        const booked = bookings.filter(
          (i) =>
            i.courtId === court.id &&
            ['CONFIRMED', 'CHECKED_IN', 'COMPLETED'].includes(i.status),
        );
        const closedTime = coveredMinutes(closed, courtStart, b);
        closedMinutes += closedTime;
        availableMinutes += (b - courtStart) / 60000 - closedTime;
        occupiedMinutes +=
          coveredMinutes([...closed, ...booked], courtStart, b) - closedTime;
      }
    }
    return {
      ...slot,
      availableMinutes,
      occupiedMinutes,
      closedMinutes,
      emptyMinutes: availableMinutes - occupiedMinutes,
      utilizationRate: availableMinutes
        ? Math.round((occupiedMinutes / availableMinutes) * 10000) / 100
        : null,
    };
  });
}
