import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { VenuePriceRule } from "@yanqing/shared";
import { priceCommand, priceForm, priceStatus } from "./price-editor";
const rule: VenuePriceRule = {
  id: "p1",
  code: "P1",
  version: 1,
  name: "晚场价格",
  timeSlotId: "s1",
  weekdayMask: 127,
  priceCents: 6000,
  newcomerPriceCents: 4000,
  effectiveFrom: "2026-01-01T00:00:00+08:00",
  effectiveTo: "2027-01-01T00:00:00+08:00",
  enabled: true,
  updatedAt: "2026-09-21T00:00:00Z",
};
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-22T08:00:00+08:00"));
});
afterEach(() => {
  vi.useRealTimers();
});
it("preserves hidden newcomer price, source revision and the exact end instant", () => {
  const form = priceForm(rule);
  form.priceYuan = "70";
  expect(priceCommand(form, rule)).toMatchObject({
    priceCents: 7000,
    newcomerPriceCents: 4000,
    sourceRevision: rule.updatedAt,
    effectiveTo: rule.effectiveTo,
    weekdayMask: 127,
  });
});
it("rejects invalid amounts and dates without silently normalizing them", () => {
  expect(() =>
    priceCommand({ ...priceForm(rule), priceYuan: "50.001" }, rule),
  ).toThrow("普通价格");
  expect(() =>
    priceCommand({ ...priceForm(rule), date: "2026-02-30" }, rule),
  ).toThrow("有效日期");
  expect(() =>
    priceCommand({ ...priceForm(rule), priceYuan: "30" }, rule),
  ).toThrow("新客价");
});
it("distinguishes scheduled, active and ended prices at the Beijing date boundary", () => {
  expect(priceStatus(rule, "2026-09-22")).toBe("使用中");
  expect(
    priceStatus(
      { ...rule, effectiveFrom: "2026-09-23T00:00:00+08:00" },
      "2026-09-22",
    ),
  ).toBe("待生效");
  expect(priceStatus(rule, "2027-01-01")).toBe("已结束");
});
