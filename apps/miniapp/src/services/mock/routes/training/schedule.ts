import { mockUser } from "../../core";
import { availability } from "../../venue";
import { mockTrainingSessionView } from "../../training-operations";
import {
  getEnrollments,
  getTrainingSessions,
  getTrainingProducts,
  getVenueBookings,
  getVenueClosures,
  saveEnrollments,
  saveTrainingSessions,
  saveVenueBookings,
} from "../../state";
import {
  ok,
  mockRoles,
  hasMockRole,
  requireMockRole,
  text,
  newId,
} from "../../policies/common.js";
import {
  mockTrainingSessionCommandResponse,
  requireTrainingCreationReason,
  beginMockTrainingCreation,
  finishMockTrainingCreation,
} from "../../policies/training.js";
import { assertMockOperationWindow } from "../../policies/operation-window.js";
import { mockShanghaiBusinessDate } from "../../policies/front-desk.js";
import type { MockRouteResult, MockRouteOptions } from "../route-contract.js";

export async function handleTrainingSessionsGet(
  method: string,
  url: string,
  data: any,
  options: MockRouteOptions,
): Promise<MockRouteResult> {
  if (url === "/training/sessions" && method === "GET") {
    requireMockRole("COACH", "FRONT_DESK", "FINANCE", "ADMIN", "SUPER_ADMIN");
    const roles = mockRoles();
    const ownClassOnly =
      roles.includes("COACH") &&
      !hasMockRole("FRONT_DESK", "FINANCE", "ADMIN", "SUPER_ADMIN");
    const ownedClassIds = ownClassOnly
      ? getTrainingProducts()
          .flatMap((product) => product.classes || [])
          .filter(
            (trainingClass: any) =>
              trainingClass.active !== false &&
              (trainingClass.coachId === mockUser().id ||
                trainingClass.assistantId === mockUser().id),
          )
          .map((trainingClass: any) => trainingClass.id)
      : [];
    return {
      handled: true,
      value: ok(
        ownClassOnly
          ? getTrainingSessions()
              .filter((trainingSession) =>
                ownedClassIds.includes(trainingSession.classId),
              )
              .map(mockTrainingSessionView)
          : getTrainingSessions().map(mockTrainingSessionView),
      ),
    };
  }
  return { handled: false };
}

export async function handleTrainingSessionsPost(
  method: string,
  url: string,
  data: any,
  options: MockRouteOptions,
): Promise<MockRouteResult> {
  if (url === "/training/sessions" && method === "POST") {
    requireMockRole("COACH", "ADMIN", "SUPER_ADMIN");
    const classId = text(data.classId);
    const startsAt = new Date(String(data.startsAt || ""));
    const endsAt = new Date(String(data.endsAt || ""));
    const note = text(data.note) || undefined;
    const courtIds = Array.isArray(data.courtIds)
      ? data.courtIds.map((id: unknown) => text(id)).filter(Boolean)
      : [];
    if (
      !classId ||
      Number.isNaN(startsAt.getTime()) ||
      Number.isNaN(endsAt.getTime()) ||
      endsAt <= startsAt
    )
      throw new Error("课次时间设置无效");
    if (new Set(courtIds).size !== courtIds.length || !courtIds.length)
      throw new Error("培训课次至少需要一个不重复场地");
    if (startsAt <= new Date())
      throw new Error("培训课次开始时间必须晚于当前时间");
    const sortedCourtIds = [...courtIds].sort();
    const reason = requireTrainingCreationReason(data.reason);
    const command = {
      classId,
      startsAt: startsAt.toISOString(),
      endsAt: endsAt.toISOString(),
      courtIds: sortedCourtIds,
      note: note || null,
      reason,
    };
    const attempt = beginMockTrainingCreation(
      data.creationIdempotencyKey,
      "TRAINING_SESSION_CREATED",
      "TrainingSession",
      command,
    );
    if (attempt.replayed)
      return {
        handled: true,
        value: ok(mockTrainingSessionCommandResponse(attempt.response)),
      };
    const trainingClass = getTrainingProducts()
      .flatMap((product) => product.classes || [])
      .find((item: any) => item.id === classId && item.active !== false);
    if (!trainingClass) throw new Error("培训班不存在");
    const actorIsCoach =
      hasMockRole("COACH") && !hasMockRole("ADMIN", "SUPER_ADMIN");
    if (
      actorIsCoach &&
      trainingClass.coachId !== mockUser().id &&
      trainingClass.assistantId !== mockUser().id
    )
      throw new Error("教练只能为自己负责的班级排课");
    const calendar = availability(mockShanghaiBusinessDate(startsAt));
    const selectedCourts = calendar.courts.filter((court: any) =>
      sortedCourtIds.includes(court.id),
    );
    if (
      selectedCourts.length !== sortedCourtIds.length ||
      selectedCourts.some((court: any) => !court.enabled)
    )
      throw new Error("部分场地不存在或已停用");
    const closure = getVenueClosures().find(
      (item: any) =>
        sortedCourtIds.includes(item.courtId) &&
        item.status === "ACTIVE" &&
        new Date(item.startsAt).getTime() < endsAt.getTime() &&
        new Date(item.endsAt).getTime() > startsAt.getTime(),
    );
    if (closure) throw new Error(`所选场地时段已封场：${closure.reason}`);
    const bookingConflict = (calendar.bookings || []).some(
      (existing: any) =>
        existing.status !== "CANCELLED" &&
        sortedCourtIds.includes(existing.courtId) &&
        new Date(existing.startsAt).getTime() < endsAt.getTime() &&
        new Date(existing.endsAt).getTime() > startsAt.getTime(),
    );
    const sessionConflict = getTrainingSessions().some(
      (existing: any) =>
        existing.status !== "CANCELLED" &&
        new Date(existing.startsAt).getTime() < endsAt.getTime() &&
        new Date(existing.endsAt).getTime() > startsAt.getTime() &&
        (existing.courtIds || []).some((courtId: string) =>
          sortedCourtIds.includes(courtId),
        ),
    );
    if (bookingConflict || sessionConflict)
      throw new Error("所选场地与已有预订冲突");
    const enrollmentList = getEnrollments().filter(
      (enrollment) =>
        enrollment.classId === classId &&
        ["ACTIVE", "PARTIALLY_REFUNDED"].includes(enrollment.status),
    );
    const sessionId = newId("session");
    const attendanceRows = enrollmentList.map((enrollment) => ({
      id: newId("attendance"),
      sessionId,
      enrollmentId: enrollment.id,
      status: "PENDING",
      consumedSessions: 0,
      operatorId: null,
    }));
    const session = {
      id: sessionId,
      classId,
      startsAt: startsAt.toISOString(),
      endsAt: endsAt.toISOString(),
      courtIds: sortedCourtIds,
      courtCount: sortedCourtIds.length,
      occupiedCourtHours:
        sortedCourtIds.length *
        ((endsAt.getTime() - startsAt.getTime()) / 3_600_000),
      coachCostCents: Number(trainingClass.coachCostCents || 0),
      assistantCostCents: Number(trainingClass.assistantCostCents || 0),
      materialCostCents: Number(trainingClass.materialCostCents || 0),
      note,
      class: { id: classId, name: trainingClass.name || classId },
      status: "SCHEDULED",
      attendances: attendanceRows,
    };
    saveTrainingSessions([session, ...getTrainingSessions()]);
    saveVenueBookings([
      ...sortedCourtIds.map((courtId) => ({
        id: newId("training-booking"),
        courtId,
        status: "CONFIRMED",
        startsAt: startsAt.toISOString(),
        endsAt: endsAt.toISOString(),
        usage: "TRAINING",
        trainingClassId: classId,
        note: `培训课次 ${session.id}，仅记录资源占用，不生成培训场地费`,
      })),
      ...getVenueBookings(),
    ]);
    // Keep the enrollment attendance ledger in sync with the new session.
    const allEnrollments = getEnrollments();
    enrollmentList.forEach((enrollment) => {
      const row = attendanceRows.find(
        (attendance: any) => attendance.enrollmentId === enrollment.id,
      );
      enrollment.attendances = [...(enrollment.attendances || []), row];
    });
    saveEnrollments(allEnrollments);
    return {
      handled: true,
      value: finishMockTrainingCreation(
        attempt,
        mockTrainingSessionCommandResponse(session),
        reason,
      ),
    };
  }
  return { handled: false };
}

export async function handleCompleteSessionPost(
  method: string,
  url: string,
  data: any,
  options: MockRouteOptions,
): Promise<MockRouteResult> {
  const completeSessionMatch = url.match(
    /^\/training\/sessions\/([^/]+)\/complete$/,
  );
  if (completeSessionMatch && method === "POST") {
    requireMockRole("COACH", "ADMIN", "SUPER_ADMIN");
    const list = getTrainingSessions();
    const trainingSession = list.find(
      (item) => item.id === completeSessionMatch[1],
    );
    if (!trainingSession) throw new Error("培训课次不存在");
    if (trainingSession.status === "COMPLETED")
      return {
        handled: true,
        value: ok(mockTrainingSessionCommandResponse(trainingSession)),
      };
    if (trainingSession.status === "CANCELLED")
      throw new Error("已取消课次不能结课");
    if (
      hasMockRole("COACH") &&
      !hasMockRole("ADMIN", "SUPER_ADMIN") &&
      trainingSession.classId !== "class-adult"
    )
      throw new Error("教练只能结束自己负责班级的课次");
    const pending = getEnrollments().some((enrollment) =>
      (enrollment.attendances || []).some(
        (attendance: any) =>
          attendance.sessionId === completeSessionMatch[1] &&
          (["PENDING", "MAKEUP_REQUIRED", "LEAVE"].includes(
            attendance.status,
          ) ||
            (attendance.status === "ATTENDED" &&
              Number(attendance.consumedSessions || 0) === 0)),
      ),
    );
    if (pending) throw new Error("仍有学员未完成点名或消课");
    const timeWindowPolicy = assertMockOperationWindow({
      parameterKey: "training.completion_window.v1",
      defaults: { earlyMinutes: 0, lateMinutes: 240 },
      startsAt: trainingSession.endsAt,
      endsAt: trainingSession.endsAt,
      action: "TRAINING_SESSION_COMPLETED",
      objectType: "TrainingSession",
      objectId: trainingSession.id,
      overrideReason: data.reason,
    });
    trainingSession.status = "COMPLETED";
    trainingSession.completionTimeWindowPolicy = timeWindowPolicy;
    saveTrainingSessions(list);
    return {
      handled: true,
      value: ok(mockTrainingSessionCommandResponse(trainingSession)),
    };
  }
  return { handled: false };
}
