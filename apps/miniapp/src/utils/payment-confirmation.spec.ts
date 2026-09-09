import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createPaymentConfirmation,
  canCancelFreeVenue,
} from "./payment-confirmation";
import { saveAuthSession, clearAuthSession } from "../services/auth-session";

beforeEach(() => {
  vi.useFakeTimers();
  const storage = new Map();
  vi.stubGlobal("uni", {
    getStorageSync: (key: string) => storage.get(key),
    setStorageSync: (key: string, value: unknown) => storage.set(key, value),
    removeStorageSync: (key: string) => storage.delete(key),
  });
  saveAuthSession("token", "member");
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
const flush = () => vi.advanceTimersByTimeAsync(0);

describe("payment confirmation", () => {
  it("observes delayed server success and stops polling", async () => {
    let status = "PENDING";
    const fetch = vi.fn(async () => ({ id: "order", status }));
    const result = vi.fn();
    const flow = createPaymentConfirmation(fetch, result);
    flow.start("order");
    await vi.advanceTimersByTimeAsync(5000);
    expect(flow.state.value?.checking).toBe(true);
    status = "PAID";
    await vi.advanceTimersByTimeAsync(2000);
    expect(result).toHaveBeenCalledOnce();
    expect(result).toHaveBeenCalledWith({ id: "order", status: "PAID" });
    expect(flow.state.value).toBeNull();
    const count = fetch.mock.calls.length;
    await vi.advanceTimersByTimeAsync(60000);
    expect(fetch).toHaveBeenCalledTimes(count);
  });
  it.each(["PENDING", "error"])(
    "bounds retries for %s and allows a manual query",
    async (status) => {
      const fetch = vi.fn(async () => {
        if (status === "error") throw new Error("offline");
        return { status };
      });
      const result = vi.fn();
      const flow = createPaymentConfirmation(fetch, result);
      flow.start("order");
      await vi.advanceTimersByTimeAsync(60000);
      expect(fetch).toHaveBeenCalledTimes(15);
      expect(flow.state.value).toMatchObject({
        checking: false,
        message: expect.stringContaining("重新查询"),
      });
      fetch.mockResolvedValue({ status: "PAID" });
      flow.start("order");
      await flush();
      expect(result).toHaveBeenCalledOnce();
      expect(flow.state.value).toBeNull();
    },
  );
  it("pauses on hide, ignores an old response, and resumes on show", async () => {
    let resolve!: (value: any) => void;
    const fetch = vi.fn(
      () =>
        new Promise<{ status: string }>((done) => {
          resolve = done;
        }),
    );
    const result = vi.fn();
    const flow = createPaymentConfirmation(fetch, result);
    flow.start("order");
    flow.pause();
    resolve({ status: "PAID" });
    await vi.advanceTimersByTimeAsync(60000);
    expect(result).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledOnce();
    fetch.mockResolvedValue({ status: "PAID" });
    flow.resume();
    await flush();
    expect(result).toHaveBeenCalledOnce();
  });
  it.each(["logout", "replace", "stop"])(
    "ignores an in-flight result after %s",
    async (mode) => {
      let resolve!: (value: any) => void;
      const result = vi.fn();
      const flow = createPaymentConfirmation(
        () =>
          new Promise<{ status: string }>((done) => {
            resolve = done;
          }),
        result,
      );
      flow.start("order");
      if (mode === "logout") clearAuthSession();
      if (mode === "replace") saveAuthSession("token", "member");
      if (mode === "stop") flow.stop();
      resolve({ status: "PAID" });
      await flush();
      expect(result).not.toHaveBeenCalled();
      expect(flow.state.value).toBeNull();
    },
  );
  it("does not overlap slow queries and accepts server cancellation", async () => {
    let resolve!: (value: any) => void;
    const fetch = vi.fn(
      () =>
        new Promise<{ status: string }>((done) => {
          resolve = done;
        }),
    );
    const result = vi.fn();
    const flow = createPaymentConfirmation(fetch, result);
    flow.start("order");
    await vi.advanceTimersByTimeAsync(30000);
    expect(fetch).toHaveBeenCalledOnce();
    resolve({ status: "CANCELLED" });
    await flush();
    expect(result).toHaveBeenCalledWith({ status: "CANCELLED" });
    expect(flow.state.value).toBeNull();
  });
});

describe("free venue cancellation entry", () => {
  const futureOrder = () => ({
    businessType: "VENUE" as const,
    status: "PAID" as const,
    payableCents: 0,
    paidCents: 0,
    refundedCents: 0,
    bookings: [
      {
        status: "CONFIRMED",
        startsAt: new Date(Date.now() + 60000).toISOString(),
      },
    ],
  });
  it("shows for a future unused free reservation", () => {
    expect(canCancelFreeVenue(futureOrder())).toBe(true);
  });
  it.each(["past", "checked", "paid", "completed", "empty"])(
    "hides for %s",
    (mode) => {
      const order: any = futureOrder();
      if (mode === "past")
        order.bookings[0].startsAt = new Date(Date.now() - 1).toISOString();
      if (mode === "checked") order.bookings[0].status = "CHECKED_IN";
      if (mode === "paid") order.paidCents = 1;
      if (mode === "completed") order.completedAt = new Date().toISOString();
      if (mode === "empty") order.bookings = [];
      expect(canCancelFreeVenue(order)).toBe(false);
    },
  );
});
