import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { mockRequest } from "./router";
import {
  getAuditLogs,
  getTrainingTrials,
  resetCatalogState,
  saveTrainingTrials,
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
const login = (role: string) =>
  request("POST", "/auth/dev-login", { role });

describe("miniapp mock training trial funnel", () => {
  beforeEach(() => {
    vi.useRealTimers();
    storage.clear();
    resetCatalogState();
  });

  it("runs reserve, check-in, structured assessment and paid conversion with exact replays", async () => {
    await login("FRONT_DESK");
    const sessions = await request<any[]>("GET", "/training/sessions");
    const session = sessions.find((item) => item.id === "session-1");
    const start = new Date(new Date(session.startsAt).getTime() + 10 * 60_000);
    const end = new Date(new Date(session.endsAt).getTime() - 10 * 60_000);
    const reserveCommand = {
      memberId: "user-member",
      productId: "training-adult",
      classId: "class-adult",
      sessionId: "session-1",
      coachId: "user-coach",
      sourceChannel: "STORE_VISIT",
      scheduledStartsAt: start.toISOString(),
      scheduledEndsAt: end.toISOString(),
      reason: "会员确认成人试听预约",
      idempotencyKey: "trial-reserve-mock-001",
    };
    const reserved = await request("POST", "/training/trials", reserveCommand);
    await expect(
      request("POST", "/training/trials", reserveCommand),
    ).resolves.toEqual(reserved);

    const trials = getTrainingTrials();
    const storedTrial = trials.find((item) => item.id === reserved.id)!;
    storedTrial.scheduledStartsAt = new Date(Date.now() - 10 * 60_000).toISOString();
    storedTrial.scheduledEndsAt = new Date(Date.now() + 20 * 60_000).toISOString();
    saveTrainingTrials(trials);

    const checkedIn = await request(
      "POST",
      `/training/trials/${reserved.id}/check-in`,
      { reason: "前台核对本人到场", idempotencyKey: "trial-checkin-mock-001" },
    );
    expect(checkedIn).toMatchObject({ status: "CHECKED_IN" });

    await login("COACH");
    const assessed = await request(
      "POST",
      `/training/trials/${reserved.id}/assess`,
      {
        dimensions: [
          { key: "movement", label: "步法", score: 4 },
          { key: "racket", label: "持拍", score: 3, note: "需稳定击球点" },
        ],
        recommendation: "建议进入成人进阶班并加强步法训练",
        note: "已向会员说明训练建议",
        reason: "教练完成现场结构化测评",
        idempotencyKey: "trial-assess-mock-001",
      },
    );
    expect(assessed).toMatchObject({
      status: "ASSESSED",
      recommendation: "建议进入成人进阶班并加强步法训练",
    });
    expect(assessed.assessmentDimensions).toHaveLength(2);

    await login("ADMIN");
    const converted = await request(
      "POST",
      `/training/trials/${reserved.id}/convert`,
      {
        enrollmentId: "enroll-1",
        reason: "正式课报名已支付并核对会员归属",
        idempotencyKey: "trial-convert-mock-001",
      },
    );
    expect(converted).toMatchObject({
      status: "CONVERTED",
      convertedEnrollmentId: "enroll-1",
    });
    await expect(
      request("POST", `/training/trials/${reserved.id}/lost`, {
        reason: "错误覆盖终态",
        idempotencyKey: "trial-invalid-mock-001",
      }),
    ).rejects.toThrow("不允许执行");

    await login("MEMBER");
    const mine = await request<any[]>("GET", "/training/trials/mine");
    expect(mine[0]).toMatchObject({
      id: reserved.id,
      status: "CONVERTED",
      recommendation: "建议进入成人进阶班并加强步法训练",
    });
    expect(
      getAuditLogs().filter((item) => item.objectId === reserved.id),
    ).toHaveLength(4);
  });

  it("enforces role, unique subject and no-show to lost transitions", async () => {
    await login("COACH");
    await expect(
      request("POST", "/training/trials", {
        memberId: "user-member",
        productId: "training-adult",
        classId: "class-adult",
        coachId: "user-coach",
        scheduledStartsAt: new Date(Date.now() + 86_400_000).toISOString(),
        scheduledEndsAt: new Date(Date.now() + 90_000_000).toISOString(),
        sourceChannel: "STORE_VISIT",
        reason: "教练越权预约",
        idempotencyKey: "trial-denied-mock-001",
      }),
    ).rejects.toThrow("无权");

    await login("FRONT_DESK");
    const session = (await request<any[]>("GET", "/training/sessions"))[0];
    const startsAt = new Date(new Date(session.startsAt).getTime() + 15 * 60_000);
    const endsAt = new Date(startsAt.getTime() + 30 * 60_000);
    await expect(
      request("POST", "/training/trials", {
        leadId: "lead-mock-1",
        memberId: "user-member",
        productId: "training-adult",
        classId: "class-adult",
        sessionId: session.id,
        coachId: "user-coach",
        sourceChannel: "STORE_VISIT",
        scheduledStartsAt: startsAt.toISOString(),
        scheduledEndsAt: endsAt.toISOString(),
        reason: "错误多主体预约",
        idempotencyKey: "trial-subject-mock-001",
      }),
    ).rejects.toThrow("仅选择一个主体");
    const reserved = await request("POST", "/training/trials", {
      leadId: "lead-mock-1",
      productId: "training-adult",
      classId: "class-adult",
      sessionId: session.id,
      coachId: "user-coach",
      sourceChannel: "STORE_VISIT",
      scheduledStartsAt: startsAt.toISOString(),
      scheduledEndsAt: endsAt.toISOString(),
      reason: "线索确认试听预约",
      idempotencyKey: "trial-noshow-mock-001",
    });
    const trials = getTrainingTrials();
    const storedTrial = trials.find((item) => item.id === reserved.id)!;
    storedTrial.scheduledStartsAt = new Date(Date.now() - 40 * 60_000).toISOString();
    storedTrial.scheduledEndsAt = new Date(Date.now() - 10 * 60_000).toISOString();
    saveTrainingTrials(trials);
    const noShow = await request(
      "POST",
      `/training/trials/${reserved.id}/no-show`,
      { reason: "约定时间未到场", idempotencyKey: "trial-noshow-action-001" },
    );
    expect(noShow.noShowAt).toBeTruthy();
    await login("ADMIN");
    const lost = await request(
      "POST",
      `/training/trials/${reserved.id}/lost`,
      { reason: "多次联系后明确不再体验", idempotencyKey: "trial-lost-mock-001" },
    );
    expect(lost).toMatchObject({ status: "LOST" });
    expect(lost.lostAt).toBeTruthy();
  });
});

describe("miniapp mock youth training rules", () => {
  beforeEach(() => {
    storage.clear();
    resetCatalogState();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-30T08:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const timedRequest = async <T = any>(
    method: string,
    url: string,
    data: Record<string, unknown> = {},
  ) => {
    const pending = mockRequest<T>(method, url, data).then(
      (value) => ({ ok: true as const, value }),
      (error) => ({ ok: false as const, error }),
    );
    await vi.advanceTimersByTimeAsync(120);
    const outcome = await pending;
    if (!outcome.ok) throw outcome.error;
    return outcome.value;
  };

  it("blocks youth sales without a rule, then applies ADMIN/SUPER maker-checker and snapshots the configured version", async () => {
    await timedRequest("POST", "/auth/dev-login", { role: "ADMIN" });
    await expect(
      timedRequest("POST", "/training/products", {
        code: "YOUTH-NO-RULE",
        name: "无规则青少年课包",
        audience: "YOUTH",
        totalSessions: 18,
        validityDays: 180,
        priceCents: 188_000,
        refundRule: { afterStart: "REFUND_UNUSED_SESSIONS" },
        reason: "验证无规则时必须阻断",
        creationIdempotencyKey: "youth-product-no-rule-001",
      }),
    ).rejects.toThrow("正式销售已阻断");

    const effectiveFrom = new Date(Date.now() + 60_000).toISOString();
    const draft = await timedRequest("POST", "/training/youth-rules", {
      maxTotalSessions: 24,
      maxValidityDays: 200,
      maxContractAmountCents: 260_000,
      warningThresholdDays: 30,
      hardBlock: true,
      effectiveFrom,
      reason: "根据测试经营合规口径提交完整规则",
      idempotencyKey: "youth-rule-draft-mock-001",
    });
    expect(draft).toMatchObject({ status: "DRAFT", requestedById: "user-admin" });
    await expect(
      timedRequest("POST", `/training/youth-rules/${draft.id}/publish`, {
        reason: "制单人越权复核",
        idempotencyKey: "youth-rule-self-review-001",
      }),
    ).rejects.toThrow("SUPER_ADMIN");

    await timedRequest("POST", "/auth/dev-login", { role: "SUPER_ADMIN" });
    const published = await timedRequest(
      "POST",
      `/training/youth-rules/${draft.id}/publish`,
      {
        reason: "异人复核字段完整并同意发布",
        idempotencyKey: "youth-rule-publish-mock-001",
      },
    );
    expect(published).toMatchObject({ status: "PUBLISHED", reviewedById: "user-super" });
    await vi.advanceTimersByTimeAsync(60_001);
    const active = await timedRequest("GET", "/training/youth-rules/active");
    expect(active.version).toBe(draft.version);

    const product = await timedRequest("POST", "/training/products", {
      code: "YOUTH-RULED",
      name: "受规则约束青少年课包",
      audience: "YOUTH",
      totalSessions: 18,
      validityDays: 180,
      priceCents: 188_000,
      refundRule: { afterStart: "REFUND_UNUSED_SESSIONS" },
      reason: "按已发布规则创建测试产品",
      creationIdempotencyKey: "youth-product-ruled-001",
    });
    expect(product.regulatoryValidation).toMatchObject({
      version: draft.version,
      result: "WARNING",
      limits: { warningThresholdDays: 30 },
    });
    const updated = await timedRequest(
      "PATCH",
      `/training/products/${product.id}`,
      {
        priceCents: 190_000,
        reason: "验证产品变更继续按生效版本校验",
        idempotencyKey: "youth-product-update-001",
      },
    );
    expect(updated.regulatoryValidation.version).toBe(draft.version);

    await timedRequest("POST", "/auth/dev-login", { role: "MEMBER" });
    const order = await timedRequest("POST", "/training/purchase", {
      productId: "training-youth",
      studentId: "student-youth-1",
      sourceChannel: "MINI_PROGRAM",
      creationIdempotencyKey: "youth-purchase-mock-001",
    });
    expect(order.parameterSnapshot.youthRegulatoryValidation).toMatchObject({
      version: draft.version,
      limits: { maxTotalSessions: 24, maxValidityDays: 200 },
    });
  });
});
