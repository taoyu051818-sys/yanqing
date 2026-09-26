import { beforeEach, expect, it, vi } from "vitest";
import * as vue from "vue";
import * as auth from "../../services/auth-session";
import { loadSfcScript } from "../../test-utils/sfc-script";
const createBooking = vi.fn();
const assistedAvailability = vi.fn();
const storage = new Map<string, unknown>();
beforeEach(() => {
  createBooking.mockReset();
  assistedAvailability.mockReset().mockResolvedValue({ courts: [], slots: [], bookings: [], closures: [] });
  storage.clear();
  vi.stubGlobal("uni", {
    getStorageSync: (k: string) => storage.get(k) || "",
    setStorageSync: (k: string, v: unknown) => storage.set(k, v),
    removeStorageSync: (k: string) => storage.delete(k),
    showToast: vi.fn(),
  });
  auth.saveAuthSession("admin-token", "admin");
});
function fixture() {
  return loadSfcScript(
    new URL("./index.vue", import.meta.url),
    [
      "submit",
      "choose",
      "bookingMode",
      "targetMember",
      "showMembers",
      "showBookingReview",
      "overrideReason",
      "data",
      "date",
      "selected",
      "assistedOrder",
      "continueAssistedBooking",
      "submissionError",
      "couponCode",
      "needsOverride",
      "reviewNeedsOverride",
    ],
    (id) => {
      if (id === "vue") return vue;
      if (id === "@dcloudio/uni-app")
        return { onShow: vi.fn(), onHide: vi.fn(), onUnload: vi.fn() };
      if (id.endsWith("/composables/use-venue-profile"))
        return { useVenueProfile: () => ({ refresh: vi.fn() }) };
      if (id.endsWith("/services/api"))
        return {
          endpoints: {
            createBooking,
            assistedAvailability,
          },
        };
      if (id.endsWith("/services/auth-session")) return auth;
      if (id.endsWith("/stores/session"))
        return {
          useSessionStore: () => ({
            user: { id: "admin" },
            roles: ["ADMIN"],
            isAuthenticated: true,
          }),
        };
      if (id.endsWith("/utils/format")) return { today: () => "2090-01-01" };
      if (id.endsWith("/utils/pending-creation-key"))
        return {
          withPendingCreationKey: (
            _scope: unknown,
            _command: unknown,
            send: (key: string) => unknown,
          ) => send("stable-key"),
        };
      if (
        id.endsWith("/utils/member-navigation") ||
        id.endsWith("/utils/booking-coupons") ||
        id.endsWith(".vue")
      )
        return {};
      throw new Error(id);
    },
  );
}
it("opens member selection from the dock before any slot is selected", async () => {
  const f = fixture();
  f.bookingMode.value = "ASSISTED";
  await f.submit();
  expect(f.showMembers.value).toBe(true);
  expect(createBooking).not.toHaveBeenCalled();
});
it("retries the original assisted command when a lost response leaves the slot occupied", async () => {
  const f = fixture();
  f.bookingMode.value = "ASSISTED";
  f.targetMember.value = { id: "member-1", displayName: "测试会员" };
  const availability = {
    courts: [{ id: "c1", name: "1号场", enabled: true, usage: "RETAIL" }],
    slots: [{ id: "s1", enabled: true, startMinutes: 600, endMinutes: 660, price: { priceCents: 6000 } }],
    bookings: [], closures: [],
  };
  f.data.value = availability;
  f.selected.value = { courtId: "c1", slotId: "s1" };
  await f.submit();
  assistedAvailability.mockResolvedValue({
    ...availability,
    bookings: [{ courtId: "c1", startsAt: "2090-01-01T10:00:00+08:00", endsAt: "2090-01-01T11:00:00+08:00" }],
  });
  createBooking.mockRejectedValueOnce(new Error("响应中断")).mockResolvedValueOnce({ id: "original-order", orderNo: "YQ-1", payableCents: 6000 });
  await f.submit(true);
  expect(f.needsOverride.value).toBe(true);
  expect(f.reviewNeedsOverride.value).toBe(false);
  await f.submit(true);
  expect(createBooking).toHaveBeenCalledTimes(2);
  expect(createBooking.mock.calls[1][0]).toEqual(createBooking.mock.calls[0][0]);
  expect(createBooking.mock.calls[1][0].overrideReason).toBeUndefined();
  expect(f.assistedOrder.value.id).toBe("original-order");
});
it("requires one review for a normal assisted order and retains the member on failure", async () => {
  const f = fixture();
  f.bookingMode.value = "ASSISTED";
  f.targetMember.value = { id: "member-1", displayName: "测试会员" };
  f.data.value = {
    courts: [{ id: "c1", enabled: true, usage: "RETAIL" }],
    slots: [
      {
        id: "s1",
        enabled: true,
        startMinutes: 600,
        endMinutes: 660,
        price: { priceCents: 6000 },
      },
    ],
    bookings: [],
    closures: [],
  };
  f.selected.value = { courtId: "c1", slotId: "s1" };
  await f.submit();
  expect(f.showBookingReview.value).toBe(true);
  expect(createBooking).not.toHaveBeenCalled();
  createBooking.mockRejectedValue(new Error("network"));
  await f.submit(true);
  expect(createBooking).toHaveBeenCalledWith(
    expect.objectContaining({
      memberId: "member-1",
      creationIdempotencyKey: "stable-key",
    }),
  );
  expect(f.targetMember.value.id).toBe("member-1");
  expect(f.showBookingReview.value).toBe(true);
});
it("lets a second tap clear a selection without submitting a booking", () => {
  const f = fixture();
  f.bookingMode.value = "ASSISTED";
  const slot = { id: "s1", price: { priceCents: 6000 } };
  f.choose("c1", slot);
  expect(f.selected.value).toEqual({ courtId: "c1", slotId: "s1" });
  f.choose("c1", slot);
  expect(f.selected.value).toBeNull();
  expect(createBooking).not.toHaveBeenCalled();
});
it("preserves the completed booking summary and only reuses the member by explicit choice", async () => {
  const f = fixture();
  f.bookingMode.value = "ASSISTED";
  f.targetMember.value = { id: "member-1", displayName: "测试会员" };
  f.data.value = {
    courts: [{ id: "c1", name: "1号场", enabled: true, usage: "RETAIL" }],
    slots: [{ id: "s1", enabled: true, startMinutes: 600, endMinutes: 660, price: { priceCents: 6000 } }],
    bookings: [], closures: [],
  };
  f.selected.value = { courtId: "c1", slotId: "s1" };
  createBooking.mockResolvedValue({ id: "order-1", orderNo: "YQ-1", payableCents: 6000 });
  await f.submit(true);
  expect(f.assistedOrder.value).toMatchObject({
    id: "order-1", orderNo: "YQ-1", memberId: "member-1", memberName: "测试会员",
    courtName: "1号场", date: "2090-01-01", slotRange: "10:00-11:00", payableCents: 6000,
  });
  expect(f.selected.value).toBeNull();
  f.continueAssistedBooking(true);
  expect(f.targetMember.value.id).toBe("member-1");
  expect(f.assistedOrder.value).toBeNull();
  expect(f.selected.value).toBeNull();
  expect(createBooking).toHaveBeenCalledOnce();
});
it.each([false, true])("does not carry a different member or the last slot into the next booking (%s)", (sameMember) => {
  const f = fixture();
  f.bookingMode.value = "ASSISTED";
  f.assistedOrder.value = { id: "order-1", memberId: "member-1" };
  f.targetMember.value = { id: "member-2", displayName: "另一会员" };
  f.selected.value = { courtId: "c1", slotId: "s1" };
  f.overrideReason.value = "上笔特殊原因";
  f.submissionError.value = "旧提示";
  f.couponCode.value = "旧券";
  f.continueAssistedBooking(sameMember);
  expect(f.targetMember.value).toBeNull();
  expect(f.selected.value).toBeNull();
  expect(f.overrideReason.value).toBe("");
  expect(f.submissionError.value).toBe("");
  expect(f.couponCode.value).toBe("");
});
