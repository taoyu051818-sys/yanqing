import { hourlyVenueSlots } from "../venue-catalog";
import { type JsonRecord, KEYS, read, write } from "./storage.js";

export const initialPriceRules = (): JsonRecord[] => {
  return hourlyVenueSlots.map((slot) => ({
    id: `price-rule-${slot.code}`,
    code: `PRICE_${slot.code}`,
    version: 1,
    name: `${slot.label} 每小时场地价`,
    timeSlotId: slot.id,
    weekdayMask: 127,
    priceCents: slot.priceCents,
    newcomerPriceCents: Math.round(slot.priceCents * 0.7),
    effectiveFrom: "2026-01-01T00:00:00+08:00",
    effectiveTo: "2099-01-01T00:00:00+08:00",
    enabled: true,
    creationIdempotencyKey: `SEED:PRICE_${slot.code}:V1`,
    creationCommandHash: "b".repeat(64),
    createdById: "user-admin",
    createdBy: { id: "user-admin", displayName: "金羽管理员" },
    transitions: [],
    createdAt: "2026-01-01T00:00:00+08:00",
    updatedAt: "2026-01-01T00:00:00+08:00",
  }));
};

export function getVenueBookings(): JsonRecord[] {
  return read<JsonRecord[]>(KEYS.venueBookings, []);
}

export function saveVenueBookings(value: JsonRecord[]) {
  return write(KEYS.venueBookings, value);
}

export function getVenueClosures(): JsonRecord[] {
  return read<JsonRecord[]>(KEYS.venueClosures, []);
}

export function saveVenueClosures(value: JsonRecord[]) {
  return write(KEYS.venueClosures, value);
}

export function getPriceRules(): JsonRecord[] {
  const rules = read<JsonRecord[]>(KEYS.priceRules, initialPriceRules());
  const legacy = rules.filter((rule) => /^slot-[1-8]$/.test(rule.timeSlotId));
  if (!legacy.length || uni.getStorageSync("yanqing_mock_hourly_catalog_v1"))
    return rules;
  // Upgrade only the old mock tariff catalogue, preserving bookings, orders,
  // custom rule versions and their total price. Never reset user test data.
  const upgraded = rules.filter((rule) => !legacy.includes(rule));
  for (const rule of legacy) {
    const firstHour = 7 + (Number(rule.timeSlotId.slice(5)) - 1) * 2;
    for (let offset = 0; offset < 2; offset++) {
      const code = `H${String(firstHour + offset).padStart(2, "0")}`;
      const split = (cents: number) =>
        Math.floor((cents * (offset + 1)) / 2) -
        Math.floor((cents * offset) / 2);
      upgraded.push({
        ...rule,
        id: `${rule.id}_${code}`,
        code: `${rule.code}_${code}`,
        timeSlotId: `slot-${code}`,
        name: `${firstHour + offset}:00 每小时场地价`,
        priceCents: split(rule.priceCents),
        newcomerPriceCents:
          rule.newcomerPriceCents == null
            ? null
            : split(rule.newcomerPriceCents),
        creationIdempotencyKey: `HOURLY:${rule.id}:${code}`,
        transitions: [],
      });
    }
  }
  if (!upgraded.some((rule) => rule.timeSlotId === "slot-H23"))
    upgraded.push(
      initialPriceRules().find((rule) => rule.timeSlotId === "slot-H23")!,
    );
  write(KEYS.priceRules, upgraded);
  uni.setStorageSync("yanqing_mock_hourly_catalog_v1", true);
  return upgraded;
}

export function savePriceRules(value: JsonRecord[]) {
  return write(KEYS.priceRules, value);
}
