export type Interval = { startsAt: Date; endsAt: Date };
export type CapacityCourt = {
  id: string;
  createdAt?: Date;
  deletedAt?: Date | null;
  activeIntervals?: Interval[];
};
export type CapacitySlot = {
  id: string;
  label: string;
  startMinutes: number;
  endMinutes: number;
  activeIntervals?: Interval[];
  fallback?: boolean;
};
export type CapacityBooking = Interval & { courtId: string; status: string };
export type CapacityClosure = Interval & { courtId: string };
const DAY = 86400000,
  OFFSET = 8 * 3600000;

/** Historical court intervals and actual bookings share the same capacity calculation. */
export function venueCapacityRows<T extends CapacitySlot>(
  courts: CapacityCourt[],
  slots: T[],
  bookings: CapacityBooking[],
  closures: CapacityClosure[],
  start: Date,
  end: Date,
) {
  const rows = slots.map((slot) => ({
    ...slot,
    availableMinutes: 0,
    occupiedMinutes: 0,
    closedMinutes: 0,
  }));
  const midnight = Math.floor((+start + OFFSET) / DAY) * DAY - OFFSET;
  const overlaps = (i: Interval, a: number, b: number) =>
    +i.startsAt < b && +i.endsAt > a;
  const covers = (intervals: Interval[], a: number, b: number) =>
    intervals.some((i) => +i.startsAt <= a && +i.endsAt >= b);
  const clip = (i: Interval, a: number, b: number): Interval => ({
    startsAt: new Date(Math.max(a, +i.startsAt)),
    endsAt: new Date(Math.min(b, +i.endsAt)),
  });
  const byCourt = <T extends { courtId: string }>(values: T[]) => {
    const result = new Map<string, T[]>();
    for (const value of values) {
      const list = result.get(value.courtId) ?? [];
      list.push(value);
      result.set(value.courtId, list);
    }
    return result;
  };
  const bookingGroups = byCourt(
    bookings.filter((b) =>
      ['CONFIRMED', 'CHECKED_IN', 'COMPLETED'].includes(b.status),
    ),
  );
  const closureGroups = byCourt(closures);
  for (let day = midnight; day < +end; day += DAY) {
    const a = Math.max(+start, day),
      b = Math.min(+end, day + DAY);
    const windows = slots.map((slot) => {
      const hours = {
        startsAt: new Date(day + slot.startMinutes * 60000),
        endsAt: new Date(day + slot.endMinutes * 60000),
      };
      const active = (slot.activeIntervals ?? [hours])
        .filter((i) => overlaps(i, +hours.startsAt, +hours.endsAt))
        .map((i) =>
          clip(i, Math.max(a, +hours.startsAt), Math.min(b, +hours.endsAt)),
        )
        .filter((i) => +i.endsAt > +i.startsAt);
      return { hours, active };
    });
    for (const court of courts) {
      const open = court.activeIntervals ?? [
        { startsAt: court.createdAt ?? start, endsAt: court.deletedAt ?? end },
      ];
      const booked = bookingGroups.get(court.id) ?? [],
        closed = closureGroups.get(court.id) ?? [];
      const points = new Set<number>([a, b]);
      for (const i of [
        ...open,
        ...booked,
        ...closed,
        ...windows.flatMap((w) => [w.hours, ...w.active]),
      ]) {
        if (overlaps(i, a, b)) {
          points.add(Math.max(a, +i.startsAt));
          points.add(Math.min(b, +i.endsAt));
        }
      }
      const ordered = [...points].sort((x, y) => x - y);
      for (let j = 0; j < ordered.length - 1; j++) {
        const from = ordered[j],
          to = ordered[j + 1],
          occupied = covers(booked, from, to);
        // Assign each physical minute once, even when an older two-hour slot
        // is replaced by two hourly slots or duplicate legacy slots exist.
        let index = windows.findIndex((w) => covers(w.active, from, to));
        const scheduled = index >= 0;
        if (!occupied && (!scheduled || !covers(open, from, to))) continue;
        if (index < 0)
          index = windows.findIndex((w) => covers([w.hours], from, to));
        if (index < 0) continue;
        const minutes = (to - from) / 60000;
        if (covers(closed, from, to)) rows[index].closedMinutes += minutes;
        else {
          rows[index].availableMinutes += minutes;
          if (occupied) rows[index].occupiedMinutes += minutes;
        }
      }
    }
  }
  return rows
    .filter(
      (row) =>
        !row.fallback || row.availableMinutes > 0 || row.closedMinutes > 0,
    )
    .map(({ activeIntervals: _intervals, ...row }) => ({
      ...row,
      emptyMinutes: row.availableMinutes - row.occupiedMinutes,
      utilizationRate: row.availableMinutes
        ? Math.round((row.occupiedMinutes / row.availableMinutes) * 10000) / 100
        : null,
    }));
}
