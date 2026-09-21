import { beforeEach, expect, it, vi } from "vitest";
import * as vue from "vue";
import * as auth from "../../services/auth-session";
import { loadSfcScript } from "../../test-utils/sfc-script";
const createBooking = vi.fn();
const storage = new Map<string, unknown>();
beforeEach(() => {
  createBooking.mockReset();
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
            assistedAvailability: async () => ({
              courts: [],
              slots: [],
              bookings: [],
              closures: [],
            }),
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
