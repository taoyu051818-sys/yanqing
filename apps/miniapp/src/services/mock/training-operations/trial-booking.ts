import { mockUser } from "../core";
import {
  getCustomerLeads,
  getStudents,
  getTrainingProducts,
  getTrainingSessions,
  getTrainingTrials,
  saveCustomerLeads,
  saveTrainingTrials,
} from "../state";
import { activeTrialStatuses, person, trialView } from "./trial-policy.js";
import {
  text,
  newId,
  requireRole,
  requireText,
  optionalId,
  commandHash,
  audit,
  classContext,
} from "./command-policy.js";

export const reserveTrial = (data: any) => {
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
  if (memberId && !person(memberId))
    throw new Error("试听会员不存在或账号不可用");
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
