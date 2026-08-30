import type { AppRole } from "../../types/domain";
import { mockUser } from "./core";
import { getOrders } from "./venue";
import {
  getAuditLogs,
  getCustomerLeads,
  getEnrollments,
  getGovernanceUsers,
  getStudents,
  getSystemParameters,
  getTrainingProducts,
  getTrainingSessions,
  getTrainingTrials,
  getYouthTrainingRules,
  saveAuditLogs,
  saveCustomerLeads,
  saveTrainingProducts,
  saveTrainingTrials,
  saveYouthTrainingRules,
} from "./state";

export type MockTrainingRoute =
  | { handled: false }
  | { handled: true; value: any };

const activeTrialStatuses = ["RESERVED", "CHECKED_IN", "ASSESSED"];

const text = (value: unknown) =>
  typeof value === "string" ? value.trim() : "";
const integer = (value: unknown) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : NaN;
};
const newId = (prefix: string) =>
  `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const roles = (): AppRole[] =>
  mockUser().roles.map((role: any) =>
    typeof role === "string" ? role : role.role,
  );
const hasRole = (...allowed: AppRole[]) =>
  allowed.some((role) => roles().includes(role));
const requireRole = (...allowed: AppRole[]) => {
  if (!hasRole(...allowed))
    throw new Error(`当前角色无权执行该操作，需要：${allowed.join("、")}`);
};
const requireText = (
  value: unknown,
  label: string,
  min: number,
  max: number,
) => {
  const normalized = text(value);
  if (normalized.length < min || normalized.length > max)
    throw new Error(`${label}长度必须为${min}-${max}个字符`);
  return normalized;
};
const optionalId = (value: unknown, label: string) => {
  if (value === undefined || value === null || value === "") return null;
  const normalized = text(value);
  if (!normalized) throw new Error(`${label}不能为空白字符`);
  return normalized;
};

const assertTrialOperationWindow = (
  trial: any,
  kind: "ATTENDANCE" | "COMPLETION",
  reason: string,
) => {
  const observedAt = new Date();
  const parameterKey =
    kind === "ATTENDANCE"
      ? "training.attendance_window.v1"
      : "training.completion_window.v1";
  const defaults =
    kind === "ATTENDANCE"
      ? { earlyMinutes: 30, lateMinutes: 120 }
      : { earlyMinutes: 0, lateMinutes: 240 };
  const parameter = getSystemParameters()
    .filter(
      (item) =>
        item.key === parameterKey &&
        new Date(item.effectiveFrom).getTime() <= observedAt.getTime() &&
        (!item.effectiveTo ||
          new Date(item.effectiveTo).getTime() > observedAt.getTime()),
    )
    .sort(
      (left, right) =>
        new Date(right.effectiveFrom).getTime() -
        new Date(left.effectiveFrom).getTime(),
    )[0];
  const configured = parameter?.value as any;
  const valid =
    configured?.version === 1 &&
    Number.isInteger(configured.earlyMinutes) &&
    configured.earlyMinutes >= 0 &&
    configured.earlyMinutes <= 240 &&
    Number.isInteger(configured.lateMinutes) &&
    configured.lateMinutes >= 0 &&
    configured.lateMinutes <= 240;
  const earlyMinutes = valid ? configured.earlyMinutes : defaults.earlyMinutes;
  const lateMinutes = valid ? configured.lateMinutes : defaults.lateMinutes;
  const scheduledStartsAt = new Date(
    kind === "ATTENDANCE"
      ? trial.scheduledStartsAt
      : trial.scheduledEndsAt,
  );
  const scheduledEndsAt = new Date(
    kind === "ATTENDANCE" ? trial.scheduledEndsAt : trial.scheduledEndsAt,
  );
  const earliestAt = new Date(
    scheduledStartsAt.getTime() - earlyMinutes * 60_000,
  );
  const latestAt = new Date(
    scheduledEndsAt.getTime() + lateMinutes * 60_000,
  );
  if (observedAt < earliestAt)
    throw new Error("未到允许操作窗口，不能提前办理试听状态");
  const snapshot = {
    parameterId: valid ? parameter?.id || null : null,
    parameterKey,
    source: valid
      ? "SYSTEM_PARAMETER"
      : parameter
        ? "DEFAULT_INVALID_PARAMETER"
        : "DEFAULT_MISSING_PARAMETER",
    earlyMinutes,
    lateMinutes,
    scheduledStartsAt: scheduledStartsAt.toISOString(),
    scheduledEndsAt: scheduledEndsAt.toISOString(),
    earliestAt: earliestAt.toISOString(),
    latestAt: latestAt.toISOString(),
    observedAt: observedAt.toISOString(),
    decision: "WITHIN_WINDOW",
  };
  if (observedAt <= latestAt) return snapshot;
  if (!hasRole("ADMIN", "SUPER_ADMIN"))
    throw new Error("已超过允许操作窗口，仅管理员可历史补录");
  if (reason.length < 2 || reason.length > 300)
    throw new Error("管理员历史补录必须填写2-300个字符的原因");
  snapshot.decision = "ADMIN_HISTORICAL_OVERRIDE";
  audit({
    action:
      kind === "ATTENDANCE"
        ? "TRAINING_TRIAL_CHECK_IN_HISTORICAL_OVERRIDE"
        : "TRAINING_TRIAL_NO_SHOW_HISTORICAL_OVERRIDE",
    objectType: "TrainingTrial",
    objectId: trial.id,
    reason,
    requestId: `${trial.id}:${kind}:historical`,
    newValue: snapshot,
  });
  return snapshot;
};

const normalize = (value: any): any => {
  if (value === undefined) return null;
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(normalize);
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, normalize(value[key])]),
  );
};

const commandHash = (command: unknown) => {
  const value = JSON.stringify(normalize(command));
  let left = 0x811c9dc5;
  let right = 0x9e3779b9;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    left = Math.imul(left ^ code, 0x01000193);
    right = Math.imul(right ^ code, 0x85ebca6b);
  }
  const seed = `${(left >>> 0).toString(16).padStart(8, "0")}${(
    right >>> 0
  )
    .toString(16)
    .padStart(8, "0")}`;
  return seed.repeat(4);
};

const audit = (input: {
  action: string;
  objectType: string;
  objectId: string;
  reason: string;
  requestId: string;
  oldValue?: any;
  newValue?: any;
}) => {
  saveAuditLogs([
    {
      id: newId("audit"),
      actorId: mockUser().id,
      actor: { id: mockUser().id, displayName: mockUser().displayName },
      actorRole: mockUser().primaryRole,
      result: "SUCCESS",
      createdAt: new Date().toISOString(),
      ...input,
    },
    ...getAuditLogs(),
  ]);
};

const classContext = (classId: string | null) => {
  if (!classId) return null;
  for (const product of getTrainingProducts()) {
    const trainingClass = (product.classes || []).find(
      (item: any) => item.id === classId,
    );
    if (trainingClass)
      return {
        ...trainingClass,
        productId: trainingClass.productId || product.id,
        product,
      };
  }
  return null;
};

const person = (id: string | null) => {
  if (!id) return null;
  const user = getGovernanceUsers().find((item) => item.id === id);
  if (user) return { id: user.id, displayName: user.displayName };
  const known: Record<string, string> = {
    "user-member": "延庆会员小林",
    "member-1": "延庆会员小林",
    "member-2": "羽友小周",
    "user-coach": "王教练",
    "user-frontdesk": "前台小羽",
    "user-admin": "金羽管理员",
    "user-super": "超级管理员",
  };
  return known[id] ? { id, displayName: known[id] } : null;
};

const trialView = (trial: any) => {
  const product = getTrainingProducts().find(
    (item) => item.id === trial.productId,
  );
  const trainingClass = classContext(trial.classId);
  const session = getTrainingSessions().find(
    (item) => item.id === trial.sessionId,
  );
  const lead = getCustomerLeads().find((item) => item.id === trial.leadId);
  const student = getStudents().find((item) => item.id === trial.studentId);
  const enrollment = getEnrollments().find(
    (item) => item.id === trial.convertedEnrollmentId,
  );
  return {
    ...trial,
    lead: lead
      ? {
          id: lead.id,
          displayName: lead.displayName,
          status: lead.status,
          sourceChannel: lead.sourceChannel,
          campaign: lead.campaign,
          convertedMemberId: lead.convertedMemberId,
        }
      : null,
    student: student
      ? {
          id: student.id,
          displayName: student.displayName,
          guardianId: student.guardianId,
        }
      : null,
    guardian: person(trial.guardianId),
    member: person(trial.memberId),
    product,
    class: trainingClass,
    session,
    coach: person(trial.coachId),
    convertedEnrollment: enrollment || null,
    transitions: (trial.transitions || []).map((transition: any) => ({
      ...transition,
      actor: person(transition.actorId),
    })),
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
      "当前没有已发布且生效的青少年培训监管规则，正式销售已阻断，请先完成 ADMIN 制单与 SUPER_ADMIN 复核发布",
    );
  const violations: string[] = [];
  const warnings: string[] = [];
  if (input.totalSessions > Number(rule.maxTotalSessions))
    violations.push("总课时超过当前规则上限");
  if (input.validityDays > Number(rule.maxValidityDays))
    violations.push("有效期超过当前规则上限");
  if (input.priceCents > Number(rule.maxContractAmountCents))
    violations.push("合同金额超过当前规则上限");
  const validityHeadroom =
    Number(rule.maxValidityDays) - input.validityDays;
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
      violations.length || warnings.length ? ("WARNING" as const) : ("PASS" as const),
    violations,
    warnings,
    validatedAt: at.toISOString(),
  };
};

export const decorateMockTrainingEnrollment = (enrollment: any) => {
  const warnings: string[] = [];
  if (enrollment.product?.audience === "YOUTH") {
    const remainingDays = Math.ceil(
      (new Date(enrollment.expiresAt).getTime() - Date.now()) / 86_400_000,
    );
    const rule = activeMockYouthTrainingRule();
    if (remainingDays <= 0) warnings.push("青少年课包已到期");
    else if (rule && remainingDays <= Number(rule.warningThresholdDays))
      warnings.push(
        `青少年课包将在 ${remainingDays} 天内到期（当前规则预警阈值 ${rule.warningThresholdDays} 天）`,
      );
  }
  const order = getOrders().find((item) => item.id === enrollment.orderId);
  return {
    ...enrollment,
    order: order
      ? { parameterSnapshot: order.parameterSnapshot, status: order.status }
      : enrollment.order,
    regulatoryWarnings: warnings,
  };
};

const reserveTrial = (data: any) => {
  requireRole("FRONT_DESK", "ADMIN", "SUPER_ADMIN");
  const reason = requireText(data.reason, "操作原因", 2, 300);
  const idempotencyKey = requireText(data.idempotencyKey, "幂等键", 8, 100);
  const leadId = optionalId(data.leadId, "线索 ID");
  const studentId = optionalId(data.studentId, "学员 ID");
  const memberId = optionalId(data.memberId, "会员 ID");
  const productId = requireText(data.productId, "产品 ID", 1, 100);
  const requestedClassId = optionalId(data.classId, "班级 ID");
  const requestedSessionId = optionalId(data.sessionId, "课次 ID");
  const coachId = requireText(data.coachId, "教练 ID", 1, 100);
  if (studentId) {
    if (memberId)
      throw new Error(
        "青少年试听以学员为唯一主体，监护人由学员档案关联，不能再指定会员主体",
      );
  } else if (Number(Boolean(leadId)) + Number(Boolean(memberId)) !== 1) {
    throw new Error("成人试听必须在线索与会员中选择且仅选择一个主体");
  }
  const startsAt = new Date(String(data.scheduledStartsAt || ""));
  const endsAt = new Date(String(data.scheduledEndsAt || ""));
  if (
    !Number.isFinite(startsAt.getTime()) ||
    !Number.isFinite(endsAt.getTime()) ||
    endsAt <= startsAt
  )
    throw new Error("试听结束时间必须晚于开始时间");
  const command = {
    kind: "TRAINING_TRIAL_RESERVE",
    leadId,
    studentId,
    memberId,
    productId,
    classId: requestedClassId,
    sessionId: requestedSessionId,
    coachId,
    sourceChannel: text(data.sourceChannel),
    scheduledStartsAt: startsAt.toISOString(),
    scheduledEndsAt: endsAt.toISOString(),
    reason,
  };
  const hash = commandHash(command);
  const trials = getTrainingTrials();
  const replay = trials.find(
    (trial) => trial.creationIdempotencyKey === idempotencyKey,
  );
  if (replay) {
    if (
      replay.createdById !== mockUser().id ||
      replay.creationCommandHash !== hash
    )
      throw new Error("试听预约幂等键已用于其他命令");
    return trialView(replay);
  }
  if (startsAt <= new Date()) throw new Error("试听开始时间必须晚于当前时间");
  const product = getTrainingProducts().find(
    (item) => item.id === productId && item.enabled !== false,
  );
  if (!product) throw new Error("试听培训产品不存在或已下架");
  const student = studentId
    ? getStudents().find((item) => item.id === studentId)
    : null;
  if (studentId && !student) throw new Error("青少年学员不存在");
  if (student && !student.guardianConsentStatus)
    throw new Error("青少年学员尚未完成监护人授权");
  if (product.audience === "YOUTH" && !student)
    throw new Error("青少年试听必须关联已授权学员与监护人");
  if (product.audience === "ADULT" && student)
    throw new Error("成人试听不能关联青少年学员档案");
  const leads = getCustomerLeads();
  const lead = leadId ? leads.find((item) => item.id === leadId) : null;
  if (
    leadId &&
    (!lead || !["NEW", "CONTACTING", "TRIAL_RESERVED"].includes(lead.status))
  )
    throw new Error("线索不存在或已进入终态，不能预约试听");
  if (memberId && !person(memberId)) throw new Error("试听会员不存在或账号不可用");
  const coach = person(coachId);
  if (!coach || coachId !== "user-coach")
    throw new Error("试听教练不存在、已停用或没有教练角色");
  let selectedSession = requestedSessionId
    ? getTrainingSessions().find((item) => item.id === requestedSessionId)
    : null;
  let selectedClass = classContext(
    requestedClassId || selectedSession?.classId || null,
  );
  if (!selectedClass) throw new Error("试听必须关联有效班级或已排课次");
  if (selectedClass.product.id !== product.id)
    throw new Error("试听班级不属于所选产品");
  if (
    selectedClass.coachId &&
    ![selectedClass.coachId, selectedClass.assistantId].includes(coachId)
  )
    throw new Error("试听教练必须是所选班级的教练或助教");
  if (!selectedSession) {
    selectedSession = getTrainingSessions().find(
      (item) =>
        item.classId === selectedClass!.id &&
        item.status === "SCHEDULED" &&
        new Date(item.startsAt).getTime() <= startsAt.getTime() &&
        new Date(item.endsAt).getTime() >= endsAt.getTime(),
    );
  }
  if (
    !selectedSession ||
    selectedSession.status !== "SCHEDULED" ||
    selectedSession.classId !== selectedClass.id ||
    new Date(selectedSession.startsAt).getTime() > startsAt.getTime() ||
    new Date(selectedSession.endsAt).getTime() < endsAt.getTime() ||
    !(selectedSession.courtIds || []).length
  )
    throw new Error("试听时段必须位于有场地资源的待开课次内");
  const subjectIds = [leadId, studentId, memberId].filter(Boolean);
  const overlap = trials.find(
    (trial) =>
      activeTrialStatuses.includes(trial.status) &&
      new Date(trial.scheduledStartsAt).getTime() < endsAt.getTime() &&
      new Date(trial.scheduledEndsAt).getTime() > startsAt.getTime() &&
      (trial.coachId === coachId ||
        subjectIds.some((id) =>
          [trial.leadId, trial.studentId, trial.memberId].includes(id),
        )),
  );
  if (overlap)
    throw new Error(
      overlap.coachId === coachId
        ? "试听教练在所选时段已有其他试听"
        : "试听对象在所选时段已有其他预约",
    );
  const now = new Date().toISOString();
  const trial = {
    id: newId("training-trial"),
    trialNo: `TRY${Date.now()}`,
    status: "RESERVED",
    leadId,
    studentId,
    guardianId: student?.guardianId || null,
    memberId,
    productId,
    classId: selectedClass.id,
    sessionId: selectedSession.id,
    coachId,
    sourceChannel: lead?.sourceChannel || text(data.sourceChannel),
    scheduledStartsAt: startsAt.toISOString(),
    scheduledEndsAt: endsAt.toISOString(),
    assessmentDimensions: null,
    recommendation: null,
    assessmentNote: null,
    convertedEnrollmentId: null,
    createdById: mockUser().id,
    creationIdempotencyKey: idempotencyKey,
    creationCommandHash: hash,
    checkedInAt: null,
    noShowAt: null,
    assessedAt: null,
    convertedAt: null,
    lostAt: null,
    cancelledAt: null,
    transitions: [
      {
        id: newId("trial-transition"),
        fromStatus: null,
        toStatus: "RESERVED",
        action: "RESERVE",
        reason,
        commandHash: hash,
        idempotencyKey,
        actorId: mockUser().id,
        createdAt: now,
      },
    ],
    createdAt: now,
    updatedAt: now,
  };
  saveTrainingTrials([trial, ...trials]);
  if (lead) {
    lead.followUps = [
      ...(lead.followUps || []),
      {
        id: newId("lead-follow-up"),
        kind: "TRIAL_RESERVED",
        content: reason,
        statusBefore: lead.status,
        statusAfter: "TRIAL_RESERVED",
        actorId: mockUser().id,
        createdAt: now,
      },
    ];
    lead.status = "TRIAL_RESERVED";
    lead.updatedAt = now;
    saveCustomerLeads(leads);
  }
  audit({
    action: "TRAINING_TRIAL_RESERVED",
    objectType: "TrainingTrial",
    objectId: trial.id,
    reason,
    requestId: idempotencyKey,
    oldValue: { status: null },
    newValue: { status: "RESERVED", commandHash: hash },
  });
  return trialView(trial);
};

const transitionTrial = (trialId: string, action: string, data: any) => {
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
      new Set(dimensions.map((item: any) => item.key)).size !== dimensions.length
    )
      throw new Error("测评维度不能重复，分值必须为1-5");
    payload = {
      dimensions,
      recommendation: requireText(data.recommendation, "测评建议", 2, 500),
      note: text(data.note) || null,
    };
  }
  if (action === "convert")
    payload = { enrollmentId: requireText(data.enrollmentId, "正式报名 ID", 1, 100) };
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
    if (!enrollment || !["ACTIVE", "PARTIALLY_REFUNDED"].includes(enrollment.status))
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
    newValue: { status: target, commandHash: hash, ...payload, timeWindowPolicy },
  });
  return trialView(trial);
};

const createYouthRule = (data: any) => {
  requireRole("ADMIN");
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
  const effectiveFrom = new Date(String(data.effectiveFrom || ""));
  if (!Number.isFinite(effectiveFrom.getTime()))
    throw new Error("监管规则生效时间格式无效");
  const command = {
    kind: "YOUTH_TRAINING_RULE_CREATE",
    ...values,
    hardBlock: data.hardBlock,
    effectiveFrom: effectiveFrom.toISOString(),
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
    return replay;
  }
  if (!Number.isFinite(effectiveFrom.getTime()) || effectiveFrom <= new Date())
    throw new Error("监管规则生效时间必须晚于当前时间，以便完成异人复核");
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
  return rule;
};

const decideYouthRule = (
  ruleId: string,
  decision: "publish" | "reject",
  data: any,
) => {
  requireRole("SUPER_ADMIN");
  const reason = requireText(data.reason, "复核原因", 2, 300);
  const idempotencyKey = requireText(data.idempotencyKey, "幂等键", 8, 100);
  const target = decision === "publish" ? "PUBLISHED" : "REJECTED";
  const hash = commandHash({
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
    return replay;
  }
  const rule = rules.find((item) => item.id === ruleId);
  if (!rule) throw new Error("青少年监管规则不存在");
  if (rule.requestedById === mockUser().id)
    throw new Error("监管规则制单人与复核人不能是同一账号");
  if (rule.status !== "DRAFT")
    throw new Error("监管规则已完成复核，不能重复覆盖状态");
  const now = new Date();
  if (target === "PUBLISHED") {
    if (new Date(rule.effectiveFrom) <= now)
      throw new Error("规则预定生效时间已过，请重新制单以避免追溯生效");
    const conflicting = rules.find(
      (item) =>
        item.id !== rule.id &&
        item.status === "PUBLISHED" &&
        new Date(item.effectiveFrom) >= new Date(rule.effectiveFrom),
    );
    if (conflicting)
      throw new Error("已有同时间或更晚生效的已发布规则，请先处理版本顺序");
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
    newValue: { status: target, version: rule.version, decisionCommandHash: hash },
  });
  return rule;
};

const updateTrainingProduct = (productId: string, data: any) => {
  requireRole("ADMIN", "SUPER_ADMIN");
  const reason = requireText(data.reason, "变更原因", 2, 300);
  const idempotencyKey = requireText(data.idempotencyKey, "幂等键", 8, 100);
  const products = getTrainingProducts();
  const product = products.find((item) => item.id === productId);
  if (!product) throw new Error("培训产品不存在");
  const next = {
    name: data.name === undefined ? product.name : requireText(data.name, "产品名称", 1, 100),
    totalSessions:
      data.totalSessions === undefined
        ? Number(product.totalSessions)
        : integer(data.totalSessions),
    validityDays:
      data.validityDays === undefined
        ? Number(product.validityDays)
        : integer(data.validityDays),
    priceCents:
      data.priceCents === undefined ? Number(product.priceCents) : integer(data.priceCents),
    refundRule: data.refundRule === undefined ? product.refundRule || {} : data.refundRule,
    enabled: data.enabled === undefined ? product.enabled !== false : data.enabled === true,
  };
  if (
    next.totalSessions < 1 ||
    next.validityDays < 1 ||
    next.priceCents < 1 ||
    !next.refundRule ||
    typeof next.refundRule !== "object" ||
    Array.isArray(next.refundRule)
  )
    throw new Error("培训产品课次、有效期、售价和退费规则必须完整");
  const hash = commandHash({ kind: "TRAINING_PRODUCT_UPDATE", productId, ...next, reason });
  const replay = getAuditLogs().find(
    (entry) =>
      entry.action === "TRAINING_PRODUCT_UPDATED" &&
      entry.requestId === idempotencyKey,
  );
  if (replay) {
    if (
      replay.objectId !== productId ||
      replay.actorId !== mockUser().id ||
      replay.newValue?.commandHash !== hash
    )
      throw new Error("产品变更幂等键已用于其他命令");
    return product;
  }
  const regulatoryValidation =
    product.audience === "YOUTH" && next.enabled
      ? validateMockYouthProduct(next)
      : null;
  const before = { ...product };
  Object.assign(product, next, {
    unitRevenueCents: Math.round(next.priceCents / next.totalSessions),
    updatedAt: new Date().toISOString(),
  });
  saveTrainingProducts(products);
  audit({
    action: "TRAINING_PRODUCT_UPDATED",
    objectType: "TrainingProduct",
    objectId: product.id,
    reason,
    requestId: idempotencyKey,
    oldValue: before,
    newValue: { ...next, regulatoryValidation, commandHash: hash },
  });
  return { ...product, regulatoryValidation };
};

export function routeMockTrainingOperations(
  method: string,
  url: string,
  data: any = {},
): MockTrainingRoute {
  if (url === "/training/trials/mine" && method === "GET") {
    const userId = mockUser().id;
    return {
      handled: true,
      value: getTrainingTrials()
        .filter(
          (trial) =>
            trial.memberId === userId || trial.guardianId === userId,
        )
        .map(trialView),
    };
  }
  if (url === "/training/trials" && method === "GET") {
    requireRole("COACH", "FRONT_DESK", "ADMIN", "SUPER_ADMIN");
    const coachOnly = hasRole("COACH") && !hasRole("FRONT_DESK", "ADMIN", "SUPER_ADMIN");
    return {
      handled: true,
      value: getTrainingTrials()
        .filter(
          (trial) =>
            (!data.status || trial.status === data.status) &&
            (!coachOnly || trial.coachId === mockUser().id),
        )
        .map(trialView),
    };
  }
  if (url === "/training/trials" && method === "POST")
    return { handled: true, value: reserveTrial(data) };
  const trialAction = url.match(
    /^\/training\/trials\/([^/]+)\/(check-in|no-show|assess|convert|lost|cancel)$/,
  );
  if (trialAction && method === "POST")
    return {
      handled: true,
      value: transitionTrial(trialAction[1], trialAction[2], data),
    };
  if (url === "/training/youth-rules/active" && method === "GET")
    return { handled: true, value: activeMockYouthTrainingRule() };
  if (url === "/training/youth-rules" && method === "GET") {
    requireRole("ADMIN", "SUPER_ADMIN");
    return {
      handled: true,
      value: getYouthTrainingRules().filter(
        (rule) => !data.status || rule.status === data.status,
      ),
    };
  }
  if (url === "/training/youth-rules" && method === "POST")
    return { handled: true, value: createYouthRule(data) };
  const ruleDecision = url.match(
    /^\/training\/youth-rules\/([^/]+)\/(publish|reject)$/,
  );
  if (ruleDecision && method === "POST")
    return {
      handled: true,
      value: decideYouthRule(ruleDecision[1], ruleDecision[2] as any, data),
    };
  const productUpdate = url.match(/^\/training\/products\/([^/]+)$/);
  if (productUpdate && method === "PATCH")
    return {
      handled: true,
      value: updateTrainingProduct(productUpdate[1], data),
    };
  return { handled: false };
}
