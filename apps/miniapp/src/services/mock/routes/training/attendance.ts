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
} from "../../policies/common.js";
import {
  mockTrainingAttendanceCommandResponse,
  mockTrainingMakeupCommandResponse,
} from "../../policies/training.js";
import { assertMockOperationWindow } from "../../policies/operation-window.js";
import type { MockRouteResult, MockRouteOptions } from "../route-contract.js";

export async function handleAttendancePost(
  method: string,
  url: string,
  data: any,
  options: MockRouteOptions,
): Promise<MockRouteResult> {
  const attendanceMatch = url.match(
    /^\/training\/sessions\/([^/]+)\/attendance$/,
  );
  if (attendanceMatch && method === "POST") {
    requireMockRole("COACH", "FRONT_DESK", "ADMIN", "SUPER_ADMIN");
    const lessons = getTrainingSessions();
    const enrollmentList = getEnrollments();
    const lesson = lessons.find((item) => item.id === attendanceMatch[1]);
    const enrollment = enrollmentList.find(
      (item) => item.id === data.enrollmentId,
    ) as any;
    const attendance = enrollment?.attendances?.find(
      (item: any) => item.sessionId === attendanceMatch[1],
    ) as any;
    if (!lesson || !enrollment || !attendance)
      throw new Error("课次签到记录不存在");
    attendance.enrollmentId ||= enrollment.id;
    if (
      hasMockRole("COACH") &&
      !hasMockRole("ADMIN", "SUPER_ADMIN", "FRONT_DESK") &&
      lesson.classId !== "class-adult"
    )
      throw new Error("只能操作自己负责班级的培训出勤");
    const requestedStatus = text(data.status);
    if (!["ATTENDED", "ABSENT", "CANCELLED", "LEAVE"].includes(requestedStatus))
      throw new Error("请使用出勤、缺勤或请假状态登记");
    const persistedStatus =
      requestedStatus === "LEAVE" ? "MAKEUP_REQUIRED" : requestedStatus;
    if (["LEAVE", "CANCELLED"].includes(requestedStatus) && !text(data.reason))
      throw new Error("请假或取消课次必须填写原因");
    if (attendance.consumedAt || Number(attendance.consumedSessions || 0) > 0)
      throw new Error("已消课记录不能修改出勤状态");
    const terminalStatuses = [
      "ATTENDED",
      "ABSENT",
      "CANCELLED",
      "MAKEUP_REQUIRED",
    ];
    if (
      terminalStatuses.includes(attendance.status) &&
      attendance.status !== persistedStatus
    )
      throw new Error("当前出勤状态已锁定，请提交更正申请");
    if (attendance.status === persistedStatus)
      return {
        handled: true,
        value: ok(mockTrainingAttendanceCommandResponse(attendance)),
      };
    const timeWindowPolicy = assertMockOperationWindow({
      parameterKey: "training.attendance_window.v1",
      defaults: { earlyMinutes: 30, lateMinutes: 120 },
      startsAt: lesson.startsAt,
      endsAt: lesson.endsAt,
      action: "TRAINING_ATTENDANCE_MARKED",
      objectType: "TrainingAttendance",
      objectId: attendance.id,
      overrideReason: data.reason,
    });
    Object.assign(attendance, {
      status: persistedStatus,
      feedback: text(data.feedback) || attendance.feedback,
      // Arrival evidence is not the financial consume proposal. The actor is
      // represented by the mock command history; operatorId stays reserved
      // for the explicit maker step below.
      operatorId: attendance.operatorId,
      checkedInAt:
        persistedStatus === "ATTENDED"
          ? attendance.checkedInAt || new Date().toISOString()
          : attendance.checkedInAt,
      reason: text(data.reason) || attendance.reason,
      timeWindowPolicy,
    });
    saveEnrollments(enrollmentList);
    return {
      handled: true,
      value: ok(mockTrainingAttendanceCommandResponse(attendance)),
    };
  }
  return { handled: false };
}

export async function handleMakeupPost(
  method: string,
  url: string,
  data: any,
  options: MockRouteOptions,
): Promise<MockRouteResult> {
  const makeupMatch = url.match(
    /^\/training\/sessions\/([^/]+)\/attendance\/makeup$/,
  );
  if (makeupMatch && method === "POST") {
    requireMockRole("COACH", "ADMIN", "SUPER_ADMIN");
    const enrollmentList = getEnrollments();
    const enrollment = enrollmentList.find(
      (item) => item.id === data.enrollmentId,
    ) as any;
    const original = enrollment?.attendances?.find(
      (item: any) => item.sessionId === makeupMatch[1],
    );
    if (!enrollment || !original) throw new Error("原课次签到记录不存在");
    original.enrollmentId ||= enrollment.id;
    if (!["MAKEUP_REQUIRED", "LEAVE"].includes(original.status)) {
      if (
        original.status === "MADE_UP" &&
        original.makeupSessionId === data.makeupSessionId
      )
        return {
          handled: true,
          value: ok(
            mockTrainingMakeupCommandResponse(original, data.makeupSessionId),
          ),
        };
      throw new Error("只有已批准请假的课次可以安排补课");
    }
    if (text(data.makeupSessionId) === makeupMatch[1])
      throw new Error("补课课次必须晚于原课次");
    const targetSession = getTrainingSessions().find(
      (item) => item.id === data.makeupSessionId,
    );
    if (!targetSession) throw new Error("补课课次不存在");
    if (targetSession.classId !== enrollment.classId)
      throw new Error("补课必须安排在同一培训班");
    const originalSession = getTrainingSessions().find(
      (item) => item.id === makeupMatch[1],
    );
    if (
      originalSession &&
      new Date(targetSession.startsAt) <= new Date(originalSession.startsAt)
    )
      throw new Error("补课课次必须晚于原课次");
    if (["CANCELLED", "COMPLETED"].includes(targetSession.status))
      throw new Error("已取消或已结束的课次不能安排补课");
    const target = enrollment.attendances?.find(
      (item: any) => item.sessionId === targetSession.id,
    );
    if (!target) throw new Error("补课课次没有该学员的签到名额");
    if (target && !["PENDING", "LEAVE"].includes(target.status))
      throw new Error("补课课次的学员名额已被处理");
    Object.assign(original, {
      status: "MADE_UP",
      makeupSessionId: data.makeupSessionId,
      feedback: [original.feedback, `补课安排:${data.makeupSessionId}`]
        .filter(Boolean)
        .join("；"),
    });
    saveEnrollments(enrollmentList);
    return {
      handled: true,
      value: ok(
        mockTrainingMakeupCommandResponse(original, data.makeupSessionId),
      ),
    };
  }
  return { handled: false };
}
