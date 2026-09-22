import { beforeEach, expect, it, vi } from "vitest";
import { mockRequest } from "./router";
import { mockLogin } from "./core";
import { getPriceRules } from "./state";
import { availability } from "./venue";
const storage = new Map<string, any>();
beforeEach(() => {
  storage.clear();
  vi.stubGlobal("uni", {
    getStorageSync: (k: string) => storage.get(k) || "",
    setStorageSync: (k: string, v: any) => storage.set(k, v),
    removeStorageSync: (k: string) => storage.delete(k),
  });
  mockLogin("SUPER_ADMIN");
});
function command() {
  const source = getPriceRules()[0];
  return {
    sourceRuleId: source.id,
    sourceRevision: source.updatedAt,
    timeSlotId: source.timeSlotId,
    weekdayMask: source.weekdayMask,
    name: source.name,
    priceCents: 7900,
    effectiveFrom: "2090-01-02T00:00:00+08:00",
    effectiveTo: source.effectiveTo,
    reason: "调整场地价格",
    idempotencyKey: "apply-price-test-key",
  };
}
it("switches mock availability at the date boundary and replays exactly once", async () => {
  const dto = command(),
    before = availability("2090-01-01").slots[0].price?.priceCents;
  const result = await mockRequest<any>(
    "POST",
    "/venues/price-rules/apply",
    dto,
  );
  expect(result.enabled).toBe(true);
  expect(availability("2090-01-01").slots[0].price?.priceCents).toBe(before);
  expect(availability("2090-01-02").slots[0].price?.priceCents).toBe(7900);
  expect(
    (await mockRequest<any>("POST", "/venues/price-rules/apply", dto)).id,
  ).toBe(result.id);
  await expect(
    mockRequest("POST", "/venues/price-rules/apply", {
      ...dto,
      idempotencyKey: "another-apply-key",
      priceCents: 8800,
    }),
  ).rejects.toThrow("已被其他操作修改");
});
it("keeps front desk read-only and leaves prices untouched on overlap", async () => {
  const dto = command();
  mockLogin("FRONT_DESK");
  await expect(
    mockRequest("POST", "/venues/price-rules/apply", dto),
  ).rejects.toThrow();
  mockLogin("SUPER_ADMIN");
  const before = JSON.stringify(getPriceRules());
  await expect(
    mockRequest("POST", "/venues/price-rules/apply", {
      ...dto,
      sourceRuleId: undefined,
      sourceRevision: undefined,
    }),
  ).rejects.toThrow("适用范围重叠");
  expect(JSON.stringify(getPriceRules())).toBe(before);
});
