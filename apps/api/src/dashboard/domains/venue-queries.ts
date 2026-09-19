import { loadCapacitySlots } from '../../common/venue/capacity-slots.js';
import { loadCapacityCourts } from '../../common/venue/capacity-courts.js';
import { Prisma } from '../../generated/prisma/client.js';
import { venueCapacityRows } from '../../common/venue/venue-capacity.js';
import { PrismaService } from '../../database/prisma.service.js';
import { BookingStatus } from '../../generated/prisma/enums.js';

export function loadCapacity(prisma: PrismaService, start: Date, end: Date) {
  return prisma.$transaction(
    async (tx) => {
      const [courts, slots, bookings, closures] = await Promise.all([
        loadCapacityCourts(tx, start, end),
        loadCapacitySlots(tx, start, end),
        tx.courtBooking.findMany({
          where: {
            startsAt: { lt: end },
            endsAt: { gt: start },
            status: {
              in: [
                BookingStatus.CONFIRMED,
                BookingStatus.CHECKED_IN,
                BookingStatus.COMPLETED,
              ],
            },
          },
          select: {
            courtId: true,
            status: true,
            startsAt: true,
            endsAt: true,
          },
        }),
        tx.courtClosure.findMany({
          where: {
            status: 'ACTIVE',
            startsAt: { lt: end },
            endsAt: { gt: start },
          },
          select: { courtId: true, startsAt: true, endsAt: true },
        }),
      ]);
      const bookedIds = new Set(bookings.map((b) => b.courtId));
      const participating = courts.filter(
        (c) =>
          bookedIds.has(c.id) ||
          c.activeIntervals?.some((i) => i.startsAt < end && i.endsAt > start),
      );
      return {
        courtCount: participating.length,
        bookingCount: bookings.length,
        rows: venueCapacityRows(courts, slots, bookings, closures, start, end),
      };
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
      timeout: 30000,
    },
  );
}
