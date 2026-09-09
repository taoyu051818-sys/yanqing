import { mockUser } from "../../core";
import {
  availability,
  getOrders,
  resolveMockPriceRule,
  saveOrders,
} from "../../venue";
import {
  getCoupons,
  getMerchants,
  getVenueBookings,
  getVenueClosures,
  saveVenueBookings,
} from "../../state";
import {
  ok,
  hasMockRole,
  requireMockRole,
  text,
  isExpired,
  activeMockParameter,
  newId,
} from "../../policies/common.js";
import {
  type MockVenueMember,
  MOCK_ACTIVE_MEMBERS,
  startsAtDate,
} from "../../policies/venues.js";
import {
  newOrderNo,
  beginMockOrderCreation,
  finishMockOrderCreation,
} from "../../policies/orders.js";
import { mockOperatingShareSnapshot } from "../../policies/master-data.js";
import { requireMockOpenFrontDeskShift } from "../../policies/front-desk.js";
import { couponMerchantId, couponTemplate } from "../../policies/alliance.js";
import type { MockRouteResult, MockRouteOptions } from "../route-contract.js";

export async function handleVenuesAvailabilityAny(
  method: string,
  url: string,
  data: any,
  options: MockRouteOptions,
): Promise<MockRouteResult> {
  if (
    url === "/venues/availability" ||
    url === "/venues/availability/assisted"
  ) {
    if (url.endsWith("/assisted"))
      requireMockRole("FRONT_DESK", "ADMIN", "SUPER_ADMIN");
    const date = text(data.date || new Date().toISOString().slice(0, 10));
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("日期格式无效");
    return { handled: true, value: ok(availability(date)) };
  }
  return { handled: false };
}

export async function handleVenuesBookingsPost(
  method: string,
  url: string,
  data: any,
  options: MockRouteOptions,
): Promise<MockRouteResult> {
  if (url === "/venues/bookings" && method === "POST") {
    const date = text(data.date);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("日期格式无效");
    const requestedMemberId = text(data.memberId);
    const canAssist = hasMockRole("FRONT_DESK", "ADMIN", "SUPER_ADMIN");
    const assisted =
      canAssist &&
      (Boolean(requestedMemberId) || data.sourceChannel === "STORE_VISIT");
    let targetMember: MockVenueMember;
    if (assisted) {
      if (!requestedMemberId) throw new Error("前台代客订场必须先选择会员");
      const activeMember = MOCK_ACTIVE_MEMBERS.find(
        (member) =>
          member.id === requestedMemberId && member.status === "ACTIVE",
      );
      if (!activeMember) throw new Error("所选会员不存在、未建档或已停用");
      targetMember = activeMember;
    } else {
      if (!canAssist) requireMockRole("MEMBER");
      if (requestedMemberId && requestedMemberId !== mockUser().id)
        throw new Error("会员只能为本人预订场地");
      targetMember = {
        id: mockUser().id,
        displayName: mockUser().displayName,
        memberProfile: mockUser().memberProfile,
      };
    }
    const operatorOverride = data.overrideReason !== undefined;
    const overrideReason = text(data.overrideReason);
    if (operatorOverride && (!assisted || !canAssist))
      throw new Error("仅前台或管理员代会员订场可使用特殊代订");
    if (
      operatorOverride &&
      (overrideReason.length < 2 || overrideReason.length > 300)
    )
      throw new Error("特殊代订原因须为2-300字");
    const creation = beginMockOrderCreation(
      data.creationIdempotencyKey,
      {
        kind: "VENUE_BOOKING",
        memberId: targetMember.id,
        date,
        courtId: text(data.courtId),
        slotId: text(data.slotId),
        sourceChannel: text(data.sourceChannel) || "MINI_PROGRAM",
        couponCode: text(data.couponCode) || null,
        ...(operatorOverride ? { overrideReason } : {}),
      },
      targetMember.id,
    );
    if (creation.tracked && creation.replayed)
      return { handled: true, value: ok(creation.response) };
    const assistedShift = assisted ? requireMockOpenFrontDeskShift() : null;
    const calendar = availability(date);
    const court = calendar.courts.find((item: any) => item.id === data.courtId);
    const slot = calendar.slots.find((item: any) => item.id === data.slotId);
    if (
      !court ||
      !slot ||
      (!operatorOverride && (!court.enabled || !slot.enabled))
    )
      throw new Error("场地或时段不存在");
    const priceRule = resolveMockPriceRule(date, slot.id);
    if (!priceRule) throw new Error("该时段未配置有效价格");
    if (!operatorOverride && court.usage === "MAINTENANCE")
      throw new Error("场地维护中");
    if (!operatorOverride && court.usage === "TRAINING")
      throw new Error("该场地为培训专用场，不能零售预订");
    const startsAt = startsAtDate(date, Number(slot.startMinutes));
    const endsAt = startsAtDate(date, Number(slot.endMinutes));
    if (
      Number.isNaN(startsAt.getTime()) ||
      Number.isNaN(endsAt.getTime()) ||
      (!operatorOverride && startsAt <= new Date())
    ) {
      throw new Error("不能预订已开始的时段");
    }
    const closure = getVenueClosures().find(
      (item: any) =>
        item.courtId === court.id &&
        item.status === "ACTIVE" &&
        new Date(item.startsAt).getTime() < endsAt.getTime() &&
        new Date(item.endsAt).getTime() > startsAt.getTime(),
    );
    if (closure && !operatorOverride)
      throw new Error(`该时段已封场：${closure.reason}`);
    const overlap = (calendar.bookings || []).some(
      (booking: any) =>
        booking.courtId === court.id &&
        booking.status !== "CANCELLED" &&
        !(booking.status === "HELD" && isExpired(booking.holdExpiresAt)) &&
        new Date(booking.startsAt).getTime() < endsAt.getTime() &&
        new Date(booking.endsAt).getTime() > startsAt.getTime(),
    );
    if (overlap && !operatorOverride) throw new Error("该场地时段刚刚被预订");

    let payableCents = Number(priceRule.priceCents || 0);
    let discountCents = 0;
    let couponId: string | undefined;
    let newcomerPolicy: Record<string, unknown> | null = null;
    if (data.couponCode) {
      const coupon = getCoupons().find((item) => item.code === data.couponCode);
      const holderId = targetMember.id;
      if (!coupon) throw new Error("优惠券无效、已过期或不属于当前会员");
      const template = couponTemplate(coupon);
      const templateMerchant = getMerchants().find(
        (item) => item.id === couponMerchantId(coupon),
      );
      const now = new Date();
      if (
        coupon.holderId !== holderId ||
        coupon.status !== "CLAIMED" ||
        Boolean(coupon.attributionOrderId) ||
        isExpired(coupon.expiresAt) ||
        template?.enabled === false ||
        isExpired(template?.validTo) ||
        (template?.validFrom &&
          new Date(template.validFrom).getTime() > now.getTime()) ||
        (templateMerchant?.status && templateMerchant.status !== "ACTIVE")
      ) {
        throw new Error("优惠券无效、已过期或不属于当前会员");
      }
      if (template?.code?.startsWith("NEWCOMER")) {
        const parameter = activeMockParameter(
          "newcomer.experience.allowed_slot_periods",
          now,
        );
        const allowedPeriods =
          Array.isArray(parameter?.value) && parameter.value.length
            ? parameter.value.filter((item: unknown) =>
                ["EARLY", "DAYTIME", "PRIME"].includes(String(item)),
              )
            : ["EARLY", "DAYTIME"];
        if (!allowedPeriods.includes(slot.period))
          throw new Error("新客体验权益仅限非黄金时段使用");
        if (
          priceRule.newcomerPriceCents === null ||
          priceRule.newcomerPriceCents === undefined
        )
          throw new Error("该时段未配置新客体验价");
        payableCents = Number(priceRule.newcomerPriceCents);
        newcomerPolicy = {
          allowedPeriodsParameterId: parameter?.id || null,
          allowedPeriods,
          slotPeriod: slot.period,
        };
      } else {
        if (!template?.allowVenueBooking)
          throw new Error("此券仅限所属商户消费，不可抵扣订场");
        payableCents = Math.max(
          0,
          payableCents - Number(template?.faceValueCents || 0),
        );
      }
      discountCents = Number(priceRule.priceCents || 0) - payableCents;
      couponId = coupon.id;
    }
    const createdAt = new Date().toISOString();
    const orderId = newId("order");
    const booking = {
      id: newId("booking"),
      orderId,
      courtId: court.id,
      court: { id: court.id, name: court.name },
      memberId: targetMember.id,
      status: "HELD",
      startsAt: startsAt.toISOString(),
      endsAt: endsAt.toISOString(),
      holdExpiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
      usage: "RETAIL",
      operatorOverride,
      overrideReason: operatorOverride ? overrideReason : null,
    };
    const order = {
      id: orderId,
      orderNo: newOrderNo(),
      title: `${court.name} ${slot.label} 场地预订`,
      status: "PENDING",
      businessType: "VENUE",
      payableCents,
      listAmountCents: Number(priceRule.priceCents || payableCents),
      discountCents,
      paidCents: 0,
      refundedCents: 0,
      createdAt,
      memberId: targetMember.id,
      createdById: mockUser().id,
      member: {
        id: targetMember.id,
        displayName: targetMember.displayName,
        phone: targetMember.phone,
      },
      bookings: [booking],
      consumedCouponCode: text(data.couponCode) || null,
      parameterSnapshot: {
        ...(operatorOverride
          ? {
              assistedBookingOverride: {
                reason: overrideReason,
                actorId: mockUser().id,
                past: startsAt <= new Date(),
                courtEnabled: court.enabled,
                courtUsage: court.usage,
                slotEnabled: slot.enabled,
                overlapping: overlap,
                closureId: closure?.id || null,
              },
            }
          : {}),
        courtId: court.id,
        slotId: slot.id,
        priceRuleId: priceRule.id,
        priceRuleCode: priceRule.code,
        priceRuleVersion: priceRule.version,
        priceRuleEffectiveFrom: priceRule.effectiveFrom,
        priceRuleEffectiveTo: priceRule.effectiveTo || null,
        priceRuleTimeSlotId: priceRule.timeSlotId,
        priceRuleWeekdayMask: priceRule.weekdayMask,
        priceCents: priceRule.priceCents,
        newcomerPriceCents: priceRule.newcomerPriceCents ?? null,
        date,
        startsAt: startsAt.toISOString(),
        endsAt: endsAt.toISOString(),
        newcomerPolicy,
        couponId,
        targetMemberId: targetMember.id,
        createdById: mockUser().id,
        operatorAssisted: assisted,
        frontDeskShiftId: assistedShift?.id || null,
        adminEmergencyBypass: assisted && !assistedShift,
        operatingShare: mockOperatingShareSnapshot("VENUE"),
      },
    };
    saveVenueBookings([booking, ...getVenueBookings()]);
    saveOrders([order, ...getOrders()]);
    return { handled: true, value: finishMockOrderCreation(creation, order) };
  }
  return { handled: false };
}
