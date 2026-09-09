import { mockUser } from "../core";
import { getOrders, saveOrders } from "../venue";
import {
  getEnrollments,
  getReconciliationPeriods,
  getTrainingSessions,
  getTrainingProducts,
  getTrainingCreationCommands,
  getAuditLogs,
  saveTrainingCreationCommands,
  saveAuditLogs,
} from "../state";
import {
  ok,
  text,
  integer,
  requireIdempotencyKey,
  newId,
  creationCommandHash,
} from "./common.js";
import { mockActorIdentity } from "./members.js";

export const mockTrainingSessionCommandResponse = (session: any) => ({
  id: session?.id,
  status: session?.status,
});

export const mockTrainingAttendanceCommandResponse = (attendance: any) => ({
  id: attendance?.id,
  sessionId: attendance?.sessionId,
  enrollmentId: attendance?.enrollmentId,
  status: attendance?.status,
});

export const mockTrainingConsumeProposalResponse = (attendance: any) => ({
  ...mockTrainingAttendanceCommandResponse(attendance),
  workflowStatus: "PENDING_CONFIRMATION",
});

export const mockTrainingMakeupCommandResponse = (
  attendance: any,
  makeupSessionId: unknown,
) => ({
  ...mockTrainingAttendanceCommandResponse(attendance),
  workflowStatus: "MAKEUP_SCHEDULED",
  makeupSessionId:
    typeof makeupSessionId === "string" ? makeupSessionId.trim() : "",
});

export const mockTrainingConsumeConfirmationResponse = (recognition: any) => ({
  id: recognition?.id,
  type: recognition?.type,
  sequence: recognition?.sequence,
  workflowStatus: "CONFIRMED",
  effectiveRevenueCents: recognition?.effectiveRevenueCents,
  venueContributionCents: recognition?.venueContributionCents,
  venueFeeCents: recognition?.venueFeeCents,
});

export const assertTrainingSettlementPeriodUnlocked = (
  periodStart: Date,
  periodEnd: Date,
  operation = "新增或变更培训结算",
) => {
  const shifted = new Date(periodStart.getTime() + 8 * 60 * 60 * 1_000);
  const firstBusinessDay = new Date(
    Date.UTC(
      shifted.getUTCFullYear(),
      shifted.getUTCMonth(),
      shifted.getUTCDate(),
    ) -
      8 * 60 * 60 * 1_000,
  );
  const locked = Object.values(getReconciliationPeriods()).find(
    (period: any) => {
      if (period?.status !== "LOCKED") return false;
      const businessDate = new Date(String(period.businessDate || ""));
      return (
        Number.isFinite(businessDate.getTime()) &&
        businessDate.getTime() >= firstBusinessDay.getTime() &&
        businessDate.getTime() < periodEnd.getTime()
      );
    },
  );
  if (locked) throw new Error(`账期包含已锁定营业日，不能${operation}`);
};

export const requireTrainingCreationReason = (value: unknown) => {
  const reason = text(value);
  if (reason.length < 2 || reason.length > 300)
    throw new Error("创建原因长度必须为2-300个字符");
  return reason;
};

export type MockTrainingCreationAttempt = {
  replayed: boolean;
  key: string;
  actorId: string;
  action: string;
  objectType: string;
  commandHash: string;
  response?: any;
};

export const beginMockTrainingCreation = (
  creationIdempotencyKey: unknown,
  action: string,
  objectType: string,
  command: unknown,
): MockTrainingCreationAttempt => {
  const key = requireIdempotencyKey(creationIdempotencyKey, "培训创建幂等键");
  const actorId = mockUser().id;
  const commandHash = creationCommandHash(command);
  const existing = getTrainingCreationCommands().find(
    (item) => item.key === key,
  );
  if (existing) {
    if (
      existing.actorId !== actorId ||
      existing.action !== action ||
      existing.objectType !== objectType ||
      existing.commandHash !== commandHash
    ) {
      throw new Error("培训操作幂等键已用于不同命令");
    }
    return {
      replayed: true,
      key,
      actorId,
      action,
      objectType,
      commandHash,
      response: existing.response,
    };
  }
  return {
    replayed: false,
    key,
    actorId,
    action,
    objectType,
    commandHash,
  };
};

export const finishMockTrainingCreation = (
  attempt: MockTrainingCreationAttempt,
  response: any,
  reason: string,
): any => {
  if (attempt.replayed) return ok(attempt.response);
  const snapshot = ok(response);
  saveTrainingCreationCommands([
    {
      key: attempt.key,
      actorId: attempt.actorId,
      action: attempt.action,
      objectType: attempt.objectType,
      objectId: response.id,
      commandHash: attempt.commandHash,
      response: snapshot,
      createdAt: new Date().toISOString(),
    },
    ...getTrainingCreationCommands(),
  ]);
  saveAuditLogs([
    {
      id: newId("audit"),
      actorId: attempt.actorId,
      actorRole: mockUser().primaryRole,
      action: attempt.action,
      objectType: attempt.objectType,
      objectId: response.id,
      oldValue: { exists: false },
      newValue: { ...snapshot, commandHash: attempt.commandHash },
      reason,
      requestId: attempt.key,
      createdAt: new Date().toISOString(),
    },
    ...getAuditLogs(),
  ]);
  return snapshot;
};

export const findMockTrainingLedger = (recognitionId: string) => {
  const enrollments = getEnrollments();
  for (const enrollment of enrollments) {
    for (const attendance of enrollment.attendances || []) {
      const recognition = (attendance.revenueRecognitions || []).find(
        (item: any) => item.id === recognitionId,
      );
      if (recognition)
        return { enrollments, enrollment, attendance, recognition };
    }
  }
  return null;
};

export const activeMockConsumeRecognition = (attendance: any) =>
  [...(attendance?.revenueRecognitions || [])]
    .filter(
      (recognition: any) =>
        recognition.type === "CONSUME" && !recognition.reversedBy,
    )
    .sort((a: any, b: any) => Number(b.sequence) - Number(a.sequence))[0] ||
  null;

export const trainingCorrectionView = (correction: any) => {
  const ledger = findMockTrainingLedger(correction.recognitionId);
  const reversal = correction.reversalRecognitionId
    ? findMockTrainingLedger(correction.reversalRecognitionId)?.recognition ||
      null
    : null;
  const lesson = ledger
    ? getTrainingSessions().find(
        (item) => item.id === ledger.attendance.sessionId,
      )
    : null;
  const trainingClass = lesson
    ? getTrainingProducts()
        .flatMap((product) => product.classes || [])
        .find((item: any) => item.id === lesson.classId)
    : null;
  const recognitionView = (recognition: any) =>
    recognition
      ? {
          id: recognition.id,
          type: recognition.type,
          sequence: recognition.sequence,
          effectiveRevenueCents: recognition.effectiveRevenueCents,
          createdAt: recognition.createdAt,
        }
      : null;
  return {
    id: correction.id,
    status: correction.status,
    reason: correction.reason,
    reviewReason: correction.reviewReason || null,
    requestedAt: correction.requestedAt,
    reviewedAt: correction.reviewedAt || null,
    recognitionId: correction.recognitionId,
    recognition: recognitionView(ledger?.recognition),
    reversalRecognition: recognitionView(reversal),
    attendance: ledger
      ? {
          id: ledger.attendance.id,
          status: ledger.attendance.status,
          consumedSessions: ledger.attendance.consumedSessions || 0,
          confirmedRevenueCents: ledger.attendance.confirmedRevenueCents || 0,
          growthPointsAwarded: ledger.attendance.growthPointsAwarded || 0,
          feedback: ledger.attendance.feedback || null,
          session: lesson
            ? {
                id: lesson.id,
                startsAt: lesson.startsAt,
                endsAt: lesson.endsAt,
                status: lesson.status,
                class: trainingClass
                  ? { id: trainingClass.id, name: trainingClass.name }
                  : null,
              }
            : null,
          enrollment: {
            id: ledger.enrollment.id,
            status: ledger.enrollment.status,
            student: ledger.enrollment.student
              ? {
                  id: ledger.enrollment.student.id,
                  displayName: ledger.enrollment.student.displayName,
                }
              : null,
            buyer: ledger.enrollment.buyer
              ? {
                  id: ledger.enrollment.buyer.id || ledger.enrollment.buyerId,
                  displayName: ledger.enrollment.buyer.displayName,
                }
              : mockActorIdentity(ledger.enrollment.buyerId),
          },
        }
      : null,
    requestedBy: mockActorIdentity(correction.requestedById),
    reviewedBy: correction.reviewedById
      ? mockActorIdentity(correction.reviewedById)
      : null,
  };
};

export const postMockTrainingConsume = (
  enrollment: any,
  attendance: any,
  requestedIdempotencyKey?: string,
) => {
  const enrollmentOrder = getOrders().find(
    (order) => order.id === enrollment.orderId,
  );
  if (enrollmentOrder?.status === "REFUND_PENDING")
    throw new Error("订单正在等待退款审批，请先处理退款后再消课");
  const requestedKey = text(requestedIdempotencyKey);
  if (requestedKey) {
    const existing = getEnrollments()
      .flatMap((item) => item.attendances || [])
      .flatMap((item: any) => item.revenueRecognitions || [])
      .find((item: any) => item.idempotencyKey === requestedKey);
    if (existing) {
      if (
        existing.attendanceId === attendance.id &&
        existing.type === "CONSUME" &&
        !existing.reversedBy
      )
        return existing;
      throw new Error("消课幂等键已用于其他流水");
    }
  }
  const recognized = Math.min(
    trainingUnitRevenue(enrollment),
    Number(enrollment.prepaidBalanceCents || 0),
  );
  const venueContribution = Math.round(recognized * 0.2);
  const sequence =
    Math.max(
      0,
      ...(attendance.revenueRecognitions || []).map((item: any) =>
        Number(item.sequence || 0),
      ),
    ) + 1;
  const recognition = {
    id: newId("recognition"),
    attendanceId: attendance.id,
    enrollmentId: enrollment.id,
    type: "CONSUME",
    sequence,
    reversalOfId: null,
    reversedBy: null,
    effectiveRevenueCents: recognized,
    recognizedRevenueCents: recognized,
    contractRateBps: 2_000,
    venueContributionCents: venueContribution,
    venueFeeCents: 0,
    trainingPayableVenueCents: 0,
    idempotencyKey: requestedKey || `CONSUME:${attendance.id}:${sequence}`,
    createdAt: new Date().toISOString(),
  };
  enrollment.usedSessions =
    Number(enrollment.usedSessions || enrollment.consumedSessions || 0) + 1;
  enrollment.consumedSessions = enrollment.usedSessions;
  enrollment.confirmedRevenueCents =
    Number(enrollment.confirmedRevenueCents || 0) + recognized;
  enrollment.prepaidBalanceCents = Math.max(
    0,
    Number(enrollment.prepaidBalanceCents || 0) - recognized,
  );
  if (enrollment.product?.audience === "YOUTH") {
    enrollment.growthPointsBalance =
      Number(enrollment.growthPointsBalance || 0) + 1;
  }
  if (
    enrollment.usedSessions >= Number(enrollment.totalSessions || 0) ||
    enrollment.prepaidBalanceCents <= 0
  ) {
    enrollment.status = "COMPLETED";
    const orders = getOrders();
    const order = orders.find((item) => item.id === enrollment.orderId);
    if (order) {
      order.completedAt = order.completedAt || new Date().toISOString();
      order.fulfillmentOutcome = "FULLY_CONSUMED";
      if (!["REFUND_PENDING", "PARTIALLY_REFUNDED"].includes(order.status))
        order.status = "COMPLETED";
      saveOrders(orders);
    }
  }
  Object.assign(attendance, {
    status: "ATTENDED",
    consumedSessions: 1,
    consumedAt: new Date().toISOString(),
    confirmedRevenueCents: recognized,
    growthPointsAwarded: enrollment.product?.audience === "YOUTH" ? 1 : 0,
    operatorId: mockUser().id,
    revenueRecognitions: [
      ...(attendance.revenueRecognitions || []),
      recognition,
    ],
  });
  return recognition;
};

export const trainingSettlementView = (settlement: any) => {
  return {
    id: settlement.id,
    periodStart: settlement.periodStart,
    periodEnd: settlement.periodEnd,
    effectiveRevenueCents: settlement.effectiveRevenueCents,
    contractRateBps: settlement.contractRateBps,
    venueContributionCents: settlement.venueContributionCents,
    venueFeeCents: settlement.venueFeeCents,
    trainingPayableVenueCents: settlement.trainingPayableVenueCents,
    coachCostCents: settlement.coachCostCents,
    assistantCostCents: settlement.assistantCostCents,
    materialCostCents: settlement.materialCostCents,
    acquisitionCostCents: settlement.acquisitionCostCents,
    marketingCostCents: settlement.marketingCostCents,
    occupiedCourtHours: settlement.occupiedCourtHours,
    cashContributionMarginCents: settlement.cashContributionMarginCents,
    status: settlement.status,
    confirmedAt: settlement.confirmedAt || null,
    createdAt: settlement.createdAt,
    updatedAt: settlement.updatedAt,
    isOwnCreator: settlement.createdById === mockUser().id,
    createdBy: settlement.createdBy?.displayName
      ? { displayName: settlement.createdBy.displayName }
      : null,
    workflowHistory: (settlement.workflowHistory || []).map((entry: any) => ({
      action: entry.action,
      actor: entry.actor || entry.actorName || null,
      reason: entry.reason || null,
      at: entry.at || entry.createdAt,
      from: entry.from ?? entry.oldValue?.status ?? null,
      to: entry.to ?? entry.newValue?.status ?? null,
    })),
  };
};

export const trainingUnitRevenue = (enrollment: any) => {
  const product = enrollment?.product || {};
  const explicit = integer(product.unitRevenueCents)
    ? Number(product.unitRevenueCents)
    : NaN;
  if (Number.isFinite(explicit) && explicit > 0) return explicit;
  const total = Number(product.priceCents || enrollment?.totalAmountCents || 0);
  const sessions = Number(
    product.totalSessions || enrollment?.totalSessions || 1,
  );
  return Math.max(0, Math.round(total / Math.max(1, sessions)));
};
