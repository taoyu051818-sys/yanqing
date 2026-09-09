import {
  BusinessType,
  OrderStatus,
  PaymentChannel,
  SlotPeriod,
} from '../generated/prisma/enums.js';

export const DAY_MS = 86_400_000;

export const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1_000;

export const shanghaiDay = () => {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const day = formatter.format(new Date());
  return {
    start: new Date(`${day}T00:00:00+08:00`),
    end: new Date(`${day}T24:00:00+08:00`),
  };
};

export const collectionOrderStatuses = [
  OrderStatus.PAID,
  OrderStatus.CHECKED_IN,
  OrderStatus.COMPLETED,
  OrderStatus.REFUND_PENDING,
  OrderStatus.PARTIALLY_REFUNDED,
  OrderStatus.REFUNDED,
];

export const repeatEligibleStatuses = [
  OrderStatus.PAID,
  OrderStatus.CHECKED_IN,
  OrderStatus.COMPLETED,
  OrderStatus.PARTIALLY_REFUNDED,
];

export const venueBusinessTypes: BusinessType[] = [
  BusinessType.VENUE,
  BusinessType.GAME,
  BusinessType.EVENT,
  BusinessType.GOODS,
  BusinessType.MEMBERSHIP,
];

export const cashPaymentChannels: PaymentChannel[] = [
  PaymentChannel.WECHAT,
  PaymentChannel.OFFLINE_CASH,
];

export const emptyPeriodHours = () => ({
  [SlotPeriod.EARLY]: 0,
  [SlotPeriod.DAYTIME]: 0,
  [SlotPeriod.PRIME]: 0,
});

export const percentage = (numerator: number, denominator: number) =>
  denominator <= 0 ? 0 : Math.round((numerator / denominator) * 10_000) / 100;

export const sum = (values: number[]) =>
  values.reduce((total, value) => total + value, 0);

export const countShanghaiDays = (start: Date, end: Date): number => {
  const shiftedStart = new Date(start.getTime() + SHANGHAI_OFFSET_MS);
  const shiftedEnd = new Date(end.getTime() - 1 + SHANGHAI_OFFSET_MS);
  const first = Date.UTC(
    shiftedStart.getUTCFullYear(),
    shiftedStart.getUTCMonth(),
    shiftedStart.getUTCDate(),
  );
  const last = Date.UTC(
    shiftedEnd.getUTCFullYear(),
    shiftedEnd.getUTCMonth(),
    shiftedEnd.getUTCDate(),
  );
  return Math.max(1, Math.round((last - first) / DAY_MS) + 1);
};

export const byBusinessType = <
  T extends { businessType: BusinessType; amountCents: number },
>(
  rows: T[],
) => {
  const result = Object.fromEntries(
    Object.values(BusinessType).map((type) => [type, 0]),
  ) as Record<BusinessType, number>;
  for (const row of rows) result[row.businessType] += row.amountCents;
  return result;
};

export const repurchaseWindow = (
  orders: Array<{ memberId: string; paidAt: Date | null }>,
  startsAt: Date,
  endsAt: Date,
) => {
  const counts = new Map<string, number>();
  for (const order of orders) {
    if (!order.paidAt || order.paidAt < startsAt || order.paidAt >= endsAt)
      continue;
    counts.set(order.memberId, (counts.get(order.memberId) ?? 0) + 1);
  }
  const purchaserCount = counts.size;
  const repeatCustomerCount = [...counts.values()].filter(
    (count) => count >= 2,
  ).length;
  return {
    purchaserCount,
    repeatCustomerCount,
    rate: percentage(repeatCustomerCount, purchaserCount),
  };
};
