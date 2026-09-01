import { beforeEach, describe, expect, it, vi } from "vitest";

import { mockRequest } from "./router";
import { resetCatalogState } from "./state";
import { getOrders } from "./venue";

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

const login = (role: string) =>
  request("POST", "/auth/dev-login", { role });

describe("commercial master data mock state machines", () => {
  beforeEach(async () => {
    storage.clear();
    resetCatalogState();
    await login("ADMIN");
  });

  it("creates, replays and activates a membership product without exposing command evidence", async () => {
    const command = {
      code: "MEMBER_FAMILY_YEAR",
      name: "家庭年度会员",
      level: "GOLD",
      priceCents: 89_900,
      durationDays: 365,
      benefits: { booking: "提前14天", discount: "场地9折" },
      effectiveFrom: "2026-01-01T00:00:00.000Z",
      effectiveTo: "2099-01-01T00:00:00.000Z",
      reason: "新增家庭会员产品",
      idempotencyKey: "membership-family-create-v1",
    };
    const created = await request(
      "POST",
      "/memberships/products",
      command,
    );
    await expect(
      request("POST", "/memberships/products", command),
    ).resolves.toEqual(created);
    expect(created).toMatchObject({
      code: command.code,
      version: 1,
      enabled: false,
    });
    expect(created).not.toHaveProperty("creationIdempotencyKey");
    expect(created).not.toHaveProperty("creationCommandHash");

    const status = {
      enabled: true,
      reason: "批准家庭会员上线",
      idempotencyKey: "membership-family-enable-v1",
    };
    const enabled = await request(
      "POST",
      `/memberships/products/${created.id}/status`,
      status,
    );
    const replay = await request(
      "POST",
      `/memberships/products/${created.id}/status`,
      status,
    );
    expect(enabled).toMatchObject({ enabled: true, idempotent: false });
    expect(replay).toMatchObject({ enabled: true, idempotent: true });
    expect(replay.transition).not.toHaveProperty("idempotencyKey");
    expect(replay.transition).not.toHaveProperty("commandHash");

    await login("MEMBER");
    const publicProducts = await request<any[]>("GET", "/memberships/products");
    expect(publicProducts.some((product) => product.id === created.id)).toBe(true);
    const order = await request("POST", "/memberships/purchase", {
      productId: created.id,
      creationIdempotencyKey: "membership-family-purchase",
    });
    expect(order).not.toHaveProperty("parameterSnapshot");
    expect(
      getOrders().find((item) => item.id === order.id)?.parameterSnapshot,
    ).toMatchObject({
      productId: created.id,
      productCode: command.code,
      productVersion: 1,
      priceCents: command.priceCents,
      effectiveFrom: command.effectiveFrom,
      effectiveTo: command.effectiveTo,
    });
  });

  it("blocks overlapping product versions and preserves front-desk read-only access", async () => {
    const products = await request<any[]>("GET", "/memberships/products/manage");
    const source = products.find((product) => product.code === "MEMBER_GOLD_YEAR");
    const created = await request("POST", `/memberships/products/${source.id}/versions`, {
      name: "金卡会员2027",
      level: "GOLD",
      priceCents: 79_900,
      durationDays: 365,
      benefits: { booking: "提前14天", discount: "场地88折" },
      effectiveFrom: "2027-01-01T00:00:00.000Z",
      effectiveTo: "2028-01-01T00:00:00.000Z",
      reason: "派生下一年度版本",
      idempotencyKey: "membership-gold-create-v2",
    });
    await expect(request("POST", `/memberships/products/${created.id}/status`, {
      enabled: true,
      reason: "尝试启用重叠版本",
      idempotencyKey: "membership-gold-enable-overlap",
    })).rejects.toThrow("有效期与当前版本重叠");

    await login("FRONT_DESK");
    await expect(request("GET", "/memberships/products/manage"))
      .resolves.toEqual(expect.any(Array));
    await expect(request("POST", "/memberships/products", {
      code: "MEMBER_FORBIDDEN",
    })).rejects.toThrow("当前角色无权");
  });

  it("versions a price rule, rejects ambiguity, then changes availability after an audited cutover", async () => {
    const rules = await request<any[]>("GET", "/venues/price-rules/manage");
    const source = rules.find((rule) => rule.id === "price-rule-1");
    const created = await request("POST", `/venues/price-rules/${source.id}/versions`, {
      name: "晨练基础价2027",
      timeSlotId: "slot-1",
      weekdayMask: 127,
      priceCents: 7_200,
      newcomerPriceCents: 5_000,
      effectiveFrom: "2026-01-01T00:00:00.000Z",
      effectiveTo: "2099-01-01T00:00:00.000Z",
      reason: "调整晨练价格",
      idempotencyKey: "price-s01-create-v2",
    });
    await expect(request("POST", `/venues/price-rules/${created.id}/status`, {
      enabled: true,
      reason: "尝试启用重叠价格",
      idempotencyKey: "price-s01-enable-overlap",
    })).rejects.toThrow("有效期与当前版本重叠");

    await request("POST", `/venues/price-rules/${source.id}/status`, {
      enabled: false,
      reason: "切换到晨练新版本",
      idempotencyKey: "price-s01-disable-v1",
    });
    const enabled = await request("POST", `/venues/price-rules/${created.id}/status`, {
      enabled: true,
      reason: "启用晨练新版本",
      idempotencyKey: "price-s01-enable-v2",
    });
    expect(enabled).toMatchObject({ enabled: true, idempotent: false });

    const availability = await request<any>("GET", "/venues/availability", {
      date: "2026-08-30",
    });
    expect(availability.slots.find((slot: any) => slot.id === "slot-1").price)
      .toEqual({
        priceCents: 7_200,
        newcomerPriceCents: 5_000,
      });
  });

  it("rejects a second active price source for the same slot and weekday range", async () => {
    const created = await request("POST", "/venues/price-rules", {
      code: "PRICE_S1_COMPETING",
      name: "晨练竞争价格",
      timeSlotId: "slot-1",
      weekdayMask: 2,
      priceCents: 6_600,
      newcomerPriceCents: 4_600,
      effectiveFrom: "2026-01-01T00:00:00.000Z",
      effectiveTo: "2099-01-01T00:00:00.000Z",
      reason: "验证价格唯一性",
      idempotencyKey: "price-s01-competing-create",
    });
    await expect(request("POST", `/venues/price-rules/${created.id}/status`, {
      enabled: true,
      reason: "尝试启用竞争规则",
      idempotencyKey: "price-s01-competing-enable",
    })).rejects.toThrow("不能产生不确定价格");
  });
});
