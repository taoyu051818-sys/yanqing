import { describe, expect, it, vi } from 'vitest';
import { loadCapacityCourts } from './capacity-courts.js';
import { venueCapacityRows } from './venue-capacity.js';
const at = (hour: number) => new Date(Date.UTC(2026, 8, 18, hour - 8));
const slot = { id: 'slot', label: '09–13', startMinutes: 540, endMinutes: 780 };
const interval = (from: number, to: number) => ({
  startsAt: at(from),
  endsAt: at(to),
});
describe('typed availability history', () => {
  it('reads bounded typed intervals without consulting audit logs', async () => {
    const db = {
      court: {
        findMany: vi
          .fn()
          .mockResolvedValue([
            {
              id: 'c',
              availabilityHistory: [{ validFrom: at(9), validTo: at(12) }],
            },
          ]),
      },
    };
    const courts = await loadCapacityCourts(db as never, at(10), at(11));
    expect(courts).toEqual([{ id: 'c', activeIntervals: [interval(10, 11)] }]);
    expect(db.court.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.objectContaining({
          availabilityHistory: expect.objectContaining({
            where: expect.objectContaining({ validFrom: { lt: at(11) } }),
          }),
        }),
      }),
    );
  });
  it('intersects historical hours with historical court availability', () => {
    const rows = venueCapacityRows(
      [{ id: 'c', activeIntervals: [interval(9, 10), interval(11, 13)] }],
      [{ ...slot, activeIntervals: [interval(9, 12)] }],
      [],
      [],
      at(0),
      at(24),
    );
    expect(rows[0]).toMatchObject({ availableMinutes: 120, emptyMinutes: 120 });
  });
  it('counts each minute once across an old two-hour slot and new hourly slots', () => {
    const slots = [
      { ...slot, endMinutes: 660, activeIntervals: [interval(0, 10)] },
      {
        ...slot,
        id: 'hour',
        startMinutes: 600,
        endMinutes: 660,
        activeIntervals: [interval(10, 24)],
      },
    ];
    const booking = { courtId: 'c', ...interval(9, 11), status: 'CONFIRMED' };
    const rows = venueCapacityRows(
      [{ id: 'c' }],
      slots,
      [booking],
      [],
      at(0),
      at(24),
    );
    expect(rows.reduce((sum, row) => sum + row.occupiedMinutes, 0)).toBe(120);
    expect(rows.reduce((sum, row) => sum + row.availableMinutes, 0)).toBe(120);
  });
  it('retains real bookings outside revised hours without inventing empty capacity', () => {
    const booking = { courtId: 'c', ...interval(12, 13), status: 'CONFIRMED' };
    const rows = venueCapacityRows(
      [{ id: 'c', activeIntervals: [interval(9, 12)] }],
      [{ ...slot, activeIntervals: [interval(9, 11)] }],
      [booking],
      [],
      at(0),
      at(24),
    );
    expect(rows[0]).toMatchObject({
      availableMinutes: 180,
      occupiedMinutes: 60,
      emptyMinutes: 120,
    });
  });
});
