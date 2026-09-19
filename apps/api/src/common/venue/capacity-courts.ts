import type { Prisma } from '../../generated/prisma/client.js';
import type { CapacityCourt } from './venue-capacity.js';

/** Only typed business history is read here; audit JSON is a migration concern. */
export async function loadCapacityCourts(
  tx: Prisma.TransactionClient,
  start: Date,
  end: Date,
): Promise<CapacityCourt[]> {
  const courts = await tx.court.findMany({
    select: {
      id: true,
      availabilityHistory: {
        where: {
          enabled: true,
          validFrom: { lt: end },
          OR: [{ validTo: null }, { validTo: { gt: start } }],
        },
        select: { validFrom: true, validTo: true },
      },
    },
  });
  return courts.map((court) => ({
    id: court.id,
    activeIntervals: court.availabilityHistory.map((version) => ({
      startsAt: new Date(Math.max(+start, +version.validFrom)),
      endsAt: new Date(
        Math.min(+end, version.validTo ? +version.validTo : +end),
      ),
    })),
  }));
}
