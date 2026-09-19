import type { Prisma } from '../../generated/prisma/client.js';
import type { CapacitySlot, Interval } from './venue-capacity.js';
import { SlotPeriod } from '../../generated/prisma/enums.js';

type HistoricalSlot = CapacitySlot & {
  period: SlotPeriod;
  activeIntervals: Interval[];
};
export async function loadCapacitySlots(
  tx: Prisma.TransactionClient,
  start: Date,
  end: Date,
): Promise<HistoricalSlot[]> {
  const versions = await tx.timeSlotAvailability.findMany({
    where: {
      validFrom: { lt: end },
      OR: [{ validTo: null }, { validTo: { gt: start } }],
    },
    orderBy: [
      { startMinutes: 'asc' },
      { timeSlotId: 'asc' },
      { validFrom: 'asc' },
    ],
    select: {
      timeSlotId: true,
      validFrom: true,
      validTo: true,
      enabled: true,
      label: true,
      startMinutes: true,
      endMinutes: true,
      period: true,
    },
  });
  const slots = new Map<string, HistoricalSlot>();
  for (const version of versions) {
    const { timeSlotId, label, startMinutes, endMinutes, period } = version;
    const key = JSON.stringify([
      timeSlotId,
      label,
      startMinutes,
      endMinutes,
      period,
    ]);
    let slot = slots.get(key);
    if (!slot) {
      slot = {
        id: timeSlotId,
        label,
        startMinutes,
        endMinutes,
        period,
        activeIntervals: [],
      };
      slots.set(key, slot);
    }
    if (version.enabled)
      slot.activeIntervals.push({
        startsAt: new Date(Math.max(+start, +version.validFrom)),
        endsAt: new Date(
          Math.min(+end, version.validTo ? +version.validTo : +end),
        ),
      });
  }
  // Staff may backdate a reservation to before any schedule was recorded.
  // Keep actual occupancy, while assigning zero bookable capacity to unknown hours.
  const fallback: HistoricalSlot[] = Array.from({ length: 24 }, (_, hour) => ({
    id: `unconfigured:${hour}`,
    label: `${String(hour).padStart(2, '0')}:00–${String(hour + 1).padStart(2, '0')}:00（未配置时段）`,
    startMinutes: hour * 60,
    endMinutes: (hour + 1) * 60,
    period:
      hour < 9
        ? SlotPeriod.EARLY
        : hour < 17
          ? SlotPeriod.DAYTIME
          : SlotPeriod.PRIME,
    activeIntervals: [],
    fallback: true,
  }));
  return [...slots.values(), ...fallback];
}
