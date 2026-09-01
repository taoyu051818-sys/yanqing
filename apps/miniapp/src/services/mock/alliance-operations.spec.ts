import { beforeEach, describe, expect, it, vi } from "vitest";

import { mockRequest } from "./router";
import { getAuditLogs, resetCatalogState } from "./state";
import { getOrders } from "./venue";

const storage = new Map<string, unknown>();

vi.stubGlobal("uni", {
  getStorageSync: (key: string) => storage.get(key) ?? "",
  setStorageSync: (key: string, value: unknown) => storage.set(key, value),
  removeStorageSync: (key: string) => storage.delete(key),
});

const login = (role: string) =>
  mockRequest<any>("POST", "/auth/dev-login", { role });
const request = <T = any>(
  method: string,
  url: string,
  data: Record<string, unknown> = {},
) => mockRequest<T>(method, url, data);

const period = (offsetDays: number) => ({
  periodStart: new Date(Date.now() + offsetDays * 86_400_000).toISOString(),
  periodEnd: new Date(Date.now() + (offsetDays + 1) * 86_400_000).toISOString(),
});

describe("miniapp mock alliance operations", () => {
  beforeEach(async () => {
    storage.clear();
    resetCatalogState();
    await login("ADMIN");
  });

  it("creates a merchant and campaign, then issues unique codes with validation", async () => {
    const merchant = await request("POST", "/alliance/merchants", {
      code: "CAFE-NEW",
      name: "新城咖啡",
      category: "餐饮",
      level: "MEMBER_BENEFIT",
      settlementRule: { mode: "PER_REDEMPTION", amountCents: 1000 },
    });
    expect(merchant).toMatchObject({ code: "CAFE-NEW", status: "ACTIVE" });

    await expect(
      request("POST", "/alliance/merchants", {
        code: "CAFE-NEW",
        name: "重复咖啡",
        category: "餐饮",
        level: "MEMBER_BENEFIT",
        settlementRule: { mode: "FIXED", amountCents: 1000 },
      }),
    ).rejects.toThrow("商户编码已存在");

    const template = await request("POST", "/alliance/coupon-templates", {
      code: "CAFE-AUTUMN",
      merchantId: merchant.id,
      name: "秋季咖啡券",
      activityName: "秋季联盟",
      benefitDescription: "会员咖啡立减20元",
      faceValueCents: 2000,
      validFrom: new Date(Date.now() - 86_400_000).toISOString(),
      validTo: new Date(Date.now() + 30 * 86_400_000).toISOString(),
      claimLimitPerUser: 1,
      issueLimit: 3,
    });
    expect(template).toMatchObject({ merchantId: merchant.id, issuedCount: 0 });

    const issued = await request(
      "POST",
      `/alliance/coupon-templates/${template.id}/codes`,
      { count: 3, idempotencyKey: "coupon-batch-create-1" },
    );
    expect(issued.codes).toHaveLength(3);
    expect(new Set(issued.codes).size).toBe(3);
    await expect(request(
      "POST",
      `/alliance/coupon-templates/${template.id}/codes`,
      { count: 3, idempotencyKey: "coupon-batch-create-1" },
    )).resolves.toEqual(issued);
    expect(getAuditLogs().filter(
      (item) => item.requestId === "coupon-batch-create-1",
    )).toHaveLength(1);
    await expect(request(
      "POST",
      `/alliance/coupon-templates/${template.id}/codes`,
      { count: 2, idempotencyKey: "coupon-batch-create-1" },
    )).rejects.toThrow("幂等键已用于其他联盟操作");
    await expect(
      request("POST", `/alliance/coupon-templates/${template.id}/codes`, {
        count: 1,
        idempotencyKey: "coupon-batch-over-limit-1",
      }),
    ).rejects.toThrow("生成数量超过模板发行上限");

    const templates = await request<any[]>(
      "GET",
      "/alliance/coupon-templates",
    );
    expect(templates.find((item) => item.id === template.id)).toMatchObject({
      issuedCount: 3,
      merchant: { id: merchant.id },
    });
  });

  it("enforces the one-time seven-day non-prime newcomer experience and redacts member coupon data", async () => {
    const merchant = await request("POST", "/alliance/merchants", {
      code: "VENUE-SELF",
      name: "金羽球馆",
      category: "本馆权益",
      level: "TRAFFIC_PARTNER",
      contactName: "运营负责人",
      contactPhone: "13800009999",
      settlementRule: { mode: "NONE", internal: true },
    });
    const createTemplate = (code: string) => request("POST", "/alliance/coupon-templates", {
      code,
      merchantId: merchant.id,
      name: "新客体验场",
      activityName: "新客首次到店",
      benefitDescription: "领取后7天内限非黄金时段使用",
      faceValueCents: 0,
      validFrom: new Date(Date.now() - 86_400_000).toISOString(),
      validTo: new Date(Date.now() + 30 * 86_400_000).toISOString(),
      claimLimitPerUser: 1,
      issueLimit: 10,
    });
    const firstTemplate = await createTemplate("NEWCOMER-COURT-V1");
    const firstBatch = await request(
      "POST",
      `/alliance/coupon-templates/${firstTemplate.id}/codes`,
      { count: 1, idempotencyKey: "newcomer-batch-first-1" },
    );

    await login("MEMBER");
    const beforeClaim = Date.now();
    const claimed = await request(
      "POST",
      `/alliance/coupons/${firstBatch.codes[0]}/claim`,
    );
    expect(new Date(claimed.expiresAt).getTime()).toBeGreaterThanOrEqual(
      beforeClaim + 7 * 86_400_000 - 1_000,
    );
    expect(new Date(claimed.expiresAt).getTime()).toBeLessThanOrEqual(
      Date.now() + 7 * 86_400_000 + 1_000,
    );
    expect(getAuditLogs().filter(
      (item) => item.action === "ALLIANCE_COUPON_CLAIMED" && item.objectId === claimed.id,
    )).toHaveLength(1);

    const mine = await request<any[]>("GET", "/alliance/coupons/me");
    const myCoupon = mine.find((item) => item.id === claimed.id);
    expect(myCoupon.template.merchant).toMatchObject({ id: merchant.id, name: "金羽球馆" });
    expect(JSON.stringify(myCoupon)).not.toContain("13800009999");
    expect(myCoupon.template.merchant).not.toHaveProperty("settlementRule");

    const bookingDate = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
    await expect(request("POST", "/venues/bookings", {
      date: bookingDate,
      courtId: "court-1",
      slotId: "slot-7",
      sourceChannel: "NEWCOMER_COUPON",
      couponCode: claimed.code,
      creationIdempotencyKey: "newcomer-prime-denied-1",
    })).rejects.toThrow("新客体验权益仅限非黄金时段使用");
    const experienceOrder = await request("POST", "/venues/bookings", {
      date: bookingDate,
      courtId: "court-1",
      slotId: "slot-1",
      sourceChannel: "NEWCOMER_COUPON",
      couponCode: claimed.code,
      creationIdempotencyKey: "newcomer-daytime-order-1",
    });
    expect(experienceOrder).toMatchObject({ payableCents: 4_800, discountCents: 2_000 });
    expect(experienceOrder).not.toHaveProperty("parameterSnapshot");
    const persistedExperienceOrder = getOrders().find(
      (order) => order.id === experienceOrder.id,
    );
    expect(persistedExperienceOrder?.parameterSnapshot.newcomerPolicy).toMatchObject({
      allowedPeriodsParameterId: "parameter-newcomer-periods",
      slotPeriod: "EARLY",
    });

    await login("ADMIN");
    const secondTemplate = await createTemplate("NEWCOMER-COURT-V2");
    const secondBatch = await request(
      "POST",
      `/alliance/coupon-templates/${secondTemplate.id}/codes`,
      { count: 1, idempotencyKey: "newcomer-batch-second-1" },
    );
    await login("MEMBER");
    await expect(request(
      "POST",
      `/alliance/coupons/${secondBatch.codes[0]}/claim`,
    )).rejects.toThrow("新客体验权益每人仅限一次");
  });

  it("lets a merchant confirm or dispute only its own pending settlements", async () => {
    const outdoorDraft = await request("POST", "/alliance/settlements", {
      merchantId: "merchant-outdoor",
      ...period(40),
      attributedGrossProfitCents: 5000,
    });
    await request(
      "POST",
      `/alliance/settlements/${outdoorDraft.id}/submit`,
    );

    const coffeeDraft = await request("POST", "/alliance/settlements", {
      merchantId: "merchant-coffee",
      ...period(42),
      attributedGrossProfitCents: 6000,
    });
    await request("POST", `/alliance/settlements/${coffeeDraft.id}/submit`);

    await login("MERCHANT");
    const merchants = await request<any[]>("GET", "/alliance/merchants");
    expect(merchants.map((item) => item.id)).toEqual(["merchant-coffee"]);
    const visible = await request<any[]>("GET", "/alliance/settlements");
    expect(visible.every((item) => item.merchantId === "merchant-coffee")).toBe(
      true,
    );
    await expect(
      request(
        "POST",
        `/alliance/settlements/${outdoorDraft.id}/confirm`,
      ),
    ).rejects.toThrow("只能操作本商户的结算单");

    await expect(
      request(
        "POST",
        `/alliance/settlements/${coffeeDraft.id}/dispute`,
        { reason: "" },
      ),
    ).rejects.toThrow("提出争议必须填写原因");
    const disputed = await request(
      "POST",
      `/alliance/settlements/${coffeeDraft.id}/dispute`,
      { reason: "核销归因金额需要复核" },
    );
    expect(disputed).toMatchObject({ status: "DRAFT" });
    expect(disputed.detail.workflowHistory.at(-1)).toMatchObject({
      action: "dispute",
      reason: "核销归因金额需要复核",
    });
    expect(JSON.stringify({ outdoorDraft, coffeeDraft, visible, disputed })).not.toMatch(
      /codeIds|settlementRule|actorId/,
    );

    await login("ADMIN");
    await request("POST", `/alliance/settlements/${coffeeDraft.id}/submit`);
    await login("MERCHANT");
    const confirmed = await request(
      "POST",
      `/alliance/settlements/${coffeeDraft.id}/confirm`,
    );
    expect(confirmed).toMatchObject({ status: "CONFIRMED" });
  });

  it("allows a merchant to issue only templates assigned to its merchant", async () => {
    const outdoorTemplate = await request(
      "POST",
      "/alliance/coupon-templates",
      {
        code: "OUTDOOR-ONLY",
        merchantId: "merchant-outdoor",
        name: "户外专属券",
        activityName: "联盟户外季",
        benefitDescription: "户外用品会员权益",
        faceValueCents: 1000,
        validFrom: new Date(Date.now() - 86_400_000).toISOString(),
        validTo: new Date(Date.now() + 30 * 86_400_000).toISOString(),
        claimLimitPerUser: 1,
        issueLimit: 10,
      },
    );

    await login("MERCHANT");
    const templates = await request<any[]>(
      "GET",
      "/alliance/coupon-templates",
    );
    expect(templates.every((item) => item.merchantId === "merchant-coffee")).toBe(
      true,
    );
    await expect(
      request(
        "POST",
        `/alliance/coupon-templates/${outdoorTemplate.id}/codes`,
        { count: 1, idempotencyKey: "coupon-batch-outdoor-denied" },
      ),
    ).rejects.toThrow("只能操作本商户的券码");
  });

  it("requires an open venue shift for front-desk redemption but not for a merchant till", async () => {
    const template = await request("POST", "/alliance/coupon-templates", {
      code: "COFFEE-SHIFT-GATE",
      merchantId: "merchant-coffee",
      name: "核销班次验收券",
      activityName: "前台班次验收",
      benefitDescription: "验证球馆前台与商户独立收银台",
      faceValueCents: 500,
      validFrom: new Date(Date.now() - 86_400_000).toISOString(),
      validTo: new Date(Date.now() + 30 * 86_400_000).toISOString(),
      claimLimitPerUser: 2,
      issueLimit: 2,
    });
    const issued = await request(
      "POST",
      `/alliance/coupon-templates/${template.id}/codes`,
      { count: 2, idempotencyKey: "coupon-shift-gate-batch-1" },
    );

    await login("MEMBER");
    await request("POST", `/alliance/coupons/${issued.codes[0]}/claim`);
    await request("POST", `/alliance/coupons/${issued.codes[1]}/claim`);

    await login("FRONT_DESK");
    const frontDeskCommand = {
      code: issued.codes[0],
      merchantId: "merchant-coffee",
      attributedAmountCents: 2_800,
      idempotencyKey: "coupon-frontdesk-redeem-1",
    };
    await expect(
      request("POST", "/alliance/coupons/redeem", frontDeskCommand),
    ).rejects.toThrow("当前前台未开班或今日班次已关闭");
    const shift = await request("POST", "/operations/shifts/open", {
      openingCashCents: 10_000,
    });
    const frontDeskRedemption = await request(
      "POST",
      "/alliance/coupons/redeem",
      frontDeskCommand,
    );
    expect(frontDeskRedemption).toMatchObject({
      status: "REDEEMED",
      frontDeskShiftId: shift.id,
      adminEmergencyBypass: false,
    });
    expect(frontDeskRedemption).not.toHaveProperty("idempotencyKey");
    await expect(
      request("POST", "/alliance/coupons/redeem", frontDeskCommand),
    ).resolves.toEqual(frontDeskRedemption);
    expect(getAuditLogs().find(
      (item) => item.requestId === frontDeskCommand.idempotencyKey,
    )).toMatchObject({
      action: "ALLIANCE_COUPON_REDEEMED",
      newValue: { frontDeskShiftId: shift.id },
    });

    await login("MERCHANT");
    const merchantRedemption = await request(
      "POST",
      "/alliance/coupons/redeem",
      {
        code: issued.codes[1],
        merchantId: "merchant-coffee",
        attributedAmountCents: 1_900,
        idempotencyKey: "coupon-merchant-redeem-1",
      },
    );
    expect(merchantRedemption).toMatchObject({
      status: "REDEEMED",
      frontDeskShiftId: null,
      adminEmergencyBypass: false,
    });
    expect(merchantRedemption).not.toHaveProperty("idempotencyKey");
  });

  it("persists audited lifecycle changes and blocks operations for a disabled merchant", async () => {
    const template = await request("POST", "/alliance/coupon-templates", {
      code: "COFFEE-LIFECYCLE",
      merchantId: "merchant-coffee",
      name: "生命周期验收券",
      activityName: "联盟状态验收",
      benefitDescription: "用于验证启停边界",
      faceValueCents: 1000,
      validFrom: new Date(Date.now() - 86_400_000).toISOString(),
      validTo: new Date(Date.now() + 30 * 86_400_000).toISOString(),
      claimLimitPerUser: 1,
      issueLimit: 10,
    });
    const issued = await request(
      "POST",
      `/alliance/coupon-templates/${template.id}/codes`,
      { count: 1, idempotencyKey: "coupon-batch-lifecycle-1" },
    );
    await login("MEMBER");
    await request("POST", `/alliance/coupons/${issued.codes[0]}/claim`);
    await login("ADMIN");

    const templateCommand = {
      enabled: false,
      reason: "活动权益暂停",
      idempotencyKey: "template-lifecycle-command-1",
    };
    const disabledTemplate = await request(
      "POST",
      `/alliance/coupon-templates/${template.id}/status`,
      templateCommand,
    );
    expect(disabledTemplate.enabled).toBe(false);
    await expect(request(
      "POST",
      `/alliance/coupon-templates/${template.id}/status`,
      templateCommand,
    )).resolves.toMatchObject({ enabled: false });
    expect(getAuditLogs().filter(
      (item) => item.requestId === templateCommand.idempotencyKey,
    )).toHaveLength(1);
    await expect(request(
      "POST",
      `/alliance/coupon-templates/${template.id}/status`,
      { ...templateCommand, reason: "同一幂等键更换原因" },
    )).rejects.toThrow("幂等键已用于其他联盟状态操作");
    await request(
      "POST",
      `/alliance/coupon-templates/${template.id}/status`,
      {
        enabled: true,
        reason: "权益复核完成",
        idempotencyKey: "template-lifecycle-command-2",
      },
    );

    const merchantCommand = {
      status: "DISABLED",
      reason: "合作协议到期",
      idempotencyKey: "merchant-lifecycle-command-1",
    };
    await expect(request(
      "POST",
      "/alliance/merchants/merchant-coffee/status",
      { ...merchantCommand, reason: "" },
    )).rejects.toThrow("状态变更原因需要2-300个字符");
    const disabledMerchant = await request(
      "POST",
      "/alliance/merchants/merchant-coffee/status",
      merchantCommand,
    );
    expect(disabledMerchant.status).toBe("DISABLED");
    await expect(request(
      "POST",
      "/alliance/merchants/merchant-coffee/status",
      merchantCommand,
    )).resolves.toMatchObject({ status: "DISABLED" });
    expect(getAuditLogs().filter(
      (item) => item.requestId === merchantCommand.idempotencyKey,
    )).toHaveLength(1);

    await expect(request(
      "POST",
      `/alliance/coupon-templates/${template.id}/codes`,
      { count: 1, idempotencyKey: "coupon-batch-lifecycle-1" },
    )).resolves.toEqual(issued);
    await expect(request(
      "POST",
      `/alliance/coupon-templates/${template.id}/codes`,
      { count: 1, idempotencyKey: "coupon-batch-disabled-new" },
    )).rejects.toThrow("商户已停用");
    await expect(request("POST", "/alliance/coupons/redeem", {
      code: issued.codes[0],
      merchantId: "merchant-coffee",
      attributedAmountCents: 0,
      idempotencyKey: "disabled-merchant-redeem-1",
    })).rejects.toThrow("商户已停用，不能核销券码");
    await expect(request("POST", "/alliance/coupon-templates", {
      code: "COFFEE-BLOCKED",
      merchantId: "merchant-coffee",
      name: "停用后新券",
      activityName: "不应创建",
      benefitDescription: "停用商户不能新建模板",
      faceValueCents: 1000,
      validFrom: new Date().toISOString(),
      validTo: new Date(Date.now() + 30 * 86_400_000).toISOString(),
      claimLimitPerUser: 1,
      issueLimit: 10,
    })).rejects.toThrow("停用商户不能创建券模板");

    await request(
      "POST",
      `/alliance/coupon-templates/${template.id}/status`,
      {
        enabled: false,
        reason: "商户停用同步下线",
        idempotencyKey: "template-lifecycle-command-3",
      },
    );
    await expect(request(
      "POST",
      `/alliance/coupon-templates/${template.id}/status`,
      {
        enabled: true,
        reason: "尝试绕过商户状态",
        idempotencyKey: "template-lifecycle-command-4",
      },
    )).rejects.toThrow("停用商户的券模板不能启用");

    await login("MERCHANT");
    await expect(request(
      "POST",
      "/alliance/merchants/merchant-coffee/status",
      {
        status: "ACTIVE",
        reason: "越权启用",
        idempotencyKey: "merchant-lifecycle-denied",
      },
    )).rejects.toThrow("当前角色无权执行该操作");
  });
});
