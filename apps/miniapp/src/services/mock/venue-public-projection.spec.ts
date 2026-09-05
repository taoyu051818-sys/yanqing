import { beforeEach, describe, expect, it, vi } from "vitest";

import { mockRequest } from "./router";
import {
  getPriceRules,
  resetCatalogState,
  saveVenueBookings,
  saveVenueClosures,
} from "./state";
import { getOrders, saveOrders } from "./venue";

const storage = new Map<string, unknown>();

vi.stubGlobal("uni", {
  getStorageSync: (key: string) => storage.get(key) ?? "",
  setStorageSync: (key: string, value: unknown) => storage.set(key, value),
  removeStorageSync: (key: string) => storage.delete(key),
});

const request = <T = any>(
  method: string,
  url: string,
  data: Record<string, unknown> = {},
) => mockRequest<T>(method, url, data);

const login = (role: string) => request("POST", "/auth/dev-login", { role });

function shanghaiDate(offsetDays = 0) {
  const date = new Date(Date.now() + offsetDays * 86_400_000);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

const expectNoPrivateVenueFields = (value: unknown) => {
  expect(JSON.stringify(value)).not.toMatch(
    /creationIdempotencyKey|creationCommandHash|createdById|parameterSnapshot|fulfillmentIdempotencyKey|fulfillmentCommandHash|fulfillmentEvidence|fulfilledById|holdExpiresAt/,
  );
};

describe("venue public mock projections", () => {
  beforeEach(async () => {
    storage.clear();
    resetCatalogState();
    await login("MEMBER");
  });

  it("exposes only the member availability contract and re-queries the private price rule when booking", async () => {
    const date = shanghaiDate(1);
    saveVenueClosures([{
      id: "closure-private",
      courtId: "court-4",
      startsAt: `${date}T13:00:00+08:00`,
      endsAt: `${date}T15:00:00+08:00`,
      reason: "内部维修说明",
      status: "ACTIVE",
      creationIdempotencyKey: "private-closure-key",
      createdById: "private-admin",
    }]);

    const availability = await request<any>("GET", "/venues/availability", { date });

    expect(Object.keys(availability.courts[0]).sort()).toEqual([
      "enabled",
      "id",
      "name",
      "usage",
    ]);
    expect(Object.keys(availability.slots[0]).sort()).toEqual([
      "enabled",
      "endMinutes",
      "id",
      "label",
      "period",
      "price",
      "startMinutes",
    ]);
    expect(Object.keys(availability.slots[0].price).sort()).toEqual([
      "newcomerPriceCents",
      "priceCents",
    ]);
    expect(availability.closures).toEqual([{
      courtId: "court-4",
      startsAt: `${date}T13:00:00+08:00`,
      endsAt: `${date}T15:00:00+08:00`,
      status: "ACTIVE",
    }]);
    expectNoPrivateVenueFields(availability);
    expect(JSON.stringify(availability)).not.toMatch(/weekdayMask|effectiveFrom|effectiveTo|reason/);

    const order = await request<any>("POST", "/venues/bookings", {
      date,
      courtId: "court-1",
      slotId: "slot-H11",
      sourceChannel: "MINI_PROGRAM",
      creationIdempotencyKey: "venue-public-price-requery-1",
    });
    expectNoPrivateVenueFields(order);
    expect(order.bookings?.[0]).toMatchObject({
      court: { id: "court-1", name: "1号场" },
    });
    expect(order.bookings?.[0].startsAt).toBeTruthy();
    expect(order.bookings?.[0].endsAt).toBeTruthy();
    expect(getOrders().find((item) => item.id === order.id)?.parameterSnapshot)
      .toMatchObject({
        priceRuleId: getPriceRules().find((rule) => rule.timeSlotId === "slot-H11")?.id,
        priceRuleCode: "PRICE_H11",
        priceRuleVersion: 1,
      });
  });

  it("projects check-in and fulfillment responses identically on first execution and replay", async () => {
    const now = Date.now();
    const privateOrderFields = {
      creationIdempotencyKey: "private-order-key",
      creationCommandHash: "private-order-hash",
      parameterSnapshot: { rawPriceRule: "private" },
    };
    const checkInBooking = {
      id: "booking-check-in",
      orderId: "order-check-in",
      courtId: "court-1",
      status: "CONFIRMED",
      startsAt: new Date(now).toISOString(),
      endsAt: new Date(now + 60 * 60_000).toISOString(),
      usage: "RETAIL",
      holdExpiresAt: new Date(now + 60_000).toISOString(),
      fulfillmentIdempotencyKey: "private-old-fulfillment-key",
      fulfillmentCommandHash: "private-old-fulfillment-hash",
      fulfillmentEvidence: { raw: "private" },
    };
    const fulfillmentBooking = {
      id: "booking-fulfillment",
      orderId: "order-fulfillment",
      courtId: "court-2",
      status: "CHECKED_IN",
      startsAt: new Date(now - 2 * 60 * 60_000).toISOString(),
      endsAt: new Date(now - 60 * 60_000).toISOString(),
      usage: "RETAIL",
    };
    saveOrders([
      {
        id: "order-check-in",
        orderNo: "VN-CHECK-IN",
        businessType: "VENUE",
        status: "PAID",
        title: "1号场签到",
        ...privateOrderFields,
        bookings: [{ ...checkInBooking }],
      },
      {
        id: "order-fulfillment",
        orderNo: "VN-FULFILLMENT",
        businessType: "VENUE",
        status: "CHECKED_IN",
        title: "2号场履约",
        ...privateOrderFields,
        bookings: [{ ...fulfillmentBooking }],
      },
    ]);
    saveVenueBookings([{ ...checkInBooking }, { ...fulfillmentBooking }]);
    await login("ADMIN");

    const firstCheckIn = await request<any>(
      "POST",
      "/venues/orders/order-check-in/check-in",
    );
    const replayCheckIn = await request<any>(
      "POST",
      "/venues/orders/order-check-in/check-in",
    );
    expect(replayCheckIn).toEqual(firstCheckIn);
    expect(firstCheckIn.bookings).toEqual([expect.objectContaining({
      id: "booking-check-in",
      status: "CHECKED_IN",
    })]);
    expectNoPrivateVenueFields(firstCheckIn);

    const fulfillmentCommand = {
      outcome: "COMPLETED",
      reason: "管理员确认场地使用完成",
      evidence: {
        source: "COURT_INSPECTION",
        observedAt: new Date(now - 90 * 60_000).toISOString(),
      },
      idempotencyKey: "venue-fulfillment-public-1",
    };
    const firstFulfillment = await request<any>(
      "POST",
      "/venues/orders/order-fulfillment/fulfillment",
      fulfillmentCommand,
    );
    const replayFulfillment = await request<any>(
      "POST",
      "/venues/orders/order-fulfillment/fulfillment",
      fulfillmentCommand,
    );
    expect(replayFulfillment).toEqual(firstFulfillment);
    expect(firstFulfillment.bookings).toEqual([expect.objectContaining({
      id: "booking-fulfillment",
      status: "COMPLETED",
    })]);
    expectNoPrivateVenueFields(firstFulfillment);
  });
});
