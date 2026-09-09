import { mockUser } from "../../core";
import {
  getCoupons,
  getCouponTemplates,
  getMerchants,
  getAuditLogs,
  saveCoupons,
  saveCouponTemplates,
  saveAuditLogs,
} from "../../state";
import {
  ok,
  mockRoles,
  hasMockRole,
  requireMockRole,
  text,
  integer,
  isExpired,
  requireIdempotencyKey,
  newId,
  creationCommandHash,
} from "../../policies/common.js";
import {
  templateDirectoryIsScoped,
  merchantCanManage,
} from "../../policies/alliance.js";
import type { MockRouteResult, MockRouteOptions } from "../route-contract.js";

export async function handleAllianceCouponTemplatesGet(
  method: string,
  url: string,
  data: any,
  options: MockRouteOptions,
): Promise<MockRouteResult> {
  if (url === "/alliance/coupon-templates" && method === "GET") {
    requireMockRole("MERCHANT", "ADMIN", "SUPER_ADMIN");
    const templates = templateDirectoryIsScoped()
      ? getCouponTemplates().filter(
          (item) => item.merchantId === "merchant-coffee",
        )
      : getCouponTemplates();
    return {
      handled: true,
      value: ok(
        templates
          .map((item: any) => ({
            ...item,
            merchant:
              item.merchant ||
              getMerchants().find(
                (merchant) => merchant.id === item.merchantId,
              ),
          }))
          .sort(
            (left: any, right: any) =>
              Number(Boolean(right.enabled)) - Number(Boolean(left.enabled)) ||
              new Date(right.validTo).getTime() -
                new Date(left.validTo).getTime(),
          ),
      ),
    };
  }
  return { handled: false };
}

export async function handleAllianceCouponTemplatesPost(
  method: string,
  url: string,
  data: any,
  options: MockRouteOptions,
): Promise<MockRouteResult> {
  if (url === "/alliance/coupon-templates" && method === "POST") {
    requireMockRole("ADMIN", "SUPER_ADMIN");
    const merchantId = text(data.merchantId);
    const merchant = getMerchants().find((item) => item.id === merchantId);
    if (!merchant) throw new Error("商户不存在");
    if (merchant.status && merchant.status !== "ACTIVE")
      throw new Error("停用商户不能创建券模板");
    const code = text(data.code).toUpperCase();
    const name = text(data.name);
    const activityName = text(data.activityName);
    const benefitDescription = text(data.benefitDescription);
    if (
      code.length < 2 ||
      name.length < 2 ||
      activityName.length < 2 ||
      benefitDescription.length < 2
    )
      throw new Error("券模板编码、名称、活动和权益说明至少需要2个字符");
    if (
      getCouponTemplates().some(
        (item) => text(item.code).toUpperCase() === code,
      )
    )
      throw new Error("券模板编码已存在");
    const validFrom = new Date(String(data.validFrom || ""));
    const validTo = new Date(String(data.validTo || ""));
    if (
      Number.isNaN(validFrom.getTime()) ||
      Number.isNaN(validTo.getTime()) ||
      validTo <= validFrom
    )
      throw new Error("券有效期设置无效");
    const faceValueCents = integer(data.faceValueCents ?? 0);
    const claimLimitPerUser = integer(data.claimLimitPerUser ?? 1);
    const issueLimit =
      integer(data.issueLimit) && Number(data.issueLimit) > 0
        ? Number(data.issueLimit)
        : NaN;
    if (faceValueCents < 0) throw new Error("券面值不能为负数");
    if (claimLimitPerUser < 1 || claimLimitPerUser > 100)
      throw new Error("每人领取上限必须为1-100");
    if (issueLimit < 1 || issueLimit > 100000)
      throw new Error("发行上限必须为1-100000");
    const template = {
      ...data,
      id: newId("coupon-template"),
      code,
      name,
      activityName,
      benefitDescription,
      merchantId,
      merchant,
      enabled: data.enabled !== false,
      validFrom: validFrom.toISOString(),
      validTo: validTo.toISOString(),
      faceValueCents,
      claimLimitPerUser,
      issueLimit,
      issuedCount: 0,
      claimedCount: 0,
      redeemedCount: 0,
    };
    saveCouponTemplates([template, ...getCouponTemplates()]);
    return { handled: true, value: ok(template) };
  }
  return { handled: false };
}

export async function handleTemplateStatusPost(
  method: string,
  url: string,
  data: any,
  options: MockRouteOptions,
): Promise<MockRouteResult> {
  const templateStatusMatch = url.match(
    /^\/alliance\/coupon-templates\/([^/]+)\/status$/,
  );
  if (templateStatusMatch && method === "POST") {
    requireMockRole("ADMIN", "SUPER_ADMIN");
    if (typeof data.enabled !== "boolean")
      throw new Error("券模板启停状态无效");
    const enabled = data.enabled;
    const reason = text(data.reason);
    const requestId = requireIdempotencyKey(
      data.idempotencyKey,
      "券模板状态幂等键",
    );
    if (reason.length < 2 || reason.length > 300)
      throw new Error("状态变更原因需要2-300个字符");
    const templates = getCouponTemplates();
    const template = templates.find(
      (item) => item.id === templateStatusMatch[1],
    );
    if (!template) throw new Error("券模板不存在");
    const merchant = getMerchants().find(
      (item) => item.id === template.merchantId,
    );
    const action = "ALLIANCE_COUPON_TEMPLATE_STATUS_SET";
    const commandSignature = JSON.stringify({
      action,
      templateId: template.id,
      enabled,
      allowVenueBooking: data.allowVenueBooking,
      reason,
    });
    const replay = getAuditLogs().find((item) => item.requestId === requestId);
    if (replay) {
      if (
        replay.actorId !== mockUser().id ||
        replay.action !== action ||
        replay.objectType !== "CouponTemplate" ||
        replay.objectId !== template.id ||
        replay.newValue?.commandSignature !== commandSignature
      )
        throw new Error("幂等键已用于其他联盟状态操作");
      return { handled: true, value: ok(template) };
    }
    if (enabled && merchant?.status && merchant.status !== "ACTIVE")
      throw new Error("停用商户的券模板不能启用");
    const oldEnabled = template.enabled !== false;
    template.enabled = enabled;
    if (data.allowVenueBooking !== undefined) {
      if (typeof data.allowVenueBooking !== "boolean")
        throw new Error("适用范围无效");
      template.allowVenueBooking = data.allowVenueBooking;
    }
    template.updatedAt = new Date().toISOString();
    saveCouponTemplates(templates);
    saveAuditLogs([
      {
        id: newId("audit"),
        actorId: mockUser().id,
        actor: { id: mockUser().id, displayName: mockUser().displayName },
        actorRole: hasMockRole("SUPER_ADMIN") ? "SUPER_ADMIN" : "ADMIN",
        action,
        objectType: "CouponTemplate",
        objectId: template.id,
        oldValue: { enabled: oldEnabled },
        newValue: { enabled, commandSignature },
        reason,
        requestId,
        result: "SUCCESS",
        createdAt: template.updatedAt,
      },
      ...getAuditLogs(),
    ]);
    return { handled: true, value: ok(template) };
  }
  return { handled: false };
}

export async function handleGenerateCodesPost(
  method: string,
  url: string,
  data: any,
  options: MockRouteOptions,
): Promise<MockRouteResult> {
  const generateCodesMatch = url.match(
    /^\/alliance\/coupon-templates\/([^/]+)\/codes$/,
  );
  if (generateCodesMatch && method === "POST") {
    requireMockRole("MERCHANT", "ADMIN", "SUPER_ADMIN");
    const templates = getCouponTemplates();
    const template = templates.find(
      (item) => item.id === generateCodesMatch[1],
    );
    if (!template) throw new Error("券模板不存在");
    if (!merchantCanManage(template.merchantId))
      throw new Error("只能操作本商户的券码");
    const requested = integer(data.quantity ?? data.count);
    if (!Number.isInteger(requested) || requested < 1 || requested > 2000)
      throw new Error("生成数量必须为1-2000");
    const requestId = requireIdempotencyKey(
      data.idempotencyKey,
      "批量发券幂等键",
    );
    const action = "COUPON_CODES_GENERATED";
    const commandHash = creationCommandHash({
      kind: action,
      templateId: template.id,
      count: requested,
    });
    const replay = getAuditLogs().find((item) => item.requestId === requestId);
    if (replay) {
      if (
        replay.actorId !== mockUser().id ||
        replay.action !== action ||
        replay.objectType !== "CouponTemplate" ||
        replay.objectId !== template.id ||
        replay.newValue?.commandHash !== commandHash
      )
        throw new Error("幂等键已用于其他联盟操作");
      const replayCodes = Array.isArray(replay.newValue?.codes)
        ? replay.newValue.codes.filter(
            (code: unknown) => typeof code === "string",
          )
        : [];
      if (replayCodes.length !== requested)
        throw new Error("发行命令回放数据不完整，请联系管理员");
      return {
        handled: true,
        value: ok({
          templateId: template.id,
          generated: requested,
          count: requested,
          codes: replayCodes,
        }),
      };
    }
    if (template.enabled === false) throw new Error("券模板不存在或已下线");
    const templateMerchant = getMerchants().find(
      (item) => item.id === template.merchantId,
    );
    if (templateMerchant?.status && templateMerchant.status !== "ACTIVE")
      throw new Error("商户已停用");
    if (isExpired(template.validTo)) throw new Error("券模板已过期");
    if (
      Number(template.issuedCount || 0) + requested >
      Number(template.issueLimit || 2000)
    )
      throw new Error("生成数量超过模板发行上限");
    const existingCodes = new Set(getCoupons().map((item) => item.code));
    const batchToken = creationCommandHash({ requestId }).toUpperCase();
    const generated = Array.from({ length: requested }, (_, index) => {
      const code = `YQ-${batchToken}-${String(index + 1).padStart(4, "0")}`;
      if (existingCodes.has(code))
        throw new Error("发行命令与已有券码冲突，请刷新后重试");
      existingCodes.add(code);
      return {
        id: newId("coupon"),
        code,
        status: "ISSUED",
        templateId: template.id,
        merchantId: template.merchantId,
        expiresAt: template.validTo,
        template: {
          ...template,
          merchant:
            template.merchant ||
            getMerchants().find((item) => item.id === template.merchantId),
        },
      };
    });
    template.issuedCount = Number(template.issuedCount || 0) + requested;
    saveCouponTemplates(templates);
    saveCoupons([...generated, ...getCoupons()]);
    const generatedCodes = generated.map((item) => item.code);
    saveAuditLogs([
      {
        id: newId("audit"),
        actorId: mockUser().id,
        actor: { id: mockUser().id, displayName: mockUser().displayName },
        actorRole: mockRoles()[0],
        action,
        objectType: "CouponTemplate",
        objectId: template.id,
        oldValue: { issuedCount: Number(template.issuedCount) - requested },
        newValue: { commandHash, count: requested, codes: generatedCodes },
        requestId,
        result: "SUCCESS",
        createdAt: new Date().toISOString(),
      },
      ...getAuditLogs(),
    ]);
    return {
      handled: true,
      value: ok({
        templateId: template.id,
        generated: requested,
        count: requested,
        codes: generatedCodes,
      }),
    };
  }
  return { handled: false };
}
