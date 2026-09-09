import { mockUser } from "../../core";
import { getOrders, saveOrders } from "../../venue";
import {
  getTrainingSessions,
  getTrainingConsumeCorrections,
  saveEnrollments,
  saveTrainingConsumeCorrections,
} from "../../state";
import {
  ok,
  hasMockRole,
  requireMockRole,
  text,
  requireIdempotencyKey,
  newId,
} from "../../policies/common.js";
import {
  assertTrainingSettlementPeriodUnlocked,
  findMockTrainingLedger,
  trainingCorrectionView,
} from "../../policies/training.js";
import type { MockRouteResult, MockRouteOptions } from "../route-contract.js";

export async function handleTrainingConsumeCorrectionsGet(
  method: string,
  url: string,
  data: any,
  options: MockRouteOptions,
): Promise<MockRouteResult> {
  if (url === "/training/consume-corrections" && method === "GET") {
    requireMockRole("COACH", "FRONT_DESK", "FINANCE", "ADMIN", "SUPER_ADMIN");
    const coachOnly =
      hasMockRole("COACH") &&
      !hasMockRole("FRONT_DESK", "FINANCE", "ADMIN", "SUPER_ADMIN");
    const corrections = getTrainingConsumeCorrections()
      .filter((correction) => {
        if (!coachOnly) return true;
        const ledger = findMockTrainingLedger(correction.recognitionId);
        const lesson = ledger
          ? getTrainingSessions().find(
              (item) => item.id === ledger.attendance.sessionId,
            )
          : null;
        return lesson?.classId === "class-adult";
      })
      .sort((a, b) =>
        String(b.requestedAt).localeCompare(String(a.requestedAt)),
      )
      .map(trainingCorrectionView);
    return { handled: true, value: ok(corrections) };
  }
  return { handled: false };
}

export async function handleTrainingConsumeCorrectionsPost(
  method: string,
  url: string,
  data: any,
  options: MockRouteOptions,
): Promise<MockRouteResult> {
  if (url === "/training/consume-corrections" && method === "POST") {
    requireMockRole("COACH", "FRONT_DESK", "ADMIN", "SUPER_ADMIN");
    const recognitionId = text(data.recognitionId);
    const reason = text(data.reason);
    const requestIdempotencyKey = requireIdempotencyKey(
      data.idempotencyKey,
      "冲正申请幂等键",
    );
    if (reason.length < 2 || reason.length > 300)
      throw new Error("冲正申请原因长度必须为2-300个字符");
    const corrections = getTrainingConsumeCorrections();
    const replay = corrections.find(
      (item) => item.requestIdempotencyKey === requestIdempotencyKey,
    );
    if (replay) {
      if (
        replay.requestedById !== mockUser().id ||
        replay.recognitionId !== recognitionId ||
        replay.reason !== reason
      )
        throw new Error("冲正申请幂等键已用于其他指令");
      return { handled: true, value: ok(trainingCorrectionView(replay)) };
    }
    const ledger = findMockTrainingLedger(recognitionId);
    if (!ledger || ledger.recognition.type !== "CONSUME")
      throw new Error("可冲正的消课确认流水不存在");
    if (ledger.recognition.reversedBy) throw new Error("该消课流水已冲正");
    if (
      hasMockRole("COACH") &&
      !hasMockRole("FRONT_DESK", "ADMIN", "SUPER_ADMIN")
    ) {
      const lesson = getTrainingSessions().find(
        (item) => item.id === ledger.attendance.sessionId,
      );
      if (lesson?.classId !== "class-adult")
        throw new Error("教练只能申请自己负责班级的消课冲正");
    }
    if (
      corrections.some(
        (item) =>
          item.recognitionId === recognitionId &&
          ["REQUESTED", "APPROVED"].includes(item.status),
      )
    )
      throw new Error("该消课流水已有待处理或已批准的冲正申请");
    const now = new Date().toISOString();
    const correction = {
      id: newId("consume-correction"),
      recognitionId,
      attendanceId: ledger.attendance.id,
      status: "REQUESTED",
      reason,
      reviewReason: null,
      requestedById: mockUser().id,
      reviewedById: null,
      reversalRecognitionId: null,
      requestIdempotencyKey,
      decisionIdempotencyKey: null,
      decisionAction: null,
      requestedAt: now,
      reviewedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    saveTrainingConsumeCorrections([correction, ...corrections]);
    return { handled: true, value: ok(trainingCorrectionView(correction)) };
  }
  return { handled: false };
}

export async function handleTrainingCorrectionDecisionPost(
  method: string,
  url: string,
  data: any,
  options: MockRouteOptions,
): Promise<MockRouteResult> {
  const trainingCorrectionDecisionMatch = url.match(
    /^\/training\/consume-corrections\/([^/]+)\/(approve|reject)$/,
  );
  if (trainingCorrectionDecisionMatch && method === "POST") {
    requireMockRole("ADMIN", "SUPER_ADMIN");
    const [, correctionId, action] = trainingCorrectionDecisionMatch;
    const reason = text(data.reason);
    const decisionIdempotencyKey = requireIdempotencyKey(
      data.idempotencyKey,
      "冲正决策幂等键",
    );
    if (reason && (reason.length < 2 || reason.length > 300))
      throw new Error("冲正复核原因长度必须为2-300个字符");
    if (action === "reject" && !reason)
      throw new Error("驳回冲正申请必须填写原因");
    const corrections = getTrainingConsumeCorrections();
    const keyReplay = corrections.find(
      (item) => item.decisionIdempotencyKey === decisionIdempotencyKey,
    );
    if (keyReplay) {
      if (keyReplay.id === correctionId && keyReplay.decisionAction === action)
        return { handled: true, value: ok(trainingCorrectionView(keyReplay)) };
      throw new Error("冲正决策幂等键已用于其他申请或动作");
    }
    const correction = corrections.find((item) => item.id === correctionId);
    if (!correction) throw new Error("消课冲正申请不存在");
    if (correction.status !== "REQUESTED")
      throw new Error(
        action === "approve"
          ? "只有待复核申请可以批准"
          : "只有待复核申请可以驳回",
      );
    if (correction.requestedById === mockUser().id)
      throw new Error("消课冲正申请人与复核人不能为同一账号");
    const now = new Date().toISOString();
    if (action === "reject") {
      Object.assign(correction, {
        status: "REJECTED",
        reviewReason: reason,
        reviewedById: mockUser().id,
        reviewedAt: now,
        decisionIdempotencyKey,
        decisionAction: action,
        updatedAt: now,
      });
      saveTrainingConsumeCorrections(corrections);
      return { handled: true, value: ok(trainingCorrectionView(correction)) };
    }

    const ledger = findMockTrainingLedger(correction.recognitionId);
    if (
      !ledger ||
      ledger.recognition.type !== "CONSUME" ||
      ledger.recognition.reversedBy
    )
      throw new Error("目标消课流水已冲正或不可冲正");
    if (ledger.recognition.settlementId)
      throw new Error("该消课流水已进入培训结算，不能冲正");
    const recognitionSession = getTrainingSessions().find(
      (item) => item.id === ledger.attendance.sessionId,
    );
    if (!recognitionSession) throw new Error("消课对应课次不存在");
    assertTrainingSettlementPeriodUnlocked(
      new Date(recognitionSession.startsAt),
      new Date(recognitionSession.endsAt),
      "批准消课冲正",
    );
    const recognized = Number(ledger.recognition.effectiveRevenueCents || 0);
    if (
      Number(ledger.attendance.consumedSessions || 0) !== 1 ||
      Number(ledger.attendance.confirmedRevenueCents || 0) !== recognized ||
      Number(ledger.enrollment.consumedSessions || 0) < 1 ||
      Number(ledger.enrollment.confirmedRevenueCents || 0) < recognized
    )
      throw new Error("当前消课余额与待冲正流水不一致");
    const sequence =
      Math.max(
        0,
        ...(ledger.attendance.revenueRecognitions || []).map((item: any) =>
          Number(item.sequence || 0),
        ),
      ) + 1;
    const reversal = {
      id: newId("recognition-reversal"),
      attendanceId: ledger.attendance.id,
      enrollmentId: ledger.enrollment.id,
      type: "REVERSAL",
      sequence,
      reversalOfId: ledger.recognition.id,
      reversedBy: null,
      effectiveRevenueCents: -recognized,
      recognizedRevenueCents: -recognized,
      contractRateBps: Number(ledger.recognition.contractRateBps || 2_000),
      venueContributionCents: -Number(
        ledger.recognition.venueContributionCents || 0,
      ),
      venueFeeCents: 0,
      trainingPayableVenueCents: 0,
      idempotencyKey: `TRAINING_REVERSAL:${decisionIdempotencyKey}`,
      createdAt: now,
    };
    const growthPointsReversed = Number(
      ledger.attendance.growthPointsAwarded || 0,
    );
    ledger.recognition.reversedBy = { ...reversal };
    ledger.attendance.revenueRecognitions = [
      ...(ledger.attendance.revenueRecognitions || []),
      reversal,
    ];
    ledger.enrollment.usedSessions = Math.max(
      0,
      Number(
        ledger.enrollment.usedSessions || ledger.enrollment.consumedSessions,
      ) - 1,
    );
    ledger.enrollment.consumedSessions = ledger.enrollment.usedSessions;
    ledger.enrollment.confirmedRevenueCents = Math.max(
      0,
      Number(ledger.enrollment.confirmedRevenueCents || 0) - recognized,
    );
    ledger.enrollment.prepaidBalanceCents =
      Number(ledger.enrollment.prepaidBalanceCents || 0) + recognized;
    if (ledger.enrollment.status === "COMPLETED")
      ledger.enrollment.status =
        Number(ledger.enrollment.refundedCents || 0) > 0
          ? "PARTIALLY_REFUNDED"
          : "ACTIVE";
    const orders = getOrders();
    const order = orders.find((item) => item.id === ledger.enrollment.orderId);
    if (order?.completedAt) {
      order.completedAt = null;
      order.fulfillmentOutcome = null;
      if (order.status === "COMPLETED") order.status = "PAID";
      saveOrders(orders);
    }
    ledger.enrollment.growthPointsBalance = Math.max(
      0,
      Number(ledger.enrollment.growthPointsBalance || 0) - growthPointsReversed,
    );
    Object.assign(ledger.attendance, {
      status: "ATTENDED",
      consumedSessions: 0,
      confirmedRevenueCents: 0,
      growthPointsAwarded: 0,
      operatorId: null,
      consumedAt: null,
    });
    Object.assign(correction, {
      status: "APPROVED",
      reviewReason: reason || "复核同意消课冲正",
      reviewedById: mockUser().id,
      reviewedAt: now,
      reversalRecognitionId: reversal.id,
      decisionIdempotencyKey,
      decisionAction: action,
      growthPointsReversed,
      updatedAt: now,
    });
    saveEnrollments(ledger.enrollments);
    saveTrainingConsumeCorrections(corrections);
    return { handled: true, value: ok(trainingCorrectionView(correction)) };
  }
  return { handled: false };
}
