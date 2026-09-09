import { mockUser } from "../../core";
import {
  getAccountAdjustmentRequests,
  getMemberAccounts,
  getMemberAccountTransactions,
  saveAccountAdjustmentRequests,
  saveMemberAccounts,
  saveMemberAccountTransactions,
} from "../../state";
import {
  ok,
  requireMockRole,
  text,
  integer,
  requireIdempotencyKey,
  newId,
  creationCommandHash,
} from "../../policies/common.js";
import {
  accountTransactionView,
  accountAdjustmentView,
} from "../../policies/members.js";
import type { MockRouteResult, MockRouteOptions } from "../route-contract.js";

export async function handleMembersMeAccountsTransactionsAny(
  method: string,
  url: string,
  data: any,
  options: MockRouteOptions,
): Promise<MockRouteResult> {
  if (url === "/members/me/accounts/transactions") {
    const accounts = getMemberAccounts()[mockUser().id] || [];
    const byId = new Map(accounts.map((account) => [account.id, account]));
    return {
      handled: true,
      value: ok(
        getMemberAccountTransactions()
          .filter((transaction) => byId.has(transaction.accountId))
          .map((transaction: any) =>
            accountTransactionView(
              transaction,
              String(byId.get(transaction.accountId)?.type || ""),
            ),
          )
          .sort(
            (left: any, right: any) =>
              new Date(right.createdAt || 0).getTime() -
              new Date(left.createdAt || 0).getTime(),
          ),
      ),
    };
  }
  return { handled: false };
}

export async function handleMembersAccountAdjustmentsGet(
  method: string,
  url: string,
  data: any,
  options: MockRouteOptions,
): Promise<MockRouteResult> {
  if (url === "/members/account-adjustments" && method === "GET") {
    requireMockRole("FINANCE", "ADMIN", "SUPER_ADMIN");
    const status = text(data.status);
    if (status && !["REQUESTED", "POSTED", "REJECTED"].includes(status))
      throw new Error("账户调整状态无效");
    const requests = getAccountAdjustmentRequests()
      .filter((request) => !status || request.status === status)
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
      .map(accountAdjustmentView);
    return { handled: true, value: ok(requests) };
  }
  return { handled: false };
}

export async function handleAccountAdjustmentCreatePost(
  method: string,
  url: string,
  data: any,
  options: MockRouteOptions,
): Promise<MockRouteResult> {
  const accountAdjustmentCreateMatch = url.match(
    /^\/members\/([^/]+)\/accounts\/adjust$/,
  );
  if (accountAdjustmentCreateMatch && method === "POST") {
    requireMockRole("FINANCE", "ADMIN", "SUPER_ADMIN");
    const memberId = accountAdjustmentCreateMatch[1];
    const accountType = text(data.accountType);
    const amount = integer(data.amount);
    const reason = text(data.reason);
    const idempotencyKey = requireIdempotencyKey(data.idempotencyKey);
    if (!Number.isSafeInteger(amount) || amount === 0)
      throw new Error("调整金额不能为 0");
    if (reason.length < 2 || reason.length > 200)
      throw new Error("调整原因至少需要2个字符且不能超过200个字符");
    const memberAccounts = getMemberAccounts();
    const account = (memberAccounts[memberId] || []).find(
      (item) => item.type === accountType,
    );
    if (!account) throw new Error("账户不存在");
    const commandHash = creationCommandHash({
      version: 1,
      userId: memberId,
      accountType,
      amount,
      reason,
    });
    const requests = getAccountAdjustmentRequests();
    const existing = requests.find(
      (request) => request.requestIdempotencyKey === idempotencyKey,
    );
    if (existing) {
      if (
        existing.requestedById !== mockUser().id ||
        existing.accountId !== account.id ||
        existing.commandHash !== commandHash
      )
        throw new Error("幂等键已用于不同的账户调整申请");
      return { handled: true, value: ok(accountAdjustmentView(existing)) };
    }
    const now = new Date().toISOString();
    const request = {
      id: newId("account-adjustment"),
      accountId: account.id,
      amount,
      reason,
      status: "REQUESTED",
      requestedById: mockUser().id,
      reviewedById: null,
      requestIdempotencyKey: idempotencyKey,
      commandHash,
      reviewReason: null,
      transactionId: null,
      reviewedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    saveAccountAdjustmentRequests([request, ...requests]);
    return { handled: true, value: ok(accountAdjustmentView(request)) };
  }
  return { handled: false };
}

export async function handleAccountAdjustmentReviewPost(
  method: string,
  url: string,
  data: any,
  options: MockRouteOptions,
): Promise<MockRouteResult> {
  const accountAdjustmentReviewMatch = url.match(
    /^\/members\/account-adjustments\/([^/]+)\/(approve|reject)$/,
  );
  if (accountAdjustmentReviewMatch && method === "POST") {
    requireMockRole("FINANCE", "ADMIN", "SUPER_ADMIN");
    const [, requestId, action] = accountAdjustmentReviewMatch;
    const reviewReason = text(data.reason);
    if (reviewReason.length < 2 || reviewReason.length > 200)
      throw new Error(
        `${action === "approve" ? "复核" : "驳回"}原因至少需要2个字符且不能超过200个字符`,
      );
    const requests = getAccountAdjustmentRequests();
    const request = requests.find((item) => item.id === requestId);
    if (!request) throw new Error("账户调整申请不存在");

    if (action === "approve") {
      if (request.status === "POSTED")
        return { handled: true, value: ok(accountAdjustmentView(request)) };
      if (request.status === "REJECTED")
        throw new Error("已驳回的账户调整不能入账");
    } else {
      if (request.status === "REJECTED")
        return { handled: true, value: ok(accountAdjustmentView(request)) };
      if (request.status === "POSTED")
        throw new Error("已入账的账户调整不能驳回；请提交反向调整申请");
    }
    if (request.requestedById === mockUser().id)
      throw new Error("账户调整申请人与复核人不能是同一账号");

    const now = new Date().toISOString();
    if (action === "reject") {
      Object.assign(request, {
        status: "REJECTED",
        reviewedById: mockUser().id,
        reviewedAt: now,
        reviewReason,
        updatedAt: now,
      });
      saveAccountAdjustmentRequests(requests);
      return { handled: true, value: ok(accountAdjustmentView(request)) };
    }

    const memberAccounts = getMemberAccounts();
    const account = Object.values(memberAccounts)
      .flat()
      .find((item: any) => item.id === request.accountId) as any;
    if (!account) throw new Error("账户不存在");
    const balanceBefore = Number(account.balance || 0);
    const balanceAfter = balanceBefore + Number(request.amount);
    if (balanceAfter < 0) throw new Error("账户余额不足");
    const transaction = {
      id: newId("account-transaction"),
      accountId: account.id,
      kind: Number(request.amount) > 0 ? "CREDIT" : "DEBIT",
      amount: Number(request.amount),
      balanceBefore,
      balanceAfter,
      reasonCode: "MANUAL_ADJUSTMENT",
      reason: request.reason,
      operatorId: mockUser().id,
      idempotencyKey: `ACCOUNT_ADJUSTMENT:${request.id}`,
      metadata: { requestId: request.id, reviewReason },
      createdAt: now,
    };
    account.balance = balanceAfter;
    account.version = Number(account.version || 0) + 1;
    Object.assign(request, {
      status: "POSTED",
      reviewedById: mockUser().id,
      reviewedAt: now,
      reviewReason,
      transactionId: transaction.id,
      updatedAt: now,
    });
    saveMemberAccounts(memberAccounts);
    saveMemberAccountTransactions([
      transaction,
      ...getMemberAccountTransactions(),
    ]);
    saveAccountAdjustmentRequests(requests);
    return { handled: true, value: ok(accountAdjustmentView(request)) };
  }
  return { handled: false };
}

export async function handleMemberAccountTransactionsGet(
  method: string,
  url: string,
  data: any,
  options: MockRouteOptions,
): Promise<MockRouteResult> {
  const memberAccountTransactionsMatch = url.match(
    /^\/members\/([^/]+)\/accounts\/transactions$/,
  );
  if (memberAccountTransactionsMatch && method === "GET") {
    requireMockRole("FINANCE", "ADMIN", "SUPER_ADMIN");
    const memberId = memberAccountTransactionsMatch[1];
    const accountById = new Map(
      (getMemberAccounts()[memberId] || []).map((account) => [
        account.id,
        account,
      ]),
    );
    return {
      handled: true,
      value: ok(
        getMemberAccountTransactions()
          .filter((transaction) => accountById.has(transaction.accountId))
          .map((transaction) =>
            accountTransactionView(
              transaction,
              String(accountById.get(transaction.accountId)?.type || ""),
            ),
          ),
      ),
    };
  }
  return { handled: false };
}
