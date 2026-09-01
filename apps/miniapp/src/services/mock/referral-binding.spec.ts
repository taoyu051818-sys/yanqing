import { beforeEach, describe, expect, it, vi } from "vitest";

import { mockRequest } from "./router";
import {
  getAuditLogs,
  getGovernanceUsers,
  getMemberAccounts,
  getMemberAccountTransactions,
  getReferralInvites,
  getReferralRewards,
  getSystemParameters,
  resetCatalogState,
  saveGovernanceUsers,
  saveReferralInvites,
  saveSystemParameters,
} from "./state";
import { saveOrders } from "./venue";

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

async function login(role: string) {
  await request("POST", "/auth/dev-login", { role });
}

async function issueInvite(role = "HOST") {
  await login(role);
  return request<{ inviteCode: string; expiresAt: string }>(
    "POST",
    "/referrals/me/invites",
  );
}

describe("miniapp mock opaque referral binding", () => {
  beforeEach(() => {
    storage.clear();
    resetCatalogState();
  });

  it("stores only a hash, binds once and exposes only hasReferrer to the app", async () => {
    const invite = await issueInvite();
    expect(invite.inviteCode).toMatch(/^[A-Za-z0-9_-]{20,128}$/);
    expect(getReferralInvites()[0]).not.toHaveProperty("inviteCode");
    expect(getReferralInvites()[0].tokenHash).not.toBe(invite.inviteCode);

    await login("MEMBER");
    const auditBefore = getAuditLogs().length;
    const command = { inviteCode: invite.inviteCode };
    await expect(request("POST", "/members/me/referrer", command))
      .resolves.toEqual({ bound: true });
    const me = await request<Record<string, unknown>>("GET", "/auth/me");
    expect(me).toMatchObject({ hasReferrer: true });
    expect(me).not.toHaveProperty("referrerId");
    expect(getAuditLogs()).toHaveLength(auditBefore + 1);

    await request("POST", "/members/me/referrer", command);
    expect(getAuditLogs()).toHaveLength(auditBefore + 1);
    expect(getReferralInvites()[0].useCount).toBe(1);
  });

  it("rejects invalid, expired and revoked invites", async () => {
    await login("MEMBER");
    await expect(
      request("POST", "/members/me/referrer", {
        inviteCode: "unknown_opaque_invite_code_1234",
      }),
    ).rejects.toThrow("邀请码无效或已过期");

    const expired = await issueInvite();
    saveReferralInvites(getReferralInvites().map((item) => ({
      ...item,
      expiresAt: new Date(Date.now() - 1).toISOString(),
    })));
    await login("MEMBER");
    await expect(
      request("POST", "/members/me/referrer", { inviteCode: expired.inviteCode }),
    ).rejects.toThrow("邀请码无效或已过期");

    const revoked = await issueInvite();
    saveReferralInvites(getReferralInvites().map((item, index) => index === 0
      ? { ...item, revokedAt: new Date().toISOString() }
      : item));
    await login("MEMBER");
    await expect(
      request("POST", "/members/me/referrer", { inviteCode: revoked.inviteCode }),
    ).rejects.toThrow("邀请码无效或已过期");
  });

  it("allows one reusable invite to bind multiple distinct invited members", async () => {
    const invite = await issueInvite();
    await login("MEMBER");
    await request("POST", "/members/me/referrer", { inviteCode: invite.inviteCode });
    await login("COACH");
    await request("POST", "/members/me/referrer", { inviteCode: invite.inviteCode });

    const users = getGovernanceUsers();
    expect(users.find((item) => item.id === "user-member")?.referrerId)
      .toBe("user-host");
    expect(users.find((item) => item.id === "user-coach")?.referrerId)
      .toBe("user-host");
    expect(getReferralInvites()[0].useCount).toBe(2);
  });

  it("blocks self referral and a two-user cycle", async () => {
    const memberInvite = await issueInvite("MEMBER");
    await expect(
      request("POST", "/members/me/referrer", {
        inviteCode: memberInvite.inviteCode,
      }),
    ).rejects.toThrow("不能推荐自己");

    const hostInvite = await issueInvite("HOST");
    await request("POST", "/members/me/referrer", {
      inviteCode: memberInvite.inviteCode,
    });
    await login("MEMBER");
    await expect(
      request("POST", "/members/me/referrer", {
        inviteCode: hostInvite.inviteCode,
      }),
    ).rejects.toThrow("不能形成闭环");
  });

  it("rejects disabled referrers and inactive invited members", async () => {
    const invite = await issueInvite();
    const users = getGovernanceUsers();
    const referrer = users.find((item) => item.id === "user-host")!;
    referrer.status = "DISABLED";
    saveGovernanceUsers(users);
    await login("MEMBER");
    await expect(
      request("POST", "/members/me/referrer", { inviteCode: invite.inviteCode }),
    ).rejects.toThrow("推荐人不存在或已停用");

    const restored = getGovernanceUsers();
    referrer.status = "ACTIVE";
    const actor = restored.find((item) => item.id === "user-member")!;
    actor.status = "DISABLED";
    saveGovernanceUsers(restored);
    await expect(
      request("POST", "/members/me/referrer", { inviteCode: invite.inviteCode }),
    ).rejects.toThrow("会员不存在或已停用");
  });

  it("creates one first-payment event and grants configurable rewards to both members", async () => {
    const invite = await issueInvite();
    await login("MEMBER");
    await request("POST", "/members/me/referrer", {
      inviteCode: invite.inviteCode,
    });
    saveSystemParameters(getSystemParameters().map((parameter) =>
      parameter.key === "referral.refund_observation_days"
        ? { ...parameter, value: 0 }
        : parameter,
    ));
    saveOrders([{
      id: "order-referral-first",
      orderNo: "YQ-REFERRAL-FIRST",
      memberId: "user-member",
      businessType: "RECHARGE",
      title: "推荐新客首充",
      status: "PENDING",
      payableCents: 10_000,
      paidCents: 0,
      refundedCents: 0,
      parameterSnapshot: { principalCents: 10_000, giftCents: 0 },
      refunds: [],
      createdAt: new Date().toISOString(),
    }]);

    await request("POST", "/orders/order-referral-first/pay", {
      channel: "WECHAT",
      idempotencyKey: "referral-first-payment",
    });
    expect(getReferralRewards()).toHaveLength(1);
    expect(getReferralRewards()[0]).toMatchObject({
      referrerId: "user-host",
      newUserId: "user-member",
      rewardValue: 50,
      newUserRewardValue: 50,
      status: "PENDING_OBSERVATION",
    });

    await login("FINANCE");
    await expect(request("POST", "/referrals/rewards/grant-matured"))
      .resolves.toMatchObject({ processed: 1 });
    await expect(request("POST", "/referrals/rewards/grant-matured"))
      .resolves.toMatchObject({ processed: 0 });

    const accounts = getMemberAccounts();
    expect(accounts["user-host"].find((item) => item.type === "BADMINTON_COIN")?.balance)
      .toBe(50);
    expect(accounts["user-member"].find((item) => item.type === "BADMINTON_COIN")?.balance)
      .toBe(550);
    expect(getMemberAccountTransactions().filter((item) =>
      ["DIRECT_REFERRAL_REWARD", "NEW_MEMBER_REFERRAL_REWARD"].includes(item.reasonCode),
    )).toHaveLength(2);
  });
});
