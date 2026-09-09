import { mockUser } from "../../core";
import {
  getMerchants,
  getAuditLogs,
  saveMerchants,
  saveAuditLogs,
} from "../../state";
import {
  ok,
  mockRoles,
  hasMockRole,
  requireMockRole,
  text,
  requireIdempotencyKey,
  newId,
} from "../../policies/common.js";
import { merchantDirectoryIsScoped } from "../../policies/alliance.js";
import type { MockRouteResult, MockRouteOptions } from "../route-contract.js";

export async function handleAllianceMerchantsPost(
  method: string,
  url: string,
  data: any,
  options: MockRouteOptions,
): Promise<MockRouteResult> {
  if (url === "/alliance/merchants" && method === "POST") {
    requireMockRole("ADMIN", "SUPER_ADMIN");
    const code = text(data.code).toUpperCase();
    const name = text(data.name);
    const category = text(data.category);
    const level = text(data.level);
    if (code.length < 2 || name.length < 2 || category.length < 2)
      throw new Error("商户编码、名称和分类至少需要2个字符");
    if (!["TRAFFIC_PARTNER", "MEMBER_BENEFIT", "SPONSOR"].includes(level))
      throw new Error("商户等级无效");
    if (getMerchants().some((item) => text(item.code).toUpperCase() === code))
      throw new Error("商户编码已存在");
    if (!data.settlementRule || typeof data.settlementRule !== "object")
      throw new Error("商户结算规则不能为空");
    const merchant = {
      ...data,
      id: newId("merchant"),
      code,
      name,
      category,
      level,
      status: "ACTIVE",
      _count: { couponTemplates: 0, couponRedemptions: 0 },
      createdAt: new Date().toISOString(),
    };
    saveMerchants([merchant, ...getMerchants()]);
    return { handled: true, value: ok(merchant) };
  }
  return { handled: false };
}

export async function handleMerchantStatusPost(
  method: string,
  url: string,
  data: any,
  options: MockRouteOptions,
): Promise<MockRouteResult> {
  const merchantStatusMatch = url.match(
    /^\/alliance\/merchants\/([^/]+)\/status$/,
  );
  if (merchantStatusMatch && method === "POST") {
    requireMockRole("ADMIN", "SUPER_ADMIN");
    const status = text(data.status);
    const reason = text(data.reason);
    const requestId = requireIdempotencyKey(
      data.idempotencyKey,
      "商户状态幂等键",
    );
    if (!["ACTIVE", "DISABLED"].includes(status))
      throw new Error("商户仅允许启用或停用，不允许删除");
    if (reason.length < 2 || reason.length > 300)
      throw new Error("状态变更原因需要2-300个字符");
    const merchants = getMerchants();
    const merchant = merchants.find(
      (item) => item.id === merchantStatusMatch[1],
    );
    if (!merchant) throw new Error("商户不存在");
    if (!["ACTIVE", "DISABLED"].includes(merchant.status || "ACTIVE"))
      throw new Error("已删除商户不能重新启用或停用");
    const action = "ALLIANCE_MERCHANT_STATUS_SET";
    const commandSignature = JSON.stringify({
      action,
      merchantId: merchant.id,
      status,
      reason,
    });
    const replay = getAuditLogs().find((item) => item.requestId === requestId);
    if (replay) {
      if (
        replay.actorId !== mockUser().id ||
        replay.action !== action ||
        replay.objectType !== "Merchant" ||
        replay.objectId !== merchant.id ||
        replay.newValue?.commandSignature !== commandSignature
      )
        throw new Error("幂等键已用于其他联盟状态操作");
      return { handled: true, value: ok(merchant) };
    }
    const oldStatus = merchant.status || "ACTIVE";
    merchant.status = status;
    merchant.updatedAt = new Date().toISOString();
    saveMerchants(merchants);
    saveAuditLogs([
      {
        id: newId("audit"),
        actorId: mockUser().id,
        actor: { id: mockUser().id, displayName: mockUser().displayName },
        actorRole: hasMockRole("SUPER_ADMIN") ? "SUPER_ADMIN" : "ADMIN",
        action,
        objectType: "Merchant",
        objectId: merchant.id,
        oldValue: { status: oldStatus },
        newValue: { status, commandSignature },
        reason,
        requestId,
        result: "SUCCESS",
        createdAt: merchant.updatedAt,
      },
      ...getAuditLogs(),
    ]);
    return { handled: true, value: ok(merchant) };
  }
  return { handled: false };
}

export async function handleAllianceMerchantsAny(
  method: string,
  url: string,
  data: any,
  options: MockRouteOptions,
): Promise<MockRouteResult> {
  if (url === "/alliance/merchants") {
    // Merchant accounts are scoped to their assigned merchant.  Other
    // internal roles may use the full directory for operations and finance;
    // members only need the public partner catalogue.
    const roles = mockRoles();
    const visible = getMerchants().filter((merchant) =>
      merchantDirectoryIsScoped()
        ? merchant.id === "merchant-coffee"
        : !merchant.status ||
          merchant.status === "ACTIVE" ||
          roles.some((role) =>
            ["ADMIN", "SUPER_ADMIN", "FINANCE"].includes(role),
          ),
    );
    const full = roles.some((role) =>
      ["ADMIN", "SUPER_ADMIN", "FINANCE"].includes(role),
    );
    return {
      handled: true,
      value: ok(
        full
          ? visible
          : visible.map((merchant) => {
              const { phone, contactName, settlementRule, ...catalogue } =
                merchant;
              return catalogue;
            }),
      ),
    };
  }
  return { handled: false };
}
