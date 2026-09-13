import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AvailabilityQueryDto, CreateVenueBookingDto } from './venues.dto.js';
import { assertVenueDate, atMinutes } from './shared/venues-support.js';
import { availability } from './availability/venues-availability.commands.js';
import { createBooking } from './booking/venues-booking.commands.js';

describe('venue calendar dates', () => {
  it.each([
    '2099-02-31',
    '2025-02-29',
    '2024-13-01',
    '2024-00-01',
    '2024-01-00',
    '2024-04-31',
    '2024-1-01',
  ])(
    'rejects %s at DTO and service boundaries before database access',
    async (date) => {
      const dto = {
        date,
        courtId: 'court',
        slotId: 'slot',
        sourceChannel: 'MINI_PROGRAM',
        creationIdempotencyKey: 'calendar-date-key',
      };
      for (const type of [AvailabilityQueryDto, CreateVenueBookingDto]) {
        expect(
          (
            await validate(
              plainToInstance(type as typeof AvailabilityQueryDto, dto),
            )
          ).some((error) => error.property === 'date'),
        ).toBe(true);
      }
      expect(() => assertVenueDate(date)).toThrow('有效');
      const db = { $transaction: vi.fn() };
      await expect(availability(db as never, date)).rejects.toMatchObject({
        status: 400,
      });
      await expect(
        createBooking(db as never, dto as never, {
          sub: 'member',
          roles: ['MEMBER'],
          displayName: 'Member',
        }),
      ).rejects.toMatchObject({ status: 400 });
      expect(db.$transaction).not.toHaveBeenCalled();
    },
  );
  it('accepts leap day and maps the requested day to Shanghai booking instants', async () => {
    expect(
      await validate(
        plainToInstance(AvailabilityQueryDto, { date: '2028-02-29' }),
      ),
    ).toHaveLength(0);
    expect(atMinutes('2028-02-29', 540).toISOString()).toBe(
      '2028-02-29T01:00:00.000Z',
    );
    expect(atMinutes('2028-02-29', 1440).toISOString()).toBe(
      '2028-02-29T16:00:00.000Z',
    );
  });
});
