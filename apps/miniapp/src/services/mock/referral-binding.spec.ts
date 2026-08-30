import { beforeEach, describe, expect, it, vi } from "vitest";

import { mockRequest } from "./router";
import {
  getAuditLogs,
  getGovernanceUsers,
  resetCatalogState,
  saveGovernanceUsers,
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

describe("miniapp mock direct referral binding", () => {
  beforeEach(async () => {
    storage.clear();
    resetCatalogState();
    await request("POST", "/auth/dev-login", { role: "MEMBER" });
  });

  it("binds once, returns the relation from /me, and replays without duplicate audit", async () => {
    const auditBefore = getAuditLogs().length;
    const command = { referrerId: "user-host" };
    await expect(request("POST", "/members/me/referrer", command))
      .resolves.toEqual({ id: "user-member", referrerId: "user-host" });
    await expect(request("GET", "/auth/me"))
      .resolves.toMatchObject({ referrerId: "user-host" });
    expect(getAuditLogs()).toHaveLength(auditBefore + 1);

    await request("POST", "/members/me/referrer", command);
    expect(getAuditLogs()).toHaveLength(auditBefore + 1);
    await expect(
      request("POST", "/members/me/referrer", { referrerId: "user-coach" }),
    ).rejects.toThrow("不能更换");
  });

  it("blocks self referral and a two-user cycle", async () => {
    await expect(
      request("POST", "/members/me/referrer", { referrerId: "user-member" }),
    ).rejects.toThrow("不能推荐自己");

    await request("POST", "/auth/dev-login", { role: "HOST" });
    await request("POST", "/members/me/referrer", { referrerId: "user-member" });
    await request("POST", "/auth/dev-login", { role: "MEMBER" });
    await expect(
      request("POST", "/members/me/referrer", { referrerId: "user-host" }),
    ).rejects.toThrow("不能形成闭环");
  });

  it("rejects a disabled or non-member referrer without persisting the immutable relation", async () => {
    const users = getGovernanceUsers();
    const referrer = users.find((item) => item.id === "user-host")!;
    referrer.status = "DISABLED";
    saveGovernanceUsers(users);
    const auditBefore = getAuditLogs().length;

    await expect(
      request("POST", "/members/me/referrer", { referrerId: referrer.id }),
    ).rejects.toThrow("推荐人不存在或已停用");
    expect(getGovernanceUsers().find((item) => item.id === "user-member")?.referrerId)
      .toBeFalsy();
    expect(getAuditLogs()).toHaveLength(auditBefore);

    const restored = getGovernanceUsers();
    const nonMember = restored.find((item) => item.id === "user-host")!;
    nonMember.status = "ACTIVE";
    nonMember.roles = nonMember.roles.filter((entry: any) => entry.role !== "MEMBER");
    saveGovernanceUsers(restored);
    await expect(
      request("POST", "/members/me/referrer", { referrerId: nonMember.id }),
    ).rejects.toThrow("推荐人不存在或已停用");
    expect(getGovernanceUsers().find((item) => item.id === "user-member")?.referrerId)
      .toBeFalsy();
  });

  it("rejects a binding when the current actor is no longer an active member", async () => {
    const users = getGovernanceUsers();
    const actor = users.find((item) => item.id === "user-member")!;
    actor.status = "DISABLED";
    saveGovernanceUsers(users);

    await expect(
      request("POST", "/members/me/referrer", { referrerId: "user-host" }),
    ).rejects.toThrow("会员不存在或已停用");
    expect(getGovernanceUsers().find((item) => item.id === "user-member")?.referrerId)
      .toBeFalsy();
  });
});
