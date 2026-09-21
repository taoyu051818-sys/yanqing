import type { ApplyVenuePriceCommand, VenuePriceRule } from "@yanqing/shared";
import { today, venueDateKey } from "../../../../utils/format";

export const weekdays = [
  { label: "一", bit: 2 },
  { label: "二", bit: 4 },
  { label: "三", bit: 8 },
  { label: "四", bit: 16 },
  { label: "五", bit: 32 },
  { label: "六", bit: 64 },
  { label: "日", bit: 1 },
];
export const weekdayLabel = (mask: number) =>
  mask === 127
    ? "每天"
    : mask === 62
      ? "工作日"
      : mask === 65
        ? "周末"
        : weekdays
            .filter((d) => mask & d.bit)
            .map((d) => `周${d.label}`)
            .join("、");
export function priceStatus(rule: VenuePriceRule, date = today()) {
  if (rule.timeSlot?.enabled === false) return "时段已停售";
  if (!rule.enabled) return "未启用";
  const day = new Date(`${date}T00:00:00+08:00`).getTime();
  if (rule.effectiveTo && +new Date(rule.effectiveTo) <= day) return "已结束";
  if (+new Date(rule.effectiveFrom) > day) return "待生效";
  return "使用中";
}
export function priceForm(source: VenuePriceRule | null) {
  return {
    name: source?.name || "",
    timeSlotId: source?.timeSlotId || "",
    weekdayMask: source?.weekdayMask || 127,
    priceYuan: source ? String(source.priceCents / 100) : "",
    newcomerYuan:
      source?.newcomerPriceCents == null
        ? ""
        : String(source.newcomerPriceCents / 100),
    date:
      source && venueDateKey(source.effectiveFrom) > today()
        ? venueDateKey(source.effectiveFrom)
        : today(),
    endDate: source?.effectiveTo ? venueDateKey(source.effectiveTo) : "",
    reason: "",
  };
}
export type PriceForm = ReturnType<typeof priceForm>;
export function priceCommand(
  form: PriceForm,
  source: VenuePriceRule | null,
): Omit<ApplyVenuePriceCommand, "idempotencyKey"> {
  const cents = (value: string) =>
    /^\d+(\.\d{1,2})?$/.test(value.trim())
      ? Math.round(Number(value) * 100)
      : NaN;
  const priceCents = cents(form.priceYuan);
  if (
    !Number.isSafeInteger(priceCents) ||
    priceCents < 0 ||
    priceCents > 10_000_000
  )
    throw new Error("普通价格请填写 0–100000 元，最多两位小数");
  const newcomerPriceCents = form.newcomerYuan.trim()
    ? cents(form.newcomerYuan)
    : undefined;
  if (
    newcomerPriceCents !== undefined &&
    (!Number.isSafeInteger(newcomerPriceCents) ||
      newcomerPriceCents < 0 ||
      newcomerPriceCents > priceCents)
  )
    throw new Error("新客价不得高于普通价，最多两位小数");
  const dateIso = (date: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("请选择有效日期");
    const parsed = new Date(`${date}T00:00:00+08:00`);
    if (!Number.isFinite(+parsed) || venueDateKey(parsed) !== date)
      throw new Error("请选择有效日期");
    return parsed.toISOString();
  };
  const effectiveFrom = dateIso(form.date);
  if (form.date < today()) throw new Error("生效日期不能早于今天");
  const effectiveTo = source?.enabled
    ? source.effectiveTo || undefined
    : form.endDate
      ? dateIso(form.endDate)
      : undefined;
  if (effectiveTo && +new Date(effectiveTo) <= +new Date(effectiveFrom))
    throw new Error("生效日期须早于结束日期");
  const name = form.name.trim();
  if (name.length < 2 || name.length > 80)
    throw new Error("价格名称需为 2–80 个字");
  if (
    !Number.isInteger(form.weekdayMask) ||
    form.weekdayMask < 1 ||
    form.weekdayMask > 127
  )
    throw new Error("请至少选择一天");
  const reason =
    form.reason.trim() ||
    (source ? "管理员调整场地价格" : "管理员设置场地价格");
  if (reason.length < 2 || reason.length > 300)
    throw new Error("备注需为 2–300 个字，也可以留空");
  return {
    sourceRuleId: source?.id,
    sourceRevision: source?.updatedAt,
    name,
    timeSlotId: source
      ? source.timeSlotId || undefined
      : form.timeSlotId || undefined,
    weekdayMask: source?.weekdayMask || form.weekdayMask,
    priceCents,
    newcomerPriceCents,
    effectiveFrom,
    effectiveTo,
    reason,
  };
}
