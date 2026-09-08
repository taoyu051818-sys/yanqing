import { describe, expect, it } from 'vitest';
import { venueCapacityRows } from './venue-capacity.js';

const date = (value: string) => new Date(value + '+08:00');
const slot = { id: 'day', label: '日间', startMinutes: 600, endMinutes: 720 };
const range = {
  start: date('2026-09-08T00:00:00'),
  end: date('2026-09-09T00:00:00'),
};
const interval = (start: string, end: string) => ({
  courtId: 'c1',
  startsAt: date(start),
  endsAt: date(end),
});

describe('shared venue capacity', () => {
  it('merges overlapping bookings and closures without counting closed time as occupied', () => {
    const booked = {
      ...interval('2026-09-08T10:00:00', '2026-09-08T12:00:00'),
      status: 'CONFIRMED',
    };
    const closure = interval('2026-09-08T10:30:00', '2026-09-08T11:00:00');
    const [row] = venueCapacityRows(
      [{ id: 'c1' }],
      [slot],
      [booked, booked],
      [closure, closure],
      range.start,
      range.end,
    );
    expect(row).toMatchObject({
      availableMinutes: 90,
      occupiedMinutes: 90,
      closedMinutes: 30,
      utilizationRate: 100,
    });
  });
  it('ignores bookings and closures outside the supplied court set', () => {
    const other = interval('2026-09-08T10:00:00', '2026-09-08T12:00:00');
    const [row] = venueCapacityRows(
      [{ id: 'c2' }],
      [slot],
      [{ ...other, status: 'CONFIRMED' }],
      [other],
      range.start,
      range.end,
    );
    expect(row).toMatchObject({
      availableMinutes: 120,
      occupiedMinutes: 0,
      closedMinutes: 0,
    });
  });
  it('clips to court creation and excludes pending holds', () => {
    const booking = interval('2026-09-08T10:00:00', '2026-09-08T12:00:00');
    const [row] = venueCapacityRows(
      [{ id: 'c1', createdAt: date('2026-09-08T11:00:00') }],
      [slot],
      [{ ...booking, status: 'HELD' }],
      [],
      range.start,
      range.end,
    );
    expect(row).toMatchObject({ availableMinutes: 60, occupiedMinutes: 0 });
  });
  it('clips arbitrary multi-day query boundaries in Shanghai time', () => {
    const [row] = venueCapacityRows(
      [{ id: 'c1' }],
      [slot],
      [],
      [],
      date('2026-09-08T11:30:00'),
      date('2026-09-09T10:30:00'),
    );
    expect(row.availableMinutes).toBe(60);
  });
  it('returns no capacity before the court exists', () => {
    const [row] = venueCapacityRows(
      [{ id: 'c1', createdAt: range.end }],
      [slot],
      [],
      [],
      range.start,
      range.end,
    );
    expect(row).toMatchObject({
      availableMinutes: 0,
      occupiedMinutes: 0,
      utilizationRate: null,
    });
  });
});
