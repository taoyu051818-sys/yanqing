import { mockUser } from "../../core";
import { getOrders } from "../../venue";
import {
  getEnrollments,
  getTrainingSessions,
  saveEnrollments,
} from "../../state";
import {
  ok,
  hasMockRole,
  requireMockRole,
  text,
  isExpired,
} from "../../policies/common.js";
import {
  mockTrainingConsumeProposalResponse,
  mockTrainingConsumeConfirmationResponse,
  assertTrainingSettlementPeriodUnlocked,
  activeMockConsumeRecognition,
  postMockTrainingConsume,
  trainingUnitRevenue,
} from "../../policies/training.js";
import { assertMockOperationWindow } from "../../policies/operation-window.js";
import type { MockRouteResult, MockRouteOptions } from "../route-contract.js";

export async function handleConsumePost(
  method: string,
  url: string,
  data: any,
  options: MockRouteOptions,
): Promise<MockRouteResult> {
  const consumeMatch = url.match(/^\/training\/sessions\/([^/]+)\/consume$/);
  if (consumeMatch && method === "POST") {
    requireMockRole("COACH", "ADMIN", "SUPER_ADMIN");
    const enrollmentList = getEnrollments();
    const lesson = getTrainingSessions().find(
      (item) => item.id === consumeMatch[1],
    );
    const enrollment = enrollmentList.find(
      (item) => item.id === data.enrollmentId,
    ) as any;
    const attendance = enrollment?.attendances?.find(
      (item: any) => item.sessionId === consumeMatch[1],
    ) as any;
    if (!lesson || !enrollment || !attendance)
      throw new Error("课次签到记录不存在");
    attendance.enrollmentId ||= enrollment.id;
    if (
      hasMockRole("COACH") &&
      !hasMockRole("ADMIN", "SUPER_ADMIN") &&
      lesson.classId !== "class-adult"
    )
      throw new Error("只能操作自己负责班级的培训课次");
    if (isExpired(enrollment.expiresAt)) throw new Error("培训报名已过期");
    if (!["ACTIVE", "PARTIALLY_REFUNDED"].includes(enrollment.status))
      throw new Error("报名记录不是在读状态");
    if (attendance.consumedAt || Number(attendance.consumedSessions || 0) > 0) {
      const activeRecognition = activeMockConsumeRecognition(attendance);
      if (
        text(data.idempotencyKey) &&
        activeRecognition?.idempotencyKey !== text(data.idempotencyKey)
      )
        throw new Error("该课次已经消课，禁止重复确认");
      const effectiveRevenueCents = Number(
        attendance.confirmedRevenueCents || trainingUnitRevenue(enrollment),
      );
      return {
        handled: true,
        value: ok(
          mockTrainingConsumeConfirmationResponse({
            ...activeRecognition,
            effectiveRevenueCents,
            venueContributionCents: Math.round(effectiveRevenueCents * 0.2),
            venueFeeCents: 0,
          }),
        ),
      };
    }
    const consumeOrder = getOrders().find(
      (order) => order.id === enrollment.orderId,
    );
    if (consumeOrder?.status === "REFUND_PENDING")
      throw new Error("订单正在等待退款审批，请先处理退款后再消课");
    if (["COMPLETED", "CANCELLED"].includes(lesson.status))
      throw new Error("已结束或已取消的课次不能继续消课");
    if (attendance.status !== "ATTENDED")
      throw new Error("学员完成到场登记后才能提交消课建议");
    if (
      Number(enrollment.consumedSessions || enrollment.usedSessions || 0) >=
        Number(enrollment.totalSessions || 0) ||
      Number(enrollment.prepaidBalanceCents || 0) <= 0
    )
      throw new Error("可用课时或预收余额不足");
    if (hasMockRole("COACH") && !hasMockRole("ADMIN", "SUPER_ADMIN")) {
      if (attendance.operatorId && attendance.operatorId !== mockUser().id)
        throw new Error("该课次已有其他教练提交消课建议");
      // Maker step records who proposed the consumption but leaves attendance
      // and balances untouched until an administrator confirms it.
      Object.assign(attendance, {
        operatorId: mockUser().id,
        feedback: text(data.feedback) || attendance.feedback,
      });
      saveEnrollments(enrollmentList);
      return {
        handled: true,
        value: ok(mockTrainingConsumeProposalResponse(attendance)),
      };
    }
    if (attendance.operatorId === mockUser().id)
      throw new Error("消课建议提交人与确认人不能是同一账号");
    assertTrainingSettlementPeriodUnlocked(
      new Date(lesson.startsAt),
      new Date(lesson.endsAt),
      "确认消课入账",
    );
    assertMockOperationWindow({
      parameterKey: "training.completion_window.v1",
      defaults: { earlyMinutes: 0, lateMinutes: 240 },
      startsAt: lesson.endsAt,
      endsAt: lesson.endsAt,
      action: "TRAINING_SESSION_CONSUMED",
      objectType: "TrainingAttendance",
      objectId: attendance.id,
      overrideReason: data.reason,
    });
    const recognition = postMockTrainingConsume(
      enrollment,
      attendance,
      data.idempotencyKey,
    );
    saveEnrollments(enrollmentList);
    return {
      handled: true,
      value: ok(mockTrainingConsumeConfirmationResponse(recognition)),
    };
  }
  return { handled: false };
}

export async function handleConfirmConsumePost(
  method: string,
  url: string,
  data: any,
  options: MockRouteOptions,
): Promise<MockRouteResult> {
  const confirmConsumeMatch = url.match(
    /^\/training\/sessions\/([^/]+)\/consume\/confirm$/,
  );
  if (confirmConsumeMatch && method === "POST") {
    requireMockRole("ADMIN", "SUPER_ADMIN");
    const enrollmentList = getEnrollments();
    const lesson = getTrainingSessions().find(
      (item) => item.id === confirmConsumeMatch[1],
    );
    const enrollment = enrollmentList.find(
      (item) => item.id === data.enrollmentId,
    ) as any;
    const attendance = enrollment?.attendances?.find(
      (item: any) => item.sessionId === confirmConsumeMatch[1],
    ) as any;
    if (!lesson || !enrollment || !attendance)
      throw new Error("课次签到记录不存在");
    attendance.enrollmentId ||= enrollment.id;
    if (attendance.consumedAt) {
      const activeRecognition = activeMockConsumeRecognition(attendance);
      if (
        text(data.idempotencyKey) &&
        activeRecognition?.idempotencyKey !== text(data.idempotencyKey)
      )
        throw new Error("该课次已经使用其他幂等键消课");
      const recognized = Number(attendance.confirmedRevenueCents || 0);
      return {
        handled: true,
        value: ok(
          mockTrainingConsumeConfirmationResponse({
            ...activeRecognition,
            effectiveRevenueCents: recognized,
            venueContributionCents: Math.round(recognized * 0.2),
            venueFeeCents: 0,
          }),
        ),
      };
    }
    const consumeOrder = getOrders().find(
      (order) => order.id === enrollment.orderId,
    );
    if (consumeOrder?.status === "REFUND_PENDING")
      throw new Error("订单正在等待退款审批，请先处理退款后再消课");
    if (["COMPLETED", "CANCELLED"].includes(lesson.status))
      throw new Error("已结束或已取消的课次不能继续消课");
    if (attendance?.operatorId === mockUser().id)
      throw new Error("消课建议提交人与确认人不能是同一账号");
    if (!attendance?.operatorId)
      throw new Error("必须先由教练提交消课建议，再由培训主管确认入账");
    if (
      isExpired(enrollment.expiresAt) ||
      !["ACTIVE", "PARTIALLY_REFUNDED"].includes(enrollment.status)
    )
      throw new Error("报名记录不是在读状态");
    if (attendance.status !== "ATTENDED")
      throw new Error("当前考勤状态不能确认消课");
    if (
      Number(enrollment.consumedSessions || enrollment.usedSessions || 0) >=
        Number(enrollment.totalSessions || 0) ||
      Number(enrollment.prepaidBalanceCents || 0) <= 0
    )
      throw new Error("可用课时或预收余额不足");
    assertTrainingSettlementPeriodUnlocked(
      new Date(lesson.startsAt),
      new Date(lesson.endsAt),
      "确认消课入账",
    );
    assertMockOperationWindow({
      parameterKey: "training.completion_window.v1",
      defaults: { earlyMinutes: 0, lateMinutes: 240 },
      startsAt: lesson.endsAt,
      endsAt: lesson.endsAt,
      action: "TRAINING_CONSUME_CONFIRMED",
      objectType: "TrainingAttendance",
      objectId: attendance.id,
      overrideReason: data.reason,
    });
    const recognition = postMockTrainingConsume(
      enrollment,
      attendance,
      data.idempotencyKey,
    );
    saveEnrollments(enrollmentList);
    return {
      handled: true,
      value: ok(mockTrainingConsumeConfirmationResponse(recognition)),
    };
  }
  return { handled: false };
}
