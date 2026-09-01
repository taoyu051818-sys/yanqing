import { beforeEach, describe, expect, it, vi } from "vitest";

import { mockRequest } from "./router";
import {
  getAuditLogs,
  getGovernanceUsers,
  resetCatalogState,
} from "./state";

const storage = new Map<string, unknown>();

vi.stubGlobal("uni", {
  getStorageSync: (key: string) => storage.get(key) ?? "",
  setStorageSync: (key: string, value: unknown) => storage.set(key, value),
  removeStorageSync: (key: string) => storage.delete(key),
});

const login = (role: string) => mockRequest<any>("POST", "/auth/dev-login", { role });
const request = <T = any>(method: string, url: string, data: Record<string, unknown> = {}) =>
  mockRequest<T>(method, url, data);
const privateReplayFields = [
  "requestIdempotencyKey",
  "requestCommandHash",
  "decisionIdempotencyKey",
  "decisionCommandHash",
] as const;

const expectPrivateReplayFieldsHidden = (value: unknown) => {
  for (const field of privateReplayFields) {
    expect(value).not.toHaveProperty(field);
  }
};

describe("miniapp mock data-erasure workflow", () => {
  beforeEach(async () => {
    storage.clear();
    resetCatalogState();
    await login("MEMBER");
  });

  it("creates and cancels the member's own request with exact idempotent replay", async () => {
    const create = { reason: "不再使用服务", idempotencyKey: "privacy-request-member-1" };
    const first = await request("POST", "/privacy/erasure-requests", create);
    const replay = await request("POST", "/privacy/erasure-requests", create);

    expect(replay.id).toBe(first.id);
    expectPrivateReplayFieldsHidden(first);
    expectPrivateReplayFieldsHidden(replay);
    await expect(request("POST", "/privacy/erasure-requests", {
      ...create, reason: "另一个注销原因",
    })).rejects.toThrow("幂等键已用于不同账号或命令");
    const mine = await request<any[]>("GET", "/privacy/erasure-requests/me");
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ userId: "user-member", status: "REQUESTED" });
    expectPrivateReplayFieldsHidden(mine[0]);

    const cancel = { reason: "决定继续使用", idempotencyKey: "privacy-cancel-member-1" };
    const cancelled = await request("POST", `/privacy/erasure-requests/${first.id}/cancel`, cancel);
    const cancelReplay = await request("POST", `/privacy/erasure-requests/${first.id}/cancel`, cancel);
    expect(cancelReplay).toEqual(cancelled);
    expect(cancelled.status).toBe("CANCELLED");
    expectPrivateReplayFieldsHidden(cancelled);
    expectPrivateReplayFieldsHidden(cancelReplay);
    expect(getAuditLogs().filter((item) => item.objectId === first.id)).toHaveLength(2);
  });

  it("shows concrete blockers and never lets an administrator bypass them", async () => {
    const created = await request("POST", "/privacy/erasure-requests", {
      reason: "测试未结清阻断",
      idempotencyKey: "privacy-request-blocked-1",
    });
    await login("ADMIN");

    const blockers = await request<any[]>("GET", `/privacy/erasure-requests/${created.id}/blockers`);
    expect(blockers).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "USER_MUST_BE_DISABLED" }),
      expect.objectContaining({ code: "SPENDABLE_ACCOUNT_BALANCE" }),
    ]));
    await expect(request("POST", `/privacy/erasure-requests/${created.id}/complete`, {
      reason: "越权尝试",
      idempotencyKey: "privacy-complete-blocked-1",
    })).rejects.toThrow("需要：SUPER_ADMIN");
    await login("SUPER_ADMIN");
    await expect(request("POST", `/privacy/erasure-requests/${created.id}/complete`, {
      reason: "仍有余额不可完成",
      idempotencyKey: "privacy-complete-blocked-2",
    })).rejects.toThrow("仍有未完成业务");
  });

  it("completes the seeded clean request once and persists anonymized identity evidence", async () => {
    await login("SUPER_ADMIN");
    const queue = await request<any>("GET", "/privacy/erasure-requests", { status: "REQUESTED" });
    const ready = queue.items.find((item: any) => item.id === "erasure-mock-ready");
    expect(ready).toBeTruthy();
    expectPrivateReplayFieldsHidden(ready);
    await expect(request<any[]>("GET", `/privacy/erasure-requests/${ready.id}/blockers`)).resolves.toEqual([]);

    const command = { reason: "确认所有业务已经结清", idempotencyKey: "privacy-complete-ready-1" };
    const completed = await request("POST", `/privacy/erasure-requests/${ready.id}/complete`, command);
    const replay = await request("POST", `/privacy/erasure-requests/${ready.id}/complete`, command);
    expect(replay).toEqual(completed);

    expect(completed).toMatchObject({ status: "COMPLETED", completedAt: expect.any(String) });
    expectPrivateReplayFieldsHidden(completed);
    expectPrivateReplayFieldsHidden(replay);
    expect(getGovernanceUsers().find((item) => item.id === "user-privacy")).toMatchObject({
      status: "DELETED",
      phone: null,
      primaryRole: "MEMBER",
      wechatBound: false,
    });
    expect(getAuditLogs().filter((item) => item.requestId === command.idempotencyKey)).toHaveLength(1);
  });
});
