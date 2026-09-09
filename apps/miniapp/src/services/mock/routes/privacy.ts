import { mockUser } from "../core";
import { getOrders } from "../venue";
import {
  getCoupons,
  getEnrollments,
  getGovernanceUsers,
  getAuditLogs,
  getDataErasureRequests,
  saveGovernanceUsers,
  saveAuditLogs,
  saveDataErasureRequests,
} from "../state";
import {
  ok,
  mockRoles,
  requireMockRole,
  text,
  requireIdempotencyKey,
  newId,
  creationCommandHash,
} from "../policies/common.js";
import { mockDataErasureRequestView } from "../policies/privacy.js";
import type { MockRouteResult, MockRouteOptions } from "./route-contract.js";

export async function handlePrivacyErasureRequestsMeGet(
  method: string,
  url: string,
  data: any,
  options: MockRouteOptions,
): Promise<MockRouteResult> {
  if (url === "/privacy/erasure-requests/me" && method === "GET") {
    return {
      handled: true,
      value: ok(
        getDataErasureRequests()
          .filter((item) => item.userId === mockUser().id)
          .sort((left, right) =>
            String(right.requestedAt).localeCompare(String(left.requestedAt)),
          )
          .map((item) => mockDataErasureRequestView(item)),
      ),
    };
  }
  return { handled: false };
}

export async function handlePrivacyErasureRequestsPost(
  method: string,
  url: string,
  data: any,
  options: MockRouteOptions,
): Promise<MockRouteResult> {
  if (url === "/privacy/erasure-requests" && method === "POST") {
    const reason = text(data.reason);
    if (reason.length < 2 || reason.length > 300)
      throw new Error("注销原因长度必须为2-300个字符");
    const requestId = requireIdempotencyKey(
      data.idempotencyKey,
      "注销申请幂等键",
    );
    const requests = getDataErasureRequests();
    const commandHash = creationCommandHash({
      kind: "DATA_ERASURE_REQUEST",
      userId: mockUser().id,
      reason,
    });
    const replay = requests.find(
      (item) => item.requestIdempotencyKey === requestId,
    );
    if (replay) {
      if (
        replay.userId !== mockUser().id ||
        replay.requestCommandHash !== commandHash
      )
        throw new Error("注销申请幂等键已用于不同账号或命令");
      return {
        handled: true,
        value: ok(mockDataErasureRequestView(replay, "basic")),
      };
    }
    if (
      requests.some(
        (item) => item.userId === mockUser().id && item.status === "REQUESTED",
      )
    )
      throw new Error("已有待处理的注销申请，请勿重复提交");
    const users = getGovernanceUsers();
    const user = users.find((item) => item.id === mockUser().id);
    if (!user || user.status === "DELETED")
      throw new Error("账号不存在或已完成匿名化");
    const now = new Date().toISOString();
    const created = {
      id: newId("erasure"),
      userId: user.id,
      user: {
        id: user.id,
        displayName: user.displayName,
        phone: user.phone || null,
        status: user.status,
      },
      status: "REQUESTED",
      reason,
      requestIdempotencyKey: requestId,
      requestCommandHash: commandHash,
      decisionIdempotencyKey: null,
      decisionCommandHash: null,
      reviewedById: null,
      reviewedBy: null,
      reviewReason: null,
      requestedAt: now,
      reviewedAt: null,
      completedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    saveDataErasureRequests([created, ...requests]);
    saveAuditLogs([
      {
        id: newId("audit"),
        actorId: mockUser().id,
        actor: { id: mockUser().id, displayName: mockUser().displayName },
        actorRole: mockRoles()[0],
        action: "DATA_ERASURE_REQUESTED",
        objectType: "DataErasureRequest",
        objectId: created.id,
        reason,
        requestId,
        newValue: { userId: user.id, status: "REQUESTED", commandHash },
        result: "SUCCESS",
        createdAt: now,
      },
      ...getAuditLogs(),
    ]);
    return {
      handled: true,
      value: ok(mockDataErasureRequestView(created, "basic")),
    };
  }
  return { handled: false };
}

export async function handleErasureCancelPost(
  method: string,
  url: string,
  data: any,
  options: MockRouteOptions,
): Promise<MockRouteResult> {
  const erasureCancelMatch = url.match(
    /^\/privacy\/erasure-requests\/([^/]+)\/cancel$/,
  );
  if (erasureCancelMatch && method === "POST") {
    const requests = getDataErasureRequests();
    const request = requests.find((item) => item.id === erasureCancelMatch[1]);
    if (!request) throw new Error("注销申请不存在");
    if (request.userId !== mockUser().id)
      throw new Error("只能撤回本人的注销申请");
    const reason = text(data.reason);
    if (reason.length < 2 || reason.length > 300)
      throw new Error("处理原因长度必须为2-300个字符");
    const decisionId = requireIdempotencyKey(data.idempotencyKey, "处理幂等键");
    const commandHash = creationCommandHash({
      kind: "DATA_ERASURE_CANCEL",
      requestId: request.id,
      reason,
    });
    const replay = requests.find(
      (item) => item.decisionIdempotencyKey === decisionId,
    );
    if (replay) {
      if (
        replay.id !== request.id ||
        replay.reviewedById !== mockUser().id ||
        replay.decisionCommandHash !== commandHash ||
        replay.status !== "CANCELLED"
      )
        throw new Error("注销处理幂等键已用于不同申请、操作人或命令");
      return {
        handled: true,
        value: ok(mockDataErasureRequestView(replay, "basic")),
      };
    }
    if (request.status !== "REQUESTED")
      throw new Error("注销申请已进入终态，不能重复处理");
    const now = new Date().toISOString();
    Object.assign(request, {
      status: "CANCELLED",
      decisionIdempotencyKey: decisionId,
      decisionCommandHash: commandHash,
      reviewedById: mockUser().id,
      reviewedBy: { id: mockUser().id, displayName: mockUser().displayName },
      reviewReason: reason,
      reviewedAt: now,
      updatedAt: now,
    });
    saveDataErasureRequests(requests);
    saveAuditLogs([
      {
        id: newId("audit"),
        actorId: mockUser().id,
        actor: { id: mockUser().id, displayName: mockUser().displayName },
        actorRole: mockRoles()[0],
        action: "DATA_ERASURE_CANCELLED",
        objectType: "DataErasureRequest",
        objectId: request.id,
        oldValue: { status: "REQUESTED" },
        newValue: { status: "CANCELLED", commandHash },
        reason,
        requestId: decisionId,
        result: "SUCCESS",
        createdAt: now,
      },
      ...getAuditLogs(),
    ]);
    return {
      handled: true,
      value: ok(mockDataErasureRequestView(request, "basic")),
    };
  }
  return { handled: false };
}

export async function handlePrivacyErasureRequestsGet(
  method: string,
  url: string,
  data: any,
  options: MockRouteOptions,
): Promise<MockRouteResult> {
  if (url === "/privacy/erasure-requests" && method === "GET") {
    requireMockRole("ADMIN", "SUPER_ADMIN");
    const status = text(data.status);
    const items = getDataErasureRequests()
      .filter((item) => !status || item.status === status)
      .sort((left, right) =>
        String(left.requestedAt).localeCompare(String(right.requestedAt)),
      );
    return {
      handled: true,
      value: ok({
        items: items.map((item) => mockDataErasureRequestView(item, "admin")),
        total: items.length,
        page: 1,
        pageSize: 100,
      }),
    };
  }
  return { handled: false };
}

export async function handleErasureBlockersGet(
  method: string,
  url: string,
  data: any,
  options: MockRouteOptions,
): Promise<MockRouteResult> {
  const erasureBlockersMatch = url.match(
    /^\/privacy\/erasure-requests\/([^/]+)\/blockers$/,
  );
  if (erasureBlockersMatch && method === "GET") {
    requireMockRole("ADMIN", "SUPER_ADMIN");
    const request = getDataErasureRequests().find(
      (item) => item.id === erasureBlockersMatch[1],
    );
    if (!request) throw new Error("注销申请不存在");
    const user = getGovernanceUsers().find(
      (item) => item.id === request.userId,
    );
    if (!user || user.status === "DELETED")
      return { handled: true, value: ok([]) };
    const roles = [
      ...new Set([
        user.primaryRole,
        ...(user.roles || []).map((item: any) => item.role),
      ]),
    ];
    const blockers: any[] = [];
    if (user.status !== "DISABLED")
      blockers.push({
        code: "USER_MUST_BE_DISABLED",
        count: 1,
        message: "请先停用账号，确认其不能继续发起新业务",
      });
    if (roles.some((role) => role !== "MEMBER"))
      blockers.push({
        code: "STAFF_ROLES_ACTIVE",
        count: 1,
        message: "请先移交职责并撤销全部员工、主理人或商户角色",
      });
    if (
      request.userId === "user-member" &&
      (mockUser("MEMBER").accounts || []).some(
        (account) =>
          ["CASH_PRINCIPAL", "GIFT_BALANCE", "BADMINTON_COIN"].includes(
            account.type,
          ) && account.balance !== 0,
      )
    )
      blockers.push({
        code: "SPENDABLE_ACCOUNT_BALANCE",
        count: 1,
        message: "仍有本金、赠送余额、羽球币或冻结余额",
      });
    const activeOrders = getOrders().filter(
      (order) =>
        order.memberId === request.userId &&
        ["PENDING", "PAID", "CHECKED_IN", "REFUND_PENDING"].includes(
          order.status,
        ),
    ).length;
    if (activeOrders)
      blockers.push({
        code: "ACTIVE_ORDER",
        count: activeOrders,
        message: "仍有未完成订单或待履约订单",
      });
    const activeTraining = getEnrollments().filter(
      (item) =>
        item.buyerId === request.userId &&
        ["PENDING_PAYMENT", "ACTIVE", "PARTIALLY_REFUNDED"].includes(
          item.status,
        ),
    ).length;
    if (activeTraining)
      blockers.push({
        code: "ACTIVE_TRAINING",
        count: activeTraining,
        message: "仍有未结课、未退清的培训课包",
      });
    const claimedCoupons = getCoupons().filter(
      (coupon) =>
        coupon.holderId === request.userId && coupon.status === "CLAIMED",
    ).length;
    if (claimedCoupons)
      blockers.push({
        code: "CLAIMED_COUPON",
        count: claimedCoupons,
        message: "仍有已领取未核销的联盟券",
      });
    return { handled: true, value: ok(blockers) };
  }
  return { handled: false };
}

export async function handleErasureDecisionPost(
  method: string,
  url: string,
  data: any,
  options: MockRouteOptions,
): Promise<MockRouteResult> {
  const erasureDecisionMatch = url.match(
    /^\/privacy\/erasure-requests\/([^/]+)\/(reject|complete)$/,
  );
  if (erasureDecisionMatch && method === "POST") {
    requireMockRole("SUPER_ADMIN");
    const requests = getDataErasureRequests();
    const request = requests.find(
      (item) => item.id === erasureDecisionMatch[1],
    );
    if (!request) throw new Error("注销申请不存在");
    if (request.userId === mockUser().id)
      throw new Error("注销申请人与复核人不能是同一账号");
    const action = erasureDecisionMatch[2];
    const target = action === "complete" ? "COMPLETED" : "REJECTED";
    const reason = text(data.reason);
    if (reason.length < 2 || reason.length > 300)
      throw new Error("处理原因长度必须为2-300个字符");
    const decisionId = requireIdempotencyKey(data.idempotencyKey, "处理幂等键");
    const commandHash = creationCommandHash({
      kind: `DATA_ERASURE_${action === "complete" ? "COMPLETE" : "REJECT"}`,
      requestId: request.id,
      reason,
    });
    const replay = requests.find(
      (item) => item.decisionIdempotencyKey === decisionId,
    );
    if (replay) {
      if (
        replay.id !== request.id ||
        replay.reviewedById !== mockUser().id ||
        replay.decisionCommandHash !== commandHash ||
        replay.status !== target
      )
        throw new Error("注销处理幂等键已用于不同申请、操作人或命令");
      return {
        handled: true,
        value: ok(mockDataErasureRequestView(replay, "basic")),
      };
    }
    if (request.status !== "REQUESTED")
      throw new Error("注销申请已进入终态，不能重复处理");
    if (action === "complete") {
      const users = getGovernanceUsers();
      const user = users.find((item) => item.id === request.userId);
      if (!user) throw new Error("待匿名化账号不存在");
      const roles = [
        ...new Set([
          user.primaryRole,
          ...(user.roles || []).map((item: any) => item.role),
        ]),
      ];
      const blocked =
        user.status !== "DISABLED" ||
        roles.some((role) => role !== "MEMBER") ||
        request.userId === "user-member";
      if (blocked) throw new Error("账号仍有未完成业务，暂不能匿名化");
      user.displayName = `已注销用户-${String(user.id).slice(-6)}`;
      user.phone = null;
      user.status = "DELETED";
      user.primaryRole = "MEMBER";
      user.roles = [{ role: "MEMBER", merchantId: null }];
      user.wechatBound = false;
      user.updatedAt = new Date().toISOString();
      saveGovernanceUsers(users);
      request.user = {
        id: user.id,
        displayName: user.displayName,
        phone: null,
        status: "DELETED",
      };
    }
    const now = new Date().toISOString();
    Object.assign(request, {
      status: target,
      decisionIdempotencyKey: decisionId,
      decisionCommandHash: commandHash,
      reviewedById: mockUser().id,
      reviewedBy: { id: mockUser().id, displayName: mockUser().displayName },
      reviewReason: reason,
      reviewedAt: now,
      completedAt: target === "COMPLETED" ? now : null,
      updatedAt: now,
    });
    saveDataErasureRequests(requests);
    saveAuditLogs([
      {
        id: newId("audit"),
        actorId: mockUser().id,
        actor: { id: mockUser().id, displayName: mockUser().displayName },
        actorRole: "SUPER_ADMIN",
        action: `DATA_ERASURE_${target}`,
        objectType: "DataErasureRequest",
        objectId: request.id,
        oldValue: { status: "REQUESTED" },
        newValue: {
          status: target,
          userId: request.userId,
          personalIdentifiersRemoved: target === "COMPLETED",
          commandHash,
        },
        reason,
        requestId: decisionId,
        result: "SUCCESS",
        createdAt: now,
      },
      ...getAuditLogs(),
    ]);
    return {
      handled: true,
      value: ok(mockDataErasureRequestView(request, "basic")),
    };
  }
  return { handled: false };
}
