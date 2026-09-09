import type { AppRole } from "../../../types/domain";
import { mockUser } from "../core";
import {
  getCustomerLeads,
  getEnrollments,
  getTrainingTrials,
  saveCustomerLeads,
  saveTrainingTrials,
} from "../state";
import {
  text,
  integer,
  newId,
  hasRole,
  requireRole,
  requireText,
  commandHash,
  audit,
} from "./command-policy.js";
import { assertTrialOperationWindow, trialView } from "./trial-policy.js";

export const transitionTrial = (trialId: string, action: string, data: any) => {
  const roleMap: Record<string, AppRole[]> = {
    "check-in": ["FRONT_DESK", "ADMIN", "SUPER_ADMIN"],
    "no-show": ["FRONT_DESK", "ADMIN", "SUPER_ADMIN"],
    assess: ["COACH", "ADMIN", "SUPER_ADMIN"],
    convert: ["ADMIN", "SUPER_ADMIN"],
    lost: ["ADMIN", "SUPER_ADMIN"],
    cancel: ["FRONT_DESK", "ADMIN", "SUPER_ADMIN"],
  };
  requireRole(...roleMap[action]);
  const reason = requireText(data.reason, "操作原因", 2, 300);
  const idempotencyKey = requireText(data.idempotencyKey, "幂等键", 8, 100);
  const trials = getTrainingTrials();
  const trial = trials.find((item) => item.id === trialId);
  if (!trial) throw new Error("试听记录不存在");
  if (
    action === "assess" &&
    hasRole("COACH") &&
    !hasRole("ADMIN", "SUPER_ADMIN") &&
    trial.coachId !== mockUser().id
  )
    throw new Error("教练只能处理本人试听或本人班级的试听");
  let payload: any = null;
  if (action === "assess") {
    if (!Array.isArray(data.dimensions) || !data.dimensions.length)
      throw new Error("试听测评至少填写一个维度");
    const dimensions = data.dimensions.map((item: any) => ({
      key: requireText(item.key, "测评维度编码", 1, 40),
      label: requireText(item.label, "测评维度名称", 1, 80),
      score: integer(item.score),
      note: text(item.note) || null,
    }));
    if (
      dimensions.some((item: any) => item.score < 1 || item.score > 5) ||
      new Set(dimensions.map((item: any) => item.key)).size !==
        dimensions.length
    )
      throw new Error("测评维度不能重复，分值必须为1-5");
    payload = {
      dimensions,
      recommendation: requireText(data.recommendation, "测评建议", 2, 500),
      note: text(data.note) || null,
    };
  }
  if (action === "convert")
    payload = {
      enrollmentId: requireText(data.enrollmentId, "正式报名 ID", 1, 100),
    };
  const targetMap: Record<string, string> = {
    "check-in": "CHECKED_IN",
    "no-show": "NO_SHOW",
    assess: "ASSESSED",
    convert: "CONVERTED",
    lost: "LOST",
    cancel: "CANCELLED",
  };
  const target = targetMap[action];
  const hash = commandHash({
    kind: `TRAINING_TRIAL_${action.toUpperCase()}`,
    trialId,
    target,
    reason,
    payload,
  });
  const replay = trials
    .flatMap((item) => item.transitions || [])
    .find((item: any) => item.idempotencyKey === idempotencyKey);
  if (replay) {
    if (
      replay.trialId !== trialId ||
      replay.toStatus !== target ||
      replay.actorId !== mockUser().id ||
      replay.commandHash !== hash
    )
      throw new Error("试听动作幂等键已用于其他命令");
    return trialView(trial);
  }
  const expectedMap: Record<string, string[]> = {
    "check-in": ["RESERVED"],
    "no-show": ["RESERVED"],
    assess: ["CHECKED_IN"],
    convert: ["ASSESSED"],
    lost: ["ASSESSED", "NO_SHOW"],
    cancel: ["RESERVED", "NO_SHOW"],
  };
  if (!expectedMap[action].includes(trial.status))
    throw new Error(`试听当前状态 ${trial.status} 不允许执行 ${action}`);
  const timeWindowPolicy =
    action === "check-in"
      ? assertTrialOperationWindow(trial, "ATTENDANCE", reason)
      : action === "no-show"
        ? assertTrialOperationWindow(trial, "COMPLETION", reason)
        : null;
  if (action === "convert") {
    const enrollment = getEnrollments().find(
      (item) => item.id === payload.enrollmentId,
    );
    if (
      !enrollment ||
      !["ACTIVE", "PARTIALLY_REFUNDED"].includes(enrollment.status)
    )
      throw new Error("正式课报名不存在或尚未完成支付激活");
    const enrollmentProductId = enrollment.productId || enrollment.product?.id;
    if (enrollmentProductId !== trial.productId)
      throw new Error("正式课报名产品与试听产品不一致");
    const buyerId = enrollment.buyerId || "user-member";
    const matches = trial.studentId
      ? enrollment.studentId === trial.studentId && buyerId === trial.guardianId
      : !enrollment.studentId &&
        buyerId ===
          (trial.memberId ||
            getCustomerLeads().find((lead) => lead.id === trial.leadId)
              ?.convertedMemberId);
    if (!matches) throw new Error("正式课报名不属于本次试听学员或监护人");
    trial.convertedEnrollmentId = enrollment.id;
    trial.memberId = trial.memberId || buyerId;
  }
  const now = new Date().toISOString();
  const before = trial.status;
  trial.status = target;
  trial.updatedAt = now;
  if (target === "CHECKED_IN") trial.checkedInAt = now;
  if (target === "NO_SHOW") trial.noShowAt = now;
  if (target === "ASSESSED") {
    trial.assessmentDimensions = payload.dimensions;
    trial.recommendation = payload.recommendation;
    trial.assessmentNote = payload.note;
    trial.assessedAt = now;
  }
  if (target === "CONVERTED") trial.convertedAt = now;
  if (target === "LOST") trial.lostAt = now;
  if (target === "CANCELLED") trial.cancelledAt = now;
  trial.transitions = [
    ...(trial.transitions || []),
    {
      id: newId("trial-transition"),
      trialId,
      fromStatus: before,
      toStatus: target,
      action: action.toUpperCase(),
      reason,
      payload: {
        ...(payload || {}),
        ...(timeWindowPolicy ? { timeWindowPolicy } : {}),
      },
      commandHash: hash,
      idempotencyKey,
      actorId: mockUser().id,
      createdAt: now,
    },
  ];
  saveTrainingTrials(trials);
  const leads = getCustomerLeads();
  const lead = leads.find((item) => item.id === trial.leadId);
  if (lead) {
    const statusAfter =
      target === "CHECKED_IN"
        ? "ATTENDED"
        : target === "CONVERTED"
          ? "CONVERTED"
          : target === "LOST"
            ? "LOST"
            : lead.status;
    lead.followUps = [
      ...(lead.followUps || []),
      {
        id: newId("lead-follow-up"),
        kind: `TRIAL_${action.toUpperCase()}`,
        content: reason,
        statusBefore: lead.status,
        statusAfter,
        actorId: mockUser().id,
        createdAt: now,
      },
    ];
    lead.status = statusAfter;
    if (target === "CONVERTED") {
      lead.convertedMemberId = trial.memberId;
      lead.convertedAt = now;
    }
    if (target === "LOST") {
      lead.lostAt = now;
      lead.lostReason = reason;
    }
    saveCustomerLeads(leads);
  }
  audit({
    action: `TRAINING_TRIAL_${action.toUpperCase()}`,
    objectType: "TrainingTrial",
    objectId: trial.id,
    reason,
    requestId: idempotencyKey,
    oldValue: { status: before },
    newValue: {
      status: target,
      commandHash: hash,
      ...payload,
      timeWindowPolicy,
    },
  });
  return trialView(trial);
};
