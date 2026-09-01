import { beforeEach, describe, expect, it, vi } from "vitest";

import { mockRequest } from "./router";
import { resetCatalogState } from "./state";

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

describe("mock operations least-privilege contracts", () => {
  beforeEach(() => {
    storage.clear();
    resetCatalogState();
  });

  it("keeps full inventory admin-only while exposing minimal front-desk and event projections", async () => {
    await login("FRONT_DESK");
    await expect(request("GET", "/inventory")).rejects.toThrow("无权");
    const lowStock = await request<any[]>("GET", "/inventory/low-stock");
    expect(Object.keys(lowStock[0] || {}).sort()).toEqual([
      "id",
      "mode",
      "name",
      "safeStock",
      "sku",
      "stock",
    ]);
    const frontDeskAwards = await request<any[]>(
      "GET",
      "/inventory/award-options",
    );
    expect(Object.keys(frontDeskAwards[0]).sort()).toEqual([
      "enabled",
      "id",
      "name",
      "sku",
      "stock",
    ]);
    expect(JSON.stringify(frontDeskAwards)).not.toContain("purchasePriceCents");
    expect(JSON.stringify(frontDeskAwards)).not.toContain("supplier");

    await login("EVENT_MANAGER");
    await expect(request("GET", "/inventory")).rejects.toThrow("无权");
    await expect(request("GET", "/inventory/low-stock")).rejects.toThrow(
      "无权",
    );
    await expect(request("GET", "/inventory/award-options")).resolves.toEqual(
      frontDeskAwards,
    );

    await login("ADMIN");
    await expect(request<any[]>("GET", "/inventory")).resolves.not.toHaveLength(
      0,
    );
  });

  it.each([
    "/inventory/purchase-orders",
    "/inventory/stocktakes",
    "/inventory/operations",
  ])(
    "rejects front desk from the full inventory write workflow at %s",
    async (url) => {
      await login("FRONT_DESK");
      await expect(request("POST", url)).rejects.toThrow("无权");
    },
  );

  it.each(["COACH", "EVENT_MANAGER", "FINANCE", "MERCHANT"])(
    "does not send low-stock work items to %s",
    async (role) => {
      await login(role);
      const workItems = await request<any[]>("GET", "/work-items");
      expect(workItems.some((item) => item.kind === "LOW_STOCK")).toBe(false);
    },
  );

  it("returns finance only the supplier fields required to create consignment statements", async () => {
    await login("FINANCE");
    const suppliers = await request<any[]>(
      "GET",
      "/inventory/consignment/supplier-options",
    );
    expect(suppliers.length).toBeGreaterThan(0);
    expect(Object.keys(suppliers[0]).sort()).toEqual([
      "code",
      "commissionRateBps",
      "enabled",
      "id",
      "name",
      "settlementCycle",
      "type",
    ]);
    expect(JSON.stringify(suppliers)).not.toContain("contactPhone");
    expect(JSON.stringify(suppliers)).not.toContain("settlementRule");
    await expect(request("GET", "/inventory/suppliers")).rejects.toThrow(
      "无权",
    );
  });
});
