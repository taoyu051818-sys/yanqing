import {
  getCustomerLeads,
  getEnrollments,
  getGovernanceUsers,
  getStudents,
  getSystemParameters,
  getTrainingProducts,
  getTrainingSessions,
} from "../state";
import { hasRole, audit, classContext } from "./command-policy.js";

export const activeTrialStatuses = ["RESERVED", "CHECKED_IN", "ASSESSED"];

export const assertTrialOperationWindow = (
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
    kind === "ATTENDANCE" ? trial.scheduledStartsAt : trial.scheduledEndsAt,
  );
  const scheduledEndsAt = new Date(
    kind === "ATTENDANCE" ? trial.scheduledEndsAt : trial.scheduledEndsAt,
  );
  const earliestAt = new Date(
    scheduledStartsAt.getTime() - earlyMinutes * 60_000,
  );
  const latestAt = new Date(scheduledEndsAt.getTime() + lateMinutes * 60_000);
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

export const person = (id: string | null) => {
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

export const trialView = (trial: any, management = true) => {
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
  const productView = (item: any) =>
    item
      ? {
          id: item.id,
          name: item.name,
          audience: item.audience,
          totalSessions: item.totalSessions,
          validityDays: item.validityDays,
          priceCents: item.priceCents,
        }
      : null;
  return {
    id: trial.id,
    trialNo: trial.trialNo,
    status: trial.status,
    sourceChannel: trial.sourceChannel,
    scheduledStartsAt: trial.scheduledStartsAt,
    scheduledEndsAt: trial.scheduledEndsAt,
    checkedInAt: trial.checkedInAt || null,
    noShowAt: trial.noShowAt || null,
    assessedAt: trial.assessedAt || null,
    convertedAt: trial.convertedAt || null,
    lostAt: trial.lostAt || null,
    cancelledAt: trial.cancelledAt || null,
    assessmentDimensions: trial.assessmentDimensions || null,
    recommendation: trial.recommendation || null,
    assessmentNote: trial.assessmentNote || null,
    student: student
      ? {
          id: student.id,
          displayName: student.displayName,
        }
      : null,
    guardian: person(trial.guardianId),
    member: person(trial.memberId),
    product: productView(product),
    class: trainingClass
      ? {
          id: trainingClass.id,
          name: trainingClass.name,
          capacity: trainingClass.capacity,
          active: trainingClass.active !== false,
          product: productView(trainingClass.product),
        }
      : null,
    session: session
      ? {
          id: session.id,
          classId: session.classId,
          startsAt: session.startsAt,
          endsAt: session.endsAt,
          status: session.status,
        }
      : null,
    coach: person(trial.coachId),
    ...(management
      ? {
          leadId: trial.leadId || null,
          studentId: trial.studentId || null,
          guardianId: trial.guardianId || null,
          memberId: trial.memberId || null,
          productId: trial.productId,
          classId: trial.classId || null,
          sessionId: trial.sessionId || null,
          coachId: trial.coachId,
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
          convertedEnrollment: enrollment
            ? {
                id: enrollment.id,
                enrollmentNo: enrollment.enrollmentNo,
                status: enrollment.status,
                product: productView(enrollment.product),
                student: enrollment.student
                  ? {
                      id: enrollment.student.id,
                      displayName: enrollment.student.displayName,
                    }
                  : null,
              }
            : null,
          transitions: (trial.transitions || []).map((transition: any) => ({
            id: transition.id,
            fromStatus: transition.fromStatus,
            toStatus: transition.toStatus,
            action: transition.action,
            reason: transition.reason,
            actor: person(transition.actorId),
            createdAt: transition.createdAt,
          })),
        }
      : {}),
  };
};
