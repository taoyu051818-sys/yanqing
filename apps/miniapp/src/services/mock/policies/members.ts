import type { AppRole } from "../../../types/domain";
import { mockUser } from "../core";
import { getMemberAccounts, getMemberAccountTransactions } from "../state";
import { hasMockRole } from "./common.js";

export const mockMemberPrivacyScope = ():
  "FRONT_DESK_LIMITED" | "COACH_ASSIGNED" | "FINANCE" | "ADMIN" => {
  if (hasMockRole("ADMIN", "SUPER_ADMIN")) return "ADMIN";
  if (hasMockRole("FINANCE")) return "FINANCE";
  if (hasMockRole("FRONT_DESK")) return "FRONT_DESK_LIMITED";
  return "COACH_ASSIGNED";
};

export const maskMockPhone = (phone?: string | null) => {
  if (!phone) return null;
  if (phone.length <= 4) return "*".repeat(phone.length);
  if (phone.length <= 7) return `${phone.slice(0, 2)}***${phone.slice(-2)}`;
  return `${phone.slice(0, 3)}****${phone.slice(-4)}`;
};

export const mockMemberIdentity = (userId: string) => {
  if (userId === "member-1")
    return {
      id: userId,
      displayName: "延庆会员小林",
      phone: "13800000005",
    };
  if (userId === "member-2")
    return { id: userId, displayName: "羽友小周", phone: "13800000007" };
  return { id: userId, displayName: userId, phone: null };
};

export const mockActorIdentity = (userId: string) => {
  const actorRoles: AppRole[] = [
    "FRONT_DESK",
    "COACH",
    "FINANCE",
    "ADMIN",
    "SUPER_ADMIN",
  ];
  const actor = actorRoles
    .map((role) => mockUser(role))
    .find((item) => item.id === userId);
  return actor
    ? { id: actor.id, displayName: actor.displayName }
    : { id: userId, displayName: userId };
};

export const accountTransactionView = (
  transaction: any,
  accountType?: string,
) => ({
  id: transaction.id,
  kind: transaction.kind,
  amount: transaction.amount,
  balanceBefore: transaction.balanceBefore,
  balanceAfter: transaction.balanceAfter,
  reasonCode: transaction.reasonCode,
  reason: transaction.reason,
  expiresAt: transaction.expiresAt || null,
  createdAt: transaction.createdAt,
  account: accountType ? { type: accountType } : undefined,
  operator: transaction.operatorId
    ? { displayName: mockActorIdentity(transaction.operatorId)?.displayName }
    : null,
});

export const accountAdjustmentView = (request: any) => {
  const account = Object.values(getMemberAccounts())
    .flat()
    .find((item: any) => item.id === request.accountId) as any;
  const transaction = request.transactionId
    ? getMemberAccountTransactions().find(
        (item) => item.id === request.transactionId,
      ) || null
    : null;
  return {
    id: request.id,
    amount: request.amount,
    reason: request.reason,
    status: request.status,
    reviewReason: request.reviewReason || null,
    reviewedAt: request.reviewedAt || null,
    createdAt: request.createdAt,
    updatedAt: request.updatedAt,
    isOwnRequest: request.requestedById === mockUser().id,
    account: account
      ? {
          type: account.type,
          balance: account.balance,
          frozenBalance: account.frozenBalance,
          user: {
            displayName: mockMemberIdentity(account.userId)?.displayName,
            phone: mockMemberIdentity(account.userId)?.phone,
          },
        }
      : null,
    requestedBy: {
      displayName: mockActorIdentity(request.requestedById)?.displayName,
    },
    reviewedBy: request.reviewedById
      ? { displayName: mockActorIdentity(request.reviewedById)?.displayName }
      : null,
    transaction: transaction
      ? accountTransactionView(transaction, account?.type)
      : null,
  };
};
