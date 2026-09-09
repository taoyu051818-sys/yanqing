import { mockUser } from "../../core";
import {
  getCoupons,
  getMerchants,
  getAuditLogs,
  saveCoupons,
  saveMerchants,
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
  activeMockParameter,
  requireIdempotencyKey,
  newId,
} from "../../policies/common.js";
import {
  merchantCanManage,
  merchantCanRedeem,
  couponRedemptionView,
  couponMerchantId,
  couponTemplate,
} from "../../policies/alliance.js";
import { requireMockOpenFrontDeskShift } from "../../policies/front-desk.js";
import type { MockRouteResult, MockRouteOptions } from "../route-contract.js";

export async function handleAllianceCouponsMeAny(
  method: string,
  url: string,
  data: any,
  options: MockRouteOptions,
): Promise<MockRouteResult> {
  if (url === "/alliance/coupons/me")
    return {
      handled: true,
      value: ok(
        getCoupons()
          .filter((coupon) => coupon.holderId === mockUser().id)
          .map((coupon) => {
            const template = couponTemplate(coupon);
            const merchant =
              getMerchants().find(
                (item) => item.id === couponMerchantId(coupon),
              ) || template?.merchant;
            const publicMerchant = merchant
              ? {
                  id: merchant.id,
                  code: merchant.code,
                  name: merchant.name,
                  category: merchant.category,
                  level: merchant.level,
                  status: merchant.status || "ACTIVE",
                }
              : null;
            return {
              ...coupon,
              template: template
                ? {
                    id: template.id,
                    code: template.code,
                    name: template.name,
                    activityName: template.activityName,
                    benefitDescription: template.benefitDescription,
                    faceValueCents: template.faceValueCents,
                    allowVenueBooking: template.allowVenueBooking === true,
                    validFrom: template.validFrom,
                    validTo: template.validTo,
                    enabled: template.enabled !== false,
                    merchant: publicMerchant,
                  }
                : undefined,
            };
          }),
      ),
    };
  return { handled: false };
}

export async function handleClaimCouponPost(
  method: string,
  url: string,
  data: any,
  options: MockRouteOptions,
): Promise<MockRouteResult> {
  const claimCouponMatch = url.match(/^\/alliance\/coupons\/([^/]+)\/claim$/);
  if (claimCouponMatch && method === "POST") {
    const list = getCoupons();
    const coupon = list.find((item) => item.code === claimCouponMatch[1]);
    if (!coupon) throw new Error("券码不存在或已被领取");
    if (coupon.status === "CLAIMED" && coupon.holderId === mockUser().id)
      return { handled: true, value: ok(coupon) };
    if (!["ISSUED", "AVAILABLE"].includes(coupon.status))
      throw new Error("券码不存在或已被领取");
    const template = couponTemplate(coupon);
    const merchant = getMerchants().find(
      (item) => item.id === couponMerchantId(coupon),
    );
    if (
      template?.enabled === false ||
      isExpired(template?.validTo) ||
      isExpired(coupon.expiresAt) ||
      (merchant?.status && merchant.status !== "ACTIVE")
    )
      throw new Error("券活动未开始或已结束");
    const newcomer = template?.code?.startsWith("NEWCOMER") === true;
    if (newcomer) {
      if (mockUser().memberProfile?.isNewCustomer !== true)
        throw new Error("新客体验权益仅限新客领取");
      const prior = list.find(
        (item) =>
          item.id !== coupon.id &&
          item.holderId === mockUser().id &&
          ["CLAIMED", "REDEEMED"].includes(item.status) &&
          couponTemplate(item)?.code?.startsWith("NEWCOMER"),
      );
      if (prior) throw new Error("新客体验权益每人仅限一次");
    }
    const claimedByUser = list.filter(
      (item) =>
        item.holderId === mockUser().id &&
        ["CLAIMED", "REDEEMED"].includes(item.status) &&
        (item.templateId === coupon.templateId ||
          (coupon.templateId === undefined &&
            couponTemplate(item)?.merchant?.id ===
              couponTemplate(coupon)?.merchant?.id)),
    ).length;
    if (
      template?.claimLimitPerUser &&
      claimedByUser >= Number(template.claimLimitPerUser)
    )
      throw new Error("超过每人领取上限");
    const claimedAt = new Date();
    const validityParameter = newcomer
      ? activeMockParameter("newcomer.experience.valid_days", claimedAt)
      : null;
    const configuredDays = Number(validityParameter?.value);
    const validityDays = Number.isFinite(configuredDays)
      ? Math.min(30, Math.max(1, Math.round(configuredDays)))
      : 7;
    const currentExpiry = new Date(
      String(coupon.expiresAt || template?.validTo),
    );
    const templateExpiry = new Date(
      String(template?.validTo || coupon.expiresAt),
    );
    const expiresAt = newcomer
      ? new Date(
          Math.min(
            currentExpiry.getTime(),
            templateExpiry.getTime(),
            claimedAt.getTime() + validityDays * 86_400_000,
          ),
        )
      : currentExpiry;
    Object.assign(coupon, {
      status: "CLAIMED",
      holderId: mockUser().id,
      claimedAt: claimedAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
    });
    coupon.merchantId = couponMerchantId(coupon);
    saveCoupons(list);
    saveAuditLogs([
      {
        id: newId("audit"),
        actorId: mockUser().id,
        actor: { id: mockUser().id, displayName: mockUser().displayName },
        actorRole: mockRoles()[0],
        action: "ALLIANCE_COUPON_CLAIMED",
        objectType: "CouponCode",
        objectId: coupon.id,
        newValue: {
          templateId: coupon.templateId || template?.id,
          newcomer,
          claimedAt: claimedAt.toISOString(),
          expiresAt: expiresAt.toISOString(),
          validityParameterId: validityParameter?.id || null,
          validityDays: newcomer ? validityDays : null,
        },
        result: "SUCCESS",
        createdAt: claimedAt.toISOString(),
      },
      ...getAuditLogs(),
    ]);
    return { handled: true, value: ok(coupon) };
  }
  return { handled: false };
}

export async function handleAllianceCouponsRedeemPost(
  method: string,
  url: string,
  data: any,
  options: MockRouteOptions,
): Promise<MockRouteResult> {
  if (url === "/alliance/coupons/redeem" && method === "POST") {
    requireMockRole("MERCHANT", "FRONT_DESK", "ADMIN", "SUPER_ADMIN");
    const list = getCoupons();
    const coupon = list.find((item) => item.code === data.code);
    if (!coupon) throw new Error("券码不存在");
    const merchantId = text(data.merchantId);
    if (!merchantId || !merchantCanRedeem(merchantId))
      throw new Error("只能操作本商户的券码");
    const idempotencyKey = requireIdempotencyKey(
      data.idempotencyKey,
      "券核销幂等键",
    );
    const amountCents = integer(data.attributedAmountCents)
      ? Number(data.attributedAmountCents)
      : Number(data.attributedAmountCents || 0);
    if (!Number.isInteger(amountCents) || amountCents < 0)
      throw new Error("成交金额必须为非负整数");
    const existingByKey = list.find(
      (item) => item.idempotencyKey === idempotencyKey,
    );
    if (existingByKey) {
      if (existingByKey.code !== coupon.code)
        throw new Error("券核销幂等键已用于其他券码");
      if (existingByKey.redeemedMerchantId !== merchantId)
        throw new Error("券核销幂等键已用于其他商户");
      if (Number(existingByKey.attributedAmountCents || 0) !== amountCents)
        throw new Error("券核销幂等键已用于不同成交金额");
      return { handled: true, value: ok(couponRedemptionView(existingByKey)) };
    }
    if (
      coupon.idempotencyKey === idempotencyKey &&
      coupon.status === "REDEEMED"
    )
      return { handled: true, value: ok(couponRedemptionView(coupon)) };
    const merchant = getMerchants().find((item) => item.id === merchantId);
    if (!merchant) throw new Error("商户不存在");
    if (merchant.status && merchant.status !== "ACTIVE")
      throw new Error("商户已停用，不能核销券码");
    if (coupon.status !== "CLAIMED")
      throw new Error("券码未领取、已核销或已失效");
    if (coupon.attributionOrderId)
      throw new Error("券码已用于待支付订场，请先取消原订单");
    if (
      isExpired(coupon.expiresAt) ||
      isExpired(couponTemplate(coupon)?.validTo)
    )
      throw new Error("券码已过期");
    const ownedMerchantId = couponMerchantId(coupon);
    if (ownedMerchantId && ownedMerchantId !== merchantId)
      throw new Error("券码不属于本商户");
    // Front-desk redemption belongs to the venue till and therefore requires
    // an open shift. A pure alliance merchant owns an independent till and is
    // deliberately outside the venue shift lifecycle. Keep this check after
    // exact replay so a weak-network retry remains readable after a shift was
    // closed.
    const venueOperator = hasMockRole("FRONT_DESK", "ADMIN", "SUPER_ADMIN");
    const redemptionShift = venueOperator
      ? requireMockOpenFrontDeskShift()
      : null;
    Object.assign(coupon, {
      status: "REDEEMED",
      redeemedMerchantId: merchantId,
      redeemedById: mockUser().id,
      redeemedAt: new Date().toISOString(),
      attributedAmountCents: amountCents,
      idempotencyKey,
      frontDeskShiftId: redemptionShift?.id || null,
      adminEmergencyBypass:
        venueOperator && hasMockRole("ADMIN", "SUPER_ADMIN"),
    });
    coupon.merchantId = ownedMerchantId || merchantId;
    if (merchant?._count)
      merchant._count.couponRedemptions =
        Number(merchant._count.couponRedemptions || 0) + 1;
    saveMerchants(getMerchants());
    saveCoupons(list);
    const redeemedAt = String(coupon.redeemedAt);
    const auditEntries = [
      {
        id: newId("audit"),
        actorId: mockUser().id,
        actor: { id: mockUser().id, displayName: mockUser().displayName },
        actorRole: mockRoles()[0],
        action: "ALLIANCE_COUPON_REDEEMED",
        objectType: "CouponCode",
        objectId: coupon.id,
        requestId: idempotencyKey,
        newValue: {
          merchantId,
          attributedAmountCents: amountCents,
          frontDeskShiftId: redemptionShift?.id || null,
          adminEmergencyBypass:
            venueOperator && hasMockRole("ADMIN", "SUPER_ADMIN"),
        },
        result: "SUCCESS",
        createdAt: redeemedAt,
      },
      ...(venueOperator && hasMockRole("ADMIN", "SUPER_ADMIN")
        ? [
            {
              id: newId("audit"),
              actorId: mockUser().id,
              actor: {
                id: mockUser().id,
                displayName: mockUser().displayName,
              },
              actorRole: mockRoles()[0],
              action: "FRONT_DESK_SHIFT_GATE_BYPASSED",
              objectType: "CouponCode",
              objectId: coupon.id,
              newValue: {
                operation: "ALLIANCE_COUPON_REDEEM",
                venueCode: "MAIN",
                shiftRequired: false,
                emergencyBypass: true,
              },
              reason: "管理员应急操作",
              result: "SUCCESS",
              createdAt: redeemedAt,
            },
          ]
        : []),
    ];
    saveAuditLogs([...auditEntries, ...getAuditLogs()]);
    return { handled: true, value: ok(couponRedemptionView(coupon)) };
  }
  return { handled: false };
}

export async function handleCouponQrGet(
  method: string,
  url: string,
  data: any,
  options: MockRouteOptions,
): Promise<MockRouteResult> {
  const couponQrMatch = url.match(/^\/alliance\/coupons\/([^/]+)\/qr$/);
  if (couponQrMatch && method === "GET") {
    const coupon = getCoupons().find((item) => item.code === couponQrMatch[1]);
    if (!coupon) throw new Error("券码不存在");
    if (
      coupon.holderId !== mockUser().id &&
      !hasMockRole("FRONT_DESK", "ADMIN", "SUPER_ADMIN") &&
      !merchantCanManage(couponMerchantId(coupon))
    )
      throw new Error("无权查看该券码");
    return {
      handled: true,
      value: ok({
        code: couponQrMatch[1],
        qrDataUrl: `mock://coupon/${couponQrMatch[1]}`,
      }),
    };
  }
  return { handled: false };
}
