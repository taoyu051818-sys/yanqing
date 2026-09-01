import { beforeEach, describe, expect, it, vi } from "vitest";

import { mockRequest } from "./router";
import {
  getEnrollments,
  getTrainingSessions,
  saveEnrollments,
  saveTrainingSessions,
} from "./state";

const storage = new Map<string, unknown>();

vi.stubGlobal("uni", {
  getStorageSync: (key: string) => storage.get(key) ?? "",
  setStorageSync: (key: string, value: unknown) => storage.set(key, value),
  removeStorageSync: (key: string) => storage.delete(key),
});

const request = <T = any>(
  method: string,
  url: string,
  data: Record<string, unknown> = {},
) => mockRequest<T>(method, url, data);
const login = (role: string) => request("POST", "/auth/dev-login", { role });

const forbiddenFields = [
  "coachCostCents",
  "assistantCostCents",
  "materialCostCents",
  "coachCostAllocatedCents",
  "assistantCostAllocatedCents",
  "materialCostAllocatedCents",
  "operatorId",
  "idempotencyKey",
  "contractRateBps",
  "trainingPayableVenueCents",
  "class",
  "session",
  "enrollment",
  "revenueRecognitions",
  "timeWindowPolicy",
];

const expectMinimal = (value: Record<string, unknown>) => {
  for (const field of forbiddenFields) expect(value).not.toHaveProperty(field);
};

describe("mock training command response privacy", () => {
  beforeEach(async () => {
    storage.clear();
    await login("MEMBER");
  });

  it("returns one minimal session DTO for creation and its idempotent replay", async () => {
    await login("COACH");
    const startsAt = new Date(Date.now() + 4 * 86_400_000);
    startsAt.setUTCHours(5, 0, 0, 0);
    const command = {
      classId: "class-adult",
      startsAt: startsAt.toISOString(),
      endsAt: new Date(startsAt.getTime() + 60 * 60_000).toISOString(),
      courtIds: ["court-17"],
      note: "响应隐私验收课次",
      reason: "验证课次响应最小化",
      creationIdempotencyKey: "training-response-session-1",
    };

    const first = await request<Record<string, unknown>>(
      "POST",
      "/training/sessions",
      command,
    );
    const replay = await request<Record<string, unknown>>(
      "POST",
      "/training/sessions",
      command,
    );

    expect(first).toEqual({ id: expect.any(String), status: "SCHEDULED" });
    expect(replay).toEqual(first);
    expectMinimal(first);
    expect(first).not.toHaveProperty("attendances");
    expect(first).not.toHaveProperty("courtIds");
  });

  it("keeps attendance, proposal, confirmation and completion retries on stable minimal DTOs", async () => {
    const sessions = getTrainingSessions();
    const session = sessions.find((item) => item.id === "session-1")!;
    session.startsAt = new Date(Date.now() - 30 * 60_000).toISOString();
    session.endsAt = new Date(Date.now() + 30 * 60_000).toISOString();
    session.status = "SCHEDULED";
    saveTrainingSessions(sessions);

    const enrollments = getEnrollments();
    const enrollment = enrollments.find((item) => item.id === "enroll-1")!;
    const attendance = enrollment.attendances.find(
      (item: any) => item.sessionId === session.id,
    )!;
    Object.assign(attendance, {
      status: "PENDING",
      consumedSessions: 0,
      confirmedRevenueCents: 0,
      consumedAt: null,
      checkedInAt: null,
      operatorId: null,
      revenueRecognitions: [],
    });
    saveEnrollments(enrollments);

    await login("COACH");
    const attendanceCommand = {
      enrollmentId: enrollment.id,
      status: "ATTENDED",
      feedback: "已核实到场",
    };
    const marked = await request<Record<string, unknown>>(
      "POST",
      `/training/sessions/${session.id}/attendance`,
      attendanceCommand,
    );
    const markedReplay = await request<Record<string, unknown>>(
      "POST",
      `/training/sessions/${session.id}/attendance`,
      attendanceCommand,
    );
    expect(markedReplay).toEqual(marked);
    expectMinimal(marked);

    const proposalCommand = {
      enrollmentId: enrollment.id,
      feedback: "完成本节训练",
    };
    const proposal = await request<Record<string, unknown>>(
      "POST",
      `/training/sessions/${session.id}/consume`,
      proposalCommand,
    );
    const proposalReplay = await request<Record<string, unknown>>(
      "POST",
      `/training/sessions/${session.id}/consume`,
      proposalCommand,
    );
    expect(proposal).toMatchObject({
      status: "ATTENDED",
      workflowStatus: "PENDING_CONFIRMATION",
    });
    expect(proposalReplay).toEqual(proposal);
    expectMinimal(proposal);

    const completionWindowSessions = getTrainingSessions();
    const completionWindowSession = completionWindowSessions.find(
      (item) => item.id === session.id,
    )!;
    completionWindowSession.endsAt = new Date(
      Date.now() - 10 * 60_000,
    ).toISOString();
    saveTrainingSessions(completionWindowSessions);

    await login("ADMIN");
    const confirmationCommand = {
      enrollmentId: enrollment.id,
      reason: "核对签到和教练记录",
      idempotencyKey: "training-response-consume-1",
    };
    const confirmed = await request<Record<string, unknown>>(
      "POST",
      `/training/sessions/${session.id}/consume/confirm`,
      confirmationCommand,
    );
    const confirmedReplay = await request<Record<string, unknown>>(
      "POST",
      `/training/sessions/${session.id}/consume/confirm`,
      confirmationCommand,
    );
    expect(confirmed).toMatchObject({
      id: expect.any(String),
      type: "CONSUME",
      workflowStatus: "CONFIRMED",
      effectiveRevenueCents: expect.any(Number),
      venueContributionCents: expect.any(Number),
      venueFeeCents: 0,
    });
    expect(confirmedReplay).toEqual(confirmed);
    expectMinimal(confirmed);
    expect(confirmed).not.toHaveProperty("attendanceId");
    expect(confirmed).not.toHaveProperty("enrollmentId");

    const completed = await request<Record<string, unknown>>(
      "POST",
      `/training/sessions/${session.id}/complete`,
    );
    const completedReplay = await request<Record<string, unknown>>(
      "POST",
      `/training/sessions/${session.id}/complete`,
    );
    expect(completed).toEqual({ id: session.id, status: "COMPLETED" });
    expect(completedReplay).toEqual(completed);
    expectMinimal(completed);
  });

  it("returns the same minimal makeup DTO when the assignment is retried", async () => {
    const now = Date.now();
    const sessions = getTrainingSessions();
    const originalSession = sessions.find((item) => item.id === "session-1")!;
    originalSession.startsAt = new Date(now - 30 * 60_000).toISOString();
    originalSession.endsAt = new Date(now + 30 * 60_000).toISOString();
    originalSession.status = "SCHEDULED";
    const makeupSession = {
      id: "session-makeup-privacy",
      classId: "class-adult",
      status: "SCHEDULED",
      startsAt: new Date(now + 86_400_000).toISOString(),
      endsAt: new Date(now + 86_400_000 + 60 * 60_000).toISOString(),
      courtIds: ["court-18"],
    };
    saveTrainingSessions([makeupSession, ...sessions]);

    const enrollments = getEnrollments();
    const enrollment = enrollments.find((item) => item.id === "enroll-1")!;
    const original = enrollment.attendances.find(
      (item: any) => item.sessionId === originalSession.id,
    )!;
    Object.assign(original, {
      status: "PENDING",
      consumedSessions: 0,
      consumedAt: null,
      operatorId: null,
    });
    enrollment.attendances.push({
      id: "attendance-makeup-privacy",
      sessionId: makeupSession.id,
      enrollmentId: enrollment.id,
      status: "PENDING",
      consumedSessions: 0,
      operatorId: null,
    });
    saveEnrollments(enrollments);

    await login("COACH");
    await request(
      "POST",
      `/training/sessions/${originalSession.id}/attendance`,
      {
        enrollmentId: enrollment.id,
        status: "LEAVE",
        reason: "家长提前请假",
      },
    );
    const command = {
      enrollmentId: enrollment.id,
      makeupSessionId: makeupSession.id,
      reason: "安排下次同班补课",
    };
    const first = await request<Record<string, unknown>>(
      "POST",
      `/training/sessions/${originalSession.id}/attendance/makeup`,
      command,
    );
    const replay = await request<Record<string, unknown>>(
      "POST",
      `/training/sessions/${originalSession.id}/attendance/makeup`,
      command,
    );

    expect(first).toEqual({
      id: original.id,
      sessionId: originalSession.id,
      enrollmentId: enrollment.id,
      status: "MADE_UP",
      workflowStatus: "MAKEUP_SCHEDULED",
      makeupSessionId: makeupSession.id,
    });
    expect(replay).toEqual(first);
    expectMinimal(first);
  });
});
