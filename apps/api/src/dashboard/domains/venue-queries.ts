import { Prisma } from '../../generated/prisma/client.js';
import { venueCapacityRows } from '../../common/venue/venue-capacity.js';
import { PrismaService } from '../../database/prisma.service.js';
import { BookingStatus } from '../../generated/prisma/enums.js';

export function loadCapacity(prisma: PrismaService, start: Date, end: Date) {
  return prisma.$transaction(
    async (tx) => {
      const [courts, slots, bookings, closures] = await Promise.all([
        tx.court.findMany({
          where: { enabled: true },
          select: { id: true, createdAt: true },
        }),
        tx.timeSlot.findMany({
          where: { enabled: true },
          select: {
            id: true,
            label: true,
            startMinutes: true,
            endMinutes: true,
            period: true,
          },
          orderBy: { startMinutes: 'asc' },
        }),
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
      const ids = new Set(courts.map((c) => c.id));
      return {
        courtCount: courts.length,
        bookingCount: bookings.filter((b) => ids.has(b.courtId)).length,
        rows: venueCapacityRows(courts, slots, bookings, closures, start, end),
      };
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
      timeout: 30000,
    },
  );
}
