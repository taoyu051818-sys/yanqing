import { mockExecutionKey } from "../policies/admin-execution";
import { hasMockRole } from "../policies/common.js";
import { mockUser } from "../core";
import { getYouthTrainingRules, saveYouthTrainingRules } from "../state";
import {
  integer,
  newId,
  requireRole,
  requireText,
  commandHash,
  audit,
} from "./command-policy.js";
import { person } from "./trial-policy.js";

export const youthRulePublicView = (rule: any) => ({
  id: rule.id,
  version: rule.version,
  status: rule.status,
  maxTotalSessions: rule.maxTotalSessions,
  maxValidityDays: rule.maxValidityDays,
  maxContractAmountCents: rule.maxContractAmountCents,
  warningThresholdDays: rule.warningThresholdDays,
  hardBlock: rule.hardBlock,
  effectiveFrom: rule.effectiveFrom,
  effectiveTo: rule.effectiveTo || null,
});

export const youthRuleManagementView = (rule: any) => {
  const requestedBy = person(rule.requestedById);
  const reviewedBy = person(rule.reviewedById);
  return {
    ...youthRulePublicView(rule),
    requestReason: rule.requestReason,
    reviewReason: rule.reviewReason || null,
    reviewedAt: rule.reviewedAt || null,
    createdAt: rule.createdAt,
    updatedAt: rule.updatedAt,
    isOwnRequester: rule.requestedById === mockUser().id,
    requestedBy: requestedBy ? { displayName: requestedBy.displayName } : null,
    reviewedBy: reviewedBy ? { displayName: reviewedBy.displayName } : null,
  };
};

export const activeMockYouthTrainingRule = (at = new Date()) =>
  getYouthTrainingRules()
    .filter(
      (rule) =>
        ["PUBLISHED", "SUPERSEDED"].includes(rule.status) &&
        new Date(rule.effectiveFrom).getTime() <= at.getTime() &&
        (!rule.effectiveTo ||
          new Date(rule.effectiveTo).getTime() > at.getTime()),
    )
    .sort(
      (left, right) =>
        new Date(right.effectiveFrom).getTime() -
        new Date(left.effectiveFrom).getTime(),
    )[0] || null;

export const validateMockYouthProduct = (
  input: {
    totalSessions: number;
    validityDays: number;
    priceCents: number;
  },
  at = new Date(),
) => {
  const rule = activeMockYouthTrainingRule(at);
  if (!rule)
    throw new Error(
      "当前没有已发布且生效的青少年培训监管规则，正式销售已阻断，请管理员先设置并发布规则",
    );
  const violations: string[] = [];
  const warnings: string[] = [];
  if (input.totalSessions > Number(rule.maxTotalSessions))
    violations.push("总课时超过当前规则上限");
  if (input.validityDays > Number(rule.maxValidityDays))
    violations.push("有效期超过当前规则上限");
  if (input.priceCents > Number(rule.maxContractAmountCents))
    violations.push("合同金额超过当前规则上限");
  const validityHeadroom = Number(rule.maxValidityDays) - input.validityDays;
  if (
    validityHeadroom >= 0 &&
    validityHeadroom <= Number(rule.warningThresholdDays)
  )
    warnings.push(`产品有效期距离当前规则上限仅余 ${validityHeadroom} 天`);
  if (violations.length && rule.hardBlock)
    throw new Error(`青少年培训监管规则校验未通过：${violations.join("；")}`);
  return {
    ruleId: rule.id,
    version: rule.version,
    effectiveFrom: rule.effectiveFrom,
    effectiveTo: rule.effectiveTo || null,
    limits: {
      maxTotalSessions: Number(rule.maxTotalSessions),
      maxValidityDays: Number(rule.maxValidityDays),
      maxContractAmountCents: Number(rule.maxContractAmountCents),
      warningThresholdDays: Number(rule.warningThresholdDays),
      hardBlock: Boolean(rule.hardBlock),
    },
    result:
      violations.length || warnings.length
        ? ("WARNING" as const)
        : ("PASS" as const),
    violations,
    warnings,
    validatedAt: at.toISOString(),
  };
};

const createYouthRuleDraft = (data: any) => {
  requireRole("ADMIN", "SUPER_ADMIN");
  const reason = requireText(data.reason, "制单原因", 2, 300);
  const idempotencyKey = requireText(data.idempotencyKey, "幂等键", 8, 100);
  const values = {
    maxTotalSessions: integer(data.maxTotalSessions),
    maxValidityDays: integer(data.maxValidityDays),
    maxContractAmountCents: integer(data.maxContractAmountCents),
    warningThresholdDays: integer(data.warningThresholdDays),
  };
  if (
    values.maxTotalSessions < 1 ||
    values.maxValidityDays < 1 ||
    values.maxContractAmountCents < 1 ||
    values.warningThresholdDays < 0 ||
    values.warningThresholdDays > values.maxValidityDays ||
    typeof data.hardBlock !== "boolean"
  )
    throw new Error("监管规则字段必须完整，预警阈值不能超过最大有效期限");
  if (data.effectiveImmediately && data.effectiveFrom !== undefined)
    throw new Error("立即生效时无需指定生效时间");
  const effectiveFrom = data.effectiveImmediately
    ? new Date()
    : new Date(String(data.effectiveFrom || ""));
  if (!Number.isFinite(effectiveFrom.getTime()))
    throw new Error("监管规则生效时间格式无效");
  const command = {
    kind: "YOUTH_TRAINING_RULE_CREATE",
    ...values,
    hardBlock: data.hardBlock,
    effectiveFrom: data.effectiveImmediately
      ? "IMMEDIATE"
      : effectiveFrom.toISOString(),
    reason,
  };
  const hash = commandHash(command);
  const rules = getYouthTrainingRules();
  const replay = rules.find(
    (rule) => rule.requestIdempotencyKey === idempotencyKey,
  );
  if (replay) {
    if (replay.requestedById !== mockUser().id || replay.commandHash !== hash)
      throw new Error("监管规则制单幂等键已用于其他命令");
    return youthRuleManagementView(replay);
  }
  if (!data.effectiveImmediately && effectiveFrom <= new Date())
    throw new Error("监管规则生效时间必须晚于当前时间");
  const now = new Date().toISOString();
  const rule = {
    id: newId("youth-rule"),
    version: `YTR-${Date.now()}`,
    status: "DRAFT",
    ...values,
    hardBlock: data.hardBlock,
    effectiveFrom: effectiveFrom.toISOString(),
    effectiveTo: null,
    requestReason: reason,
    reviewReason: null,
    requestedById: mockUser().id,
    reviewedById: null,
    requestIdempotencyKey: idempotencyKey,
    decisionIdempotencyKey: null,
    commandHash: hash,
    decisionCommandHash: null,
    reviewedAt: null,
    createdAt: now,
    updatedAt: now,
  };
  saveYouthTrainingRules([rule, ...rules]);
  audit({
    action: "YOUTH_TRAINING_RULE_DRAFTED",
    objectType: "YouthTrainingRule",
    objectId: rule.id,
    reason,
    requestId: idempotencyKey,
    newValue: { status: rule.status, version: rule.version, commandHash: hash },
  });
  return youthRuleManagementView(rule);
};

export const decideYouthRule = (
  ruleId: string,
  decision: "publish" | "reject",
  data: any,
) => {
  requireRole("ADMIN", "SUPER_ADMIN");
  const reason = requireText(data.reason, "复核原因", 2, 300);
  const idempotencyKey = requireText(data.idempotencyKey, "幂等键", 8, 100);
  const target = decision === "publish" ? "PUBLISHED" : "REJECTED";
  const hash = commandHash({
    ...(data.effectiveImmediately ? { effectiveImmediately: true } : {}),
    kind: "YOUTH_TRAINING_RULE_DECIDE",
    ruleId,
    target,
    reason,
  });
  const rules = getYouthTrainingRules();
  const replay = rules.find(
    (rule) => rule.decisionIdempotencyKey === idempotencyKey,
  );
  if (replay) {
    if (
      replay.id !== ruleId ||
      replay.status !== target ||
      replay.reviewedById !== mockUser().id ||
      replay.decisionCommandHash !== hash
    )
      throw new Error("监管规则复核幂等键已用于其他决定");
    return youthRuleManagementView(replay);
  }
  const rule = rules.find((item) => item.id === ruleId);
  if (!rule) throw new Error("青少年监管规则不存在");
  if (
    rule.requestedById === mockUser().id &&
    !hasMockRole("ADMIN", "SUPER_ADMIN")
  )
    throw new Error("监管规则制单人与复核人不能是同一账号");
  if (rule.status !== "DRAFT")
    throw new Error("监管规则已完成复核，不能重复覆盖状态");
  const now = new Date();
  if (target === "PUBLISHED") {
    if (data.effectiveImmediately) rule.effectiveFrom = now.toISOString();
    if (!data.effectiveImmediately && new Date(rule.effectiveFrom) <= now)
      throw new Error("规则预定生效时间已过，请重新制单以避免追溯生效");
    const conflicting = [...rules]
      .sort(
        (a, b) =>
          new Date(a.effectiveFrom).getTime() -
          new Date(b.effectiveFrom).getTime(),
      )
      .find(
        (item) =>
          item.id !== rule.id &&
          ["PUBLISHED", "SUPERSEDED"].includes(item.status) &&
          new Date(item.effectiveFrom) >= new Date(rule.effectiveFrom),
      );
    if (
      conflicting &&
      (!data.effectiveImmediately || new Date(conflicting.effectiveFrom) <= now)
    )
      throw new Error("已有同时间或更晚生效的已发布规则，请先处理版本顺序");
    if (data.effectiveImmediately)
      rule.effectiveTo = conflicting?.effectiveFrom ?? null;
    const previous = rules
      .filter(
        (item) =>
          ["PUBLISHED", "SUPERSEDED"].includes(item.status) &&
          new Date(item.effectiveFrom) < new Date(rule.effectiveFrom) &&
          (!item.effectiveTo ||
            new Date(item.effectiveTo) > new Date(rule.effectiveFrom)),
      )
      .sort(
        (left, right) =>
          new Date(right.effectiveFrom).getTime() -
          new Date(left.effectiveFrom).getTime(),
      )[0];
    if (previous) {
      previous.status = "SUPERSEDED";
      previous.effectiveTo = rule.effectiveFrom;
    }
  }
  const before = rule.status;
  rule.status = target;
  rule.reviewReason = reason;
  rule.reviewedById = mockUser().id;
  rule.reviewedAt = now.toISOString();
  rule.decisionIdempotencyKey = idempotencyKey;
  rule.decisionCommandHash = hash;
  rule.updatedAt = now.toISOString();
  saveYouthTrainingRules(rules);
  audit({
    action:
      target === "PUBLISHED"
        ? "YOUTH_TRAINING_RULE_PUBLISHED"
        : "YOUTH_TRAINING_RULE_REJECTED",
    objectType: "YouthTrainingRule",
    objectId: rule.id,
    reason,
    requestId: idempotencyKey,
    oldValue: { status: before },
    newValue: {
      status: target,
      version: rule.version,
      decisionCommandHash: hash,
    },
  });
  return youthRuleManagementView(rule);
};

export const createYouthRule = (data: any) => {
  const result = createYouthRuleDraft(data);
  return result.status === "DRAFT"
    ? decideYouthRule(result.id, "publish", {
        reason: data.reason,
        effectiveImmediately: data.effectiveImmediately,
        idempotencyKey: mockExecutionKey("youth-rule", data.idempotencyKey),
      })
    : result;
};
