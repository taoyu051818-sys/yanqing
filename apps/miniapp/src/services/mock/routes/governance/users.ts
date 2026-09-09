import { mockUser } from "../../core";
import {
  getMerchants,
  getGovernanceUsers,
  getAuditLogs,
  saveGovernanceUsers,
  saveAuditLogs,
} from "../../state";
import {
  ok,
  requireMockRole,
  text,
  requireIdempotencyKey,
  newId,
  creationCommandHash,
} from "../../policies/common.js";
import type { MockRouteResult, MockRouteOptions } from "../route-contract.js";

export async function handleGovernanceUsersGet(
  method: string,
  url: string,
  data: any,
  options: MockRouteOptions,
): Promise<MockRouteResult> {
  if (url === "/governance/users" && method === "GET") {
    requireMockRole("ADMIN", "SUPER_ADMIN");
    const keyword = text(data.keyword).toLowerCase();
    const role = text(data.role);
    const status = text(data.status);
    const items = getGovernanceUsers().filter(
      (item) =>
        (!keyword ||
          `${item.displayName} ${item.phone || ""}`
            .toLowerCase()
            .includes(keyword)) &&
        (!status || item.status === status) &&
        (!role ||
          item.primaryRole === role ||
          item.roles?.some((entry: any) => entry.role === role)),
    );
    return {
      handled: true,
      value: ok({ items, total: items.length, page: 1, pageSize: 100 }),
    };
  }
  return { handled: false };
}

export async function handleGovernanceRolesPost(
  method: string,
  url: string,
  data: any,
  options: MockRouteOptions,
): Promise<MockRouteResult> {
  const governanceRolesMatch = url.match(
    /^\/governance\/users\/([^/]+)\/roles$/,
  );
  if (governanceRolesMatch && method === "POST") {
    requireMockRole("SUPER_ADMIN");
    const users = getGovernanceUsers();
    const user = users.find((item) => item.id === governanceRolesMatch[1]);
    if (!user) throw new Error("用户不存在");
    const roles = [
      ...new Set((Array.isArray(data.roles) ? data.roles : []).map(text)),
    ].sort();
    const primaryRole = text(data.primaryRole);
    const reason = text(data.reason);
    if (!roles.length || !roles.includes(primaryRole))
      throw new Error("主角色必须包含在角色集合中");
    if (reason.length < 2) throw new Error("请填写角色变更原因");
    if (user.id === mockUser().id && !roles.includes("SUPER_ADMIN"))
      throw new Error("超级管理员不能移除自己的超级管理员角色");
    const merchantId = text(data.merchantId);
    if (roles.includes("MERCHANT") && !merchantId)
      throw new Error("商户角色必须关联商户");
    if (!roles.includes("MERCHANT") && merchantId)
      throw new Error("仅商户角色可以关联商户");
    const requestId = data.idempotencyKey
      ? requireIdempotencyKey(data.idempotencyKey, "治理角色幂等键")
      : "";
    const action = "USER_ROLES_SET";
    const commandHash = creationCommandHash({
      kind: action,
      userId: user.id,
      primaryRole,
      roles,
      merchantId: merchantId || null,
      reason,
    });
    const replay = requestId
      ? getAuditLogs().find((item) => item.requestId === requestId)
      : null;
    if (replay) {
      if (
        replay.actorId !== mockUser().id ||
        replay.action !== action ||
        replay.objectType !== "User" ||
        replay.objectId !== user.id ||
        replay.newValue?.commandHash !== commandHash
      )
        throw new Error("治理操作幂等键已用于不同命令");
      return { handled: true, value: ok(user) };
    }
    if (user.status !== "ACTIVE") throw new Error("停用用户不能配置角色");
    const merchant = merchantId
      ? getMerchants().find((item) => item.id === merchantId)
      : null;
    if (
      merchantId &&
      (!merchant || (merchant.status && merchant.status !== "ACTIVE"))
    )
      throw new Error("有效商户不存在");
    const oldValue = { primaryRole: user.primaryRole, roles: user.roles };
    const nextRoles = roles.map((role) => ({
      role,
      merchantId: role === "MERCHANT" ? merchantId : null,
      ...(role === "MERCHANT" ? { merchant } : {}),
    }));
    const unchanged =
      user.primaryRole === primaryRole &&
      JSON.stringify(user.roles) === JSON.stringify(nextRoles);
    if (!unchanged) {
      user.primaryRole = primaryRole;
      user.roles = nextRoles;
      user.updatedAt = new Date().toISOString();
      saveGovernanceUsers(users);
    }
    if (!unchanged || requestId) {
      const createdAt = user.updatedAt || new Date().toISOString();
      saveAuditLogs([
        {
          id: newId("audit"),
          actorId: mockUser().id,
          actor: { id: mockUser().id, displayName: mockUser().displayName },
          actorRole: "SUPER_ADMIN",
          action,
          objectType: "User",
          objectId: user.id,
          oldValue,
          newValue: { primaryRole, roles: nextRoles, commandHash },
          reason,
          ...(requestId ? { requestId } : {}),
          result: "SUCCESS",
          createdAt,
        },
        ...getAuditLogs(),
      ]);
    }
    return { handled: true, value: ok(user) };
  }
  return { handled: false };
}

export async function handleGovernanceStatusPost(
  method: string,
  url: string,
  data: any,
  options: MockRouteOptions,
): Promise<MockRouteResult> {
  const governanceStatusMatch = url.match(
    /^\/governance\/users\/([^/]+)\/status$/,
  );
  if (governanceStatusMatch && method === "POST") {
    requireMockRole("SUPER_ADMIN");
    const users = getGovernanceUsers();
    const user = users.find((item) => item.id === governanceStatusMatch[1]);
    if (!user) throw new Error("用户不存在");
    const status = text(data.status);
    const reason = text(data.reason);
    if (!["ACTIVE", "DISABLED"].includes(status))
      throw new Error("用户状态无效");
    if (reason.length < 2) throw new Error("请填写状态变更原因");
    if (user.id === mockUser().id && status !== "ACTIVE")
      throw new Error("不能停用当前登录的超级管理员");
    if (user.status === status) return { handled: true, value: ok(user) };
    const oldStatus = user.status;
    user.status = status;
    user.updatedAt = new Date().toISOString();
    saveGovernanceUsers(users);
    saveAuditLogs([
      {
        id: newId("audit"),
        actorId: mockUser().id,
        actor: { id: mockUser().id, displayName: mockUser().displayName },
        actorRole: "SUPER_ADMIN",
        action: "USER_STATUS_SET",
        objectType: "User",
        objectId: user.id,
        oldValue: { status: oldStatus },
        newValue: { status },
        reason,
        result: "SUCCESS",
        createdAt: user.updatedAt,
      },
      ...getAuditLogs(),
    ]);
    return { handled: true, value: ok(user) };
  }
  return { handled: false };
}
