import { PrismaService } from '../../database/prisma.service.js';
import { Prisma } from '../../generated/prisma/client.js';
import { atMinutes } from './venues-support.js';

export async function resolvePrice(
  prisma: PrismaService,
  slotId: string,
  date: string,
  startMinutes = 0,
  client: Pick<Prisma.TransactionClient, 'priceRule'> = prisma,
) {
  const at = atMinutes(date, startMinutes);
  const dayOfWeek = new Date(`${date}T00:00:00Z`).getUTCDay();
  const weekdayBit = 1 << dayOfWeek;
  const rules = await client.priceRule.findMany({
    where: {
      enabled: true,
      OR: [{ timeSlotId: slotId }, { timeSlotId: null }],
      effectiveFrom: { lte: at },
      AND: [{ OR: [{ effectiveTo: null }, { effectiveTo: { gt: at } }] }],
    },
    select: {
      id: true,
      code: true,
      version: true,
      name: true,
      timeSlotId: true,
      weekdayMask: true,
      priceCents: true,
      newcomerPriceCents: true,
      effectiveFrom: true,
      effectiveTo: true,
    },
    orderBy: [{ effectiveFrom: 'desc' }, { version: 'desc' }],
  });
  return (
    rules
      .filter((rule) => (rule.weekdayMask & weekdayBit) !== 0)
      .sort(
        (left, right) =>
          Number(Boolean(right.timeSlotId)) -
            Number(Boolean(left.timeSlotId)) ||
          right.effectiveFrom.getTime() - left.effectiveFrom.getTime() ||
          right.version - left.version,
      )[0] ?? null
  );
}
