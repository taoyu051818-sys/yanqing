import type { YouthTrainingRuleView } from "../../../../types/training-operations";

export function nextYouthRule<T extends YouthTrainingRuleView>(
  rules: T[],
  now = Date.now(),
): T | undefined {
  return rules
    .filter(
      (rule) =>
        rule.status === "PUBLISHED" && Date.parse(rule.effectiveFrom) > now,
    )
    .sort(
      (a, b) => Date.parse(a.effectiveFrom) - Date.parse(b.effectiveFrom),
    )[0];
}

export function youthRuleState(
  rule: YouthTrainingRuleView,
  now = Date.now(),
): string {
  if (rule.status === "DRAFT") return "未发布";
  if (rule.status === "REJECTED") return "已驳回";
  if (Date.parse(rule.effectiveFrom) > now) return "已发布 · 待生效";
  if (rule.effectiveTo && Date.parse(rule.effectiveTo) <= now) return "已结束";
  return "使用中";
}
