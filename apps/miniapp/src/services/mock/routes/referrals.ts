import { mockUser } from "../core";
import { getOrders } from "../venue";
import {
  getGovernanceUsers,
  getAuditLogs,
  getReferralInvites,
  getReferralRewards,
  saveAuditLogs,
  saveReferralInvites,
  saveReferralRewards,
} from "../state";
import { ok, requireMockRole, newId } from "../policies/common.js";
import {
  creditMockReferralRecipient,
  referralInviteTokenHash,
} from "../policies/referrals.js";
import type { MockRouteResult, MockRouteOptions } from "./route-contract.js";

export async function handleReferralsMeInvitesPost(
  method: string,
  url: string,
  data: any,
  options: MockRouteOptions,
): Promise<MockRouteResult> {
  if (url === "/referrals/me/invites" && method === "POST") {
    const actor = mockUser();
    const users = getGovernanceUsers();
    const hasMemberIdentity = (item: any) =>
      Array.isArray(item?.roles) &&
      item.roles.some(
        (role: any) =>
          (typeof role === "string" ? role : role?.role) === "MEMBER",
      );
    const inviter = users.find((item) => item.id === actor.id);
    if (!inviter || inviter.status !== "ACTIVE" || !hasMemberIdentity(inviter))
      throw new Error("会员不存在或已停用");
    const inviteCode = `${newId("referral-invite")}-${Math.random().toString(36).slice(2, 12)}`;
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1_000);
    const invites = getReferralInvites();
    saveReferralInvites([
      {
        id: newId("referral-invite-record"),
        tokenHash: referralInviteTokenHash(inviteCode),
        inviterId: actor.id,
        expiresAt: expiresAt.toISOString(),
        revokedAt: null,
        useCount: 0,
        lastUsedAt: null,
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
      },
      ...invites,
    ]);
    return {
      handled: true,
      value: ok({ inviteCode, expiresAt: expiresAt.toISOString() }),
    };
  }
  return { handled: false };
}

export async function handleReferralsMeRewardsAny(
  method: string,
  url: string,
  data: any,
  options: MockRouteOptions,
): Promise<MockRouteResult> {
  if (url === "/referrals/me/rewards") {
    const actor = mockUser();
    return {
      handled: true,
      value: ok(
        getReferralRewards()
          .filter(
            (reward) =>
              reward.referrerId === actor.id || reward.newUserId === actor.id,
          )
          .map((reward) => {
            const recipientRole =
              reward.referrerId === actor.id ? "REFERRER" : "NEW_USER";
            const {
              referrerId: _referrerId,
              newUserId: _newUserId,
              triggerOrderId: _triggerOrderId,
              ...publicReward
            } = reward;
            return {
              ...publicReward,
              recipientRole,
              recipientRewardValue:
                recipientRole === "REFERRER"
                  ? reward.rewardValue
                  : reward.newUserRewardValue,
            };
          }),
      ),
    };
  }
  return { handled: false };
}

export async function handleReferralsRewardsGrantMaturedPost(
  method: string,
  url: string,
  data: any,
  options: MockRouteOptions,
): Promise<MockRouteResult> {
  if (url === "/referrals/rewards/grant-matured" && method === "POST") {
    requireMockRole("FINANCE", "ADMIN", "SUPER_ADMIN");
    const now = new Date();
    const rewards = getReferralRewards();
    const orders = getOrders();
    const processed: any[] = [];
    for (const reward of rewards) {
      if (!["PENDING_OBSERVATION", "AVAILABLE"].includes(reward.status))
        continue;
      if (new Date(reward.observationEndsAt).getTime() > now.getTime())
        continue;
      const order = orders.find((item) => item.id === reward.triggerOrderId);
      if (
        !order ||
        order.status !== "COMPLETED" ||
        !order.completedAt ||
        Number(order.refundedCents || 0) > 0
      )
        continue;
      const idempotencyKeys = [
        creditMockReferralRecipient(
          reward,
          reward.referrerId,
          Number(reward.rewardValue || 0),
          "REFERRER",
          mockUser().id,
        ),
        creditMockReferralRecipient(
          reward,
          reward.newUserId,
          Number(reward.newUserRewardValue || 0),
          "NEW_USER",
          mockUser().id,
        ),
      ].filter(Boolean);
      reward.status = "GRANTED";
      reward.grantedAt = now.toISOString();
      saveAuditLogs([
        {
          id: newId("audit"),
          actorId: mockUser().id,
          actorRole: mockUser().primaryRole,
          action: "REFERRAL_REWARD_GRANTED",
          objectType: "ReferralReward",
          objectId: reward.id,
          result: "SUCCESS",
          newValue: { idempotencyKeys },
          createdAt: reward.grantedAt,
        },
        ...getAuditLogs(),
      ]);
      processed.push(reward);
    }
    saveReferralRewards(rewards);
    return {
      handled: true,
      value: ok({ processed: processed.length, results: processed }),
    };
  }
  return { handled: false };
}
