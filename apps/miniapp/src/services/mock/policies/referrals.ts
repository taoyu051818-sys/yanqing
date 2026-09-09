import { mockUser } from "../core";
import {
  getMemberAccounts,
  getMemberAccountTransactions,
  getGovernanceUsers,
  getAuditLogs,
  getReferralRewards,
  saveMemberAccounts,
  saveMemberAccountTransactions,
  saveAuditLogs,
  saveReferralRewards,
} from "../state";
import {
  activeMockIntegerParameter,
  newId,
  creationCommandHash,
} from "./common.js";

export const createMockReferralReward = (order: any, orders: any[]) => {
  if (!order.memberId) return;
  const member = getGovernanceUsers().find(
    (item) => item.id === order.memberId,
  );
  if (!member?.referrerId) return;
  const paidStatuses = [
    "PAID",
    "CHECKED_IN",
    "COMPLETED",
    "PARTIALLY_REFUNDED",
  ];
  if (
    orders.some(
      (item) =>
        item.id !== order.id &&
        item.memberId === order.memberId &&
        paidStatuses.includes(item.status),
    )
  )
    return;
  const rewards = getReferralRewards();
  if (
    rewards.some(
      (item) =>
        item.newUserId === order.memberId &&
        item.triggerType === "FIRST_PAYMENT",
    )
  )
    return;
  const observationDays = activeMockIntegerParameter(
    "referral.refund_observation_days",
    7,
  );
  const createdAt = new Date();
  const reward = {
    id: newId("referral-reward"),
    referrerId: member.referrerId,
    newUserId: order.memberId,
    triggerOrderId: order.id,
    triggerType: "FIRST_PAYMENT",
    rewardType: "BADMINTON_COIN",
    rewardValue: activeMockIntegerParameter(
      "referral.first_payment.coin_reward",
      50,
    ),
    newUserRewardValue: activeMockIntegerParameter(
      "referral.new_user.first_payment.coin_reward",
      50,
    ),
    status: "PENDING_OBSERVATION",
    observationEndsAt: new Date(
      createdAt.getTime() + observationDays * 86_400_000,
    ).toISOString(),
    grantedAt: null,
    reversedAt: null,
    createdAt: createdAt.toISOString(),
  };
  saveReferralRewards([reward, ...rewards]);
  saveAuditLogs([
    {
      id: newId("audit"),
      actorId: mockUser().id,
      actorRole: mockUser().primaryRole,
      action: "REFERRAL_REWARD_SCHEDULED",
      objectType: "ReferralReward",
      objectId: reward.id,
      result: "SUCCESS",
      newValue: {
        referrerId: reward.referrerId,
        newUserId: reward.newUserId,
        triggerOrderId: reward.triggerOrderId,
        rewardValue: reward.rewardValue,
        newUserRewardValue: reward.newUserRewardValue,
      },
      createdAt: reward.createdAt,
    },
    ...getAuditLogs(),
  ]);
};

export const creditMockReferralRecipient = (
  reward: any,
  userId: string,
  amount: number,
  recipientRole: "REFERRER" | "NEW_USER",
  operatorId: string,
) => {
  if (amount <= 0) return null;
  const accountBook = getMemberAccounts();
  const accounts = accountBook[userId] || [];
  let account = accounts.find((item) => item.type === "BADMINTON_COIN");
  if (!account) {
    account = {
      id: `account-${userId}-badminton_coin`,
      userId,
      type: "BADMINTON_COIN",
      balance: 0,
      frozenBalance: 0,
      version: 0,
    };
    accounts.push(account);
  }
  const transactions = getMemberAccountTransactions();
  const idempotencyKey =
    recipientRole === "REFERRER"
      ? `REFERRAL:${reward.id}`
      : `REFERRAL_NEW_USER:${reward.id}`;
  if (transactions.some((item) => item.idempotencyKey === idempotencyKey))
    return idempotencyKey;
  const balanceBefore = Number(account.balance || 0);
  account.balance = balanceBefore + amount;
  account.version = Number(account.version || 0) + 1;
  transactions.unshift({
    id: newId("account-txn"),
    accountId: account.id,
    kind: "CREDIT",
    amount,
    balanceBefore,
    balanceAfter: account.balance,
    reasonCode:
      recipientRole === "REFERRER"
        ? "DIRECT_REFERRAL_REWARD"
        : "NEW_MEMBER_REFERRAL_REWARD",
    reason:
      recipientRole === "REFERRER"
        ? "一层直接推荐有效首单邀请人奖励"
        : "一层直接推荐有效首单新客奖励",
    orderId: reward.triggerOrderId,
    operatorId,
    idempotencyKey,
    createdAt: new Date().toISOString(),
  });
  accountBook[userId] = accounts;
  saveMemberAccounts(accountBook);
  saveMemberAccountTransactions(transactions);
  return idempotencyKey;
};

export const referralInviteTokenHash = (inviteCode: string) =>
  ["a", "b", "c", "d"]
    .map((salt) => creationCommandHash({ salt, inviteCode }))
    .join("");
