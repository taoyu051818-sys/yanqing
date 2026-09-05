import { beforeEach, describe, expect, it, vi } from "vitest";

import { mockRequest } from "./router";
import { getVenueBookings, getVenueClosures } from "./state";

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

function shanghaiDate(offsetDays = 1) {
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

describe("venue closure mock acceptance", () => {
  beforeEach(async () => {
    storage.clear();
    await login("ADMIN");
  });

  it("persists create/list/availability/cancel and enforces role boundaries", async () => {
    const date = shanghaiDate();
    const command = {
      courtId: "court-1",
      startsAt: `${date}T13:00:00+08:00`,
      endsAt: `${date}T15:00:00+08:00`,
      reason: "地板维护保养",
      creationIdempotencyKey: "closure-mock-key-1",
    };
    const created = await request("POST", "/venues/closures", command);
    expect(created).not.toHaveProperty("creationIdempotencyKey");
    expect(created).not.toHaveProperty("createdById");
    await expect(request("POST", "/venues/closures", command)).resolves.toEqual(created);
    await expect(request<any[]>("GET", "/venues/closures", {
      status: "ACTIVE",
      from: `${date}T00:00:00+08:00`,
      to: `${date}T24:00:00+08:00`,
    })).resolves.toEqual([expect.objectContaining({ id: created.id, status: "ACTIVE" })]);
    await expect(request<any>("GET", "/venues/availability", { date }))
      .resolves.toMatchObject({ closures: [expect.objectContaining({
        courtId: command.courtId,
        status: "ACTIVE",
      })] });

    await login("MEMBER");
    await expect(request("GET", "/venues/closures")).rejects.toThrow("无权");
    await expect(request("POST", "/venues/bookings", {
      date,
      courtId: "court-1",
      slotId: "slot-H13",
      sourceChannel: "MINI_PROGRAM",
    })).rejects.toThrow("该时段已封场");

    await login("FRONT_DESK");
    await expect(request<any[]>("GET", "/venues/closures")).resolves.toHaveLength(1);
    await expect(request("POST", "/venues/closures", {
      ...command,
      creationIdempotencyKey: "closure-mock-key-2",
    })).rejects.toThrow("无权");

    await login("SUPER_ADMIN");
    const cancelled = await request(
      "POST",
      `/venues/closures/${created.id}/cancel`,
      { reason: "维护计划已调整" },
    );
    expect(cancelled).toMatchObject({ status: "CANCELLED", cancelReason: "维护计划已调整" });
    expect(cancelled).not.toHaveProperty("creationIdempotencyKey");
    expect(getVenueClosures()).toEqual([
      expect.objectContaining({ id: created.id, status: "CANCELLED" }),
    ]);
  });

  it("reports blocking bookings and leaves their state untouched", async () => {
    const date = shanghaiDate();
    await login("MEMBER");
    const order = await request("POST", "/venues/bookings", {
      date,
      courtId: "court-3",
      slotId: "slot-H07",
      sourceChannel: "MINI_PROGRAM",
    });
    const before = getVenueBookings().find((item) => item.orderId === order.id);

    await login("ADMIN");
    await expect(request("POST", "/venues/closures", {
      courtId: "court-3",
      startsAt: `${date}T07:00:00+08:00`,
      endsAt: `${date}T09:00:00+08:00`,
      reason: "临时设备检修",
      creationIdempotencyKey: "closure-blocking-key-1",
    })).rejects.toThrow("已有 1 笔未取消预约");
    expect(getVenueBookings().find((item) => item.orderId === order.id)).toEqual(before);
    expect(getVenueClosures()).toHaveLength(0);
  });
});
