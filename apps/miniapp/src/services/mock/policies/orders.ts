import { mockUser } from "../core";
import {
  getCoupons,
  getGoods,
  getOrderCreations,
  getMerchants,
  saveOrderCreations,
} from "../state";
import {
  ok,
  text,
  isExpired,
  activeMockParameter,
  requireIdempotencyKey,
  creationCommandHash,
  mockPendingDeadline,
} from "./common.js";
import { couponMerchantId, couponTemplate } from "./alliance.js";

export const mockFrontDeskPaymentSummary = (accounts: any[]) => ({
  storedValueAvailableCents: accounts
    .filter((account) =>
      ["CASH_PRINCIPAL", "GIFT_BALANCE"].includes(account.type),
    )
    .reduce(
      (total, account) =>
        total +
        Math.max(
          0,
          Number(account.balance) - Number(account.frozenBalance || 0),
        ),
      0,
    ),
  badmintonCoinAvailable: accounts
    .filter((account) => account.type === "BADMINTON_COIN")
    .reduce(
      (total, account) =>
        total +
        Math.max(
          0,
          Number(account.balance) - Number(account.frozenBalance || 0),
        ),
      0,
    ),
});

export const assertMockRefundOriginIsConsistent = (
  status: string,
  completedAt: unknown,
  refundedCents: unknown,
) => {
  if (status === "COMPLETED" && !completedAt)
    throw new Error("已完成订单缺少完成时间，需先修复履约证据");
  if (status === "PARTIALLY_REFUNDED" && Number(refundedCents || 0) <= 0)
    throw new Error("部分退款订单缺少已退款金额，需先修复财务证据");
  if (completedAt && !["COMPLETED", "PARTIALLY_REFUNDED"].includes(status))
    throw new Error("订单状态与完成时间不一致，需先修复履约证据");
};

export const newOrderNo = (prefix = "YQ") =>
  `${prefix}${Date.now()}${Math.random().toString(36).slice(2, 6).toUpperCase()}`;

export type MockCreationAttempt =
  | { tracked: false; replayed: false }
  | {
      tracked: true;
      replayed: boolean;
      key: string;
      memberId: string;
      commandHash: string;
      response?: any;
    };

export const beginMockOrderCreation = (
  creationIdempotencyKey: unknown,
  command: unknown,
  targetMemberId = mockUser().id,
): MockCreationAttempt => {
  if (!text(creationIdempotencyKey)) return { tracked: false, replayed: false };
  const key = requireIdempotencyKey(creationIdempotencyKey, "订单创建幂等键");
  const memberId = targetMemberId;
  const commandHash = creationCommandHash(command);
  const existing = getOrderCreations().find((item) => item.key === key);
  if (existing) {
    if (
      existing.memberId !== memberId ||
      existing.commandHash !== commandHash
    ) {
      throw new Error("订单创建幂等键已用于其他用户或其他创建指令");
    }
    return {
      tracked: true,
      replayed: true,
      key,
      memberId,
      commandHash,
      response: existing.response,
    };
  }
  return { tracked: true, replayed: false, key, memberId, commandHash };
};

export const mockOrderResponse = (value: any) => {
  if (value?.registration) {
    return {
      status: value.status ?? value.registration.status,
      waitlistPosition: value.waitlistPosition ?? null,
      registration: {
        ...(value.registration.name ? { name: value.registration.name } : {}),
        ...(value.registration.category
          ? { category: value.registration.category }
          : {}),
        status: value.registration.status,
        ...(value.registration.paymentDueAt
          ? { paymentDueAt: value.registration.paymentDueAt }
          : {}),
      },
    };
  }
  if (
    !value ||
    typeof value !== "object" ||
    (!value.orderNo && !value.businessType)
  ) {
    return value;
  }
  const compact = (record: Record<string, any>) =>
    Object.fromEntries(
      Object.entries(record).filter(([, entry]) => entry !== undefined),
    );
  const team = value.eventTeam;
  return compact({
    id: value.id,
    orderNo: value.orderNo,
    businessType: value.businessType,
    subjectAccount: value.subjectAccount,
    paymentChannel: value.paymentChannel,
    sourceChannel: value.sourceChannel,
    status: value.status,
    title: value.title,
    listAmountCents: value.listAmountCents,
    discountCents: value.discountCents,
    payableCents: value.payableCents,
    paidCents: value.paidCents,
    refundedCents: value.refundedCents,
    paidAt: value.paidAt,
    completedAt: value.completedAt,
    cancelledAt: value.cancelledAt,
    paymentExpiresAt:
      value.status === "PENDING" ? mockPendingDeadline(value) : undefined,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    member: value.member?.displayName
      ? { displayName: value.member.displayName }
      : undefined,
    items: Array.isArray(value.items)
      ? value.items.map((item: any) =>
          compact({
            id: item.id,
            itemType: item.itemType,
            itemId: item.itemId,
            name: item.name,
            quantity: item.quantity,
            unitPriceCents: item.unitPriceCents,
            amountCents: item.amountCents,
          }),
        )
      : undefined,
    payments: Array.isArray(value.payments)
      ? value.payments.map((payment: any) =>
          compact({
            id: payment.id,
            paymentNo: payment.paymentNo,
            channel: payment.channel,
            amountCents: payment.amountCents,
            status: payment.status,
            paidAt: payment.paidAt,
            createdAt: payment.createdAt,
            updatedAt: payment.updatedAt,
          }),
        )
      : undefined,
    refunds: Array.isArray(value.refunds)
      ? value.refunds.map((refund: any) =>
          compact({
            id: refund.id,
            refundNo: refund.refundNo,
            amountCents: refund.amountCents,
            reason: refund.reason,
            originalOrderStatus: refund.originalOrderStatus,
            status: refund.status,
            requestedAt: refund.requestedAt,
            approvedAt: refund.approvedAt,
            completedAt: refund.completedAt,
          }),
        )
      : undefined,
    bookings: Array.isArray(value.bookings)
      ? value.bookings.map((booking: any) =>
          compact({
            id: booking.id,
            status: booking.status,
            startsAt: booking.startsAt,
            endsAt: booking.endsAt,
            operatorOverride: booking.operatorOverride || undefined,
            checkedInAt: booking.checkedInAt,
            completedAt: booking.completedAt,
            court: booking.court
              ? compact({
                  id: booking.court.id,
                  code: booking.court.code,
                  name: booking.court.name,
                })
              : undefined,
          }),
        )
      : undefined,
    eventTeam: team
      ? compact({
          id: team.id,
          name: team.name,
          category: team.category,
          status: team.status,
          paymentDueAt: team.paymentDueAt,
          event: team.event
            ? compact({
                id: team.event.id,
                name: team.event.name,
                status: team.event.status,
                startsAt: team.event.startsAt,
              })
            : undefined,
        })
      : undefined,
    gameRegistration: value.gameRegistration
      ? compact({
          id: value.gameRegistration.id,
          status: value.gameRegistration.status,
          checkedInAt: value.gameRegistration.checkedInAt,
          game: value.gameRegistration.game
            ? compact({
                id: value.gameRegistration.game.id,
                title: value.gameRegistration.game.title,
                status: value.gameRegistration.game.status,
                startsAt: value.gameRegistration.game.startsAt,
                endsAt: value.gameRegistration.game.endsAt,
              })
            : undefined,
        })
      : undefined,
  });
};

export const finishMockOrderCreation = (
  attempt: MockCreationAttempt,
  response: any,
): any => {
  const transportResponse = mockOrderResponse(response);
  if (attempt.tracked && !attempt.replayed) {
    saveOrderCreations([
      {
        key: attempt.key,
        memberId: attempt.memberId,
        commandHash: attempt.commandHash,
        response: ok(transportResponse),
        createdAt: new Date().toISOString(),
      },
      ...getOrderCreations(),
    ]);
  }
  return ok(transportResponse);
};

export const mockPaymentCommandResponse = (order: any) => ({
  status: order.paymentStatus || "SUCCEEDED",
  amountCents: Number(order.paymentAmountCents || order.payableCents || 0),
  channel: order.paymentChannel,
  createdAt: order.paymentCreatedAt || order.paidAt,
  paidAt: order.paidAt || null,
  ...(order.paymentChannel === "WECHAT" && order.wechatPay
    ? { wechatPay: order.wechatPay }
    : {}),
});

export const mockRefundCommandResponse = (refund: any) => ({
  id: refund.id,
  status: refund.status,
  amountCents: Number(refund.amountCents || 0),
  reason: refund.reason,
  requestedAt: refund.requestedAt,
  approvedAt: refund.approvedAt || null,
  completedAt: refund.completedAt || null,
});

export function mockPaymentOptions(order: any) {
  const deadline = mockPendingDeadline(order),
    now = Date.now();
  let reason =
    order.status !== "PENDING"
      ? "订单已不在待付款状态"
      : deadline && new Date(deadline).getTime() <= now
        ? "支付保留期已过，请重新下单"
        : "";
  if (order.businessType === "VENUE" && order.parameterSnapshot?.couponId) {
    const coupon = getCoupons().find(
      (item) => item.id === order.parameterSnapshot.couponId,
    );
    const template = coupon && couponTemplate(coupon);
    if (
      template &&
      !template.code?.startsWith("NEWCOMER") &&
      !template.allowVenueBooking
    )
      reason ||= "此商户券不可抵扣订场，请取消后重新下单";
    if (
      !coupon ||
      coupon.holderId !== order.memberId ||
      coupon.status !== "CLAIMED"
    )
      reason ||= "订单优惠券已被使用或已失效";
    else if (isExpired(coupon.expiresAt) || isExpired(template?.validTo))
      reason ||= "订单优惠券已过期";
    else if (
      template?.enabled === false ||
      (template?.validFrom && new Date(template.validFrom).getTime() > now) ||
      getMerchants().find((row) => row.id === couponMerchantId(coupon))
        ?.status === "DISABLED"
    )
      reason ||= "订单优惠券活动或商户不可用";
    else if (
      coupon.attributionOrderId &&
      coupon.attributionOrderId !== order.id
    )
      reason ||= "订单优惠券已锁定到其他订单";
  }
  if (order.businessType === "GOODS")
    for (const item of order.items || []) {
      const goods = getGoods().find((row) => row.id === item.itemId);
      if (!goods || !goods.enabled || goods.stock < item.quantity)
        reason ||= "商品库存不足或已下架";
    }
  const parameter = activeMockParameter("badminton_coin.cent_value");
  const centValue = typeof parameter?.value === "number" ? parameter.value : 1;
  return {
    orderId: order.id,
    payableCents: order.payableCents,
    paymentExpiresAt: deadline,
    quotedAt: new Date().toISOString(),
    options: ["WECHAT", "CASH_PRINCIPAL", "GIFT_BALANCE", "BADMINTON_COIN"].map(
      (channel) => {
        const account = mockUser().accounts?.find(
          (item) => item.type === channel,
        );
        const availableBalance = Math.max(
          0,
          Number(account?.balance || 0) - Number(account?.frozenBalance || 0),
        );
        const debitAmount =
          channel === "BADMINTON_COIN"
            ? Math.ceil(order.payableCents / (centValue > 0 ? centValue : 1))
            : order.payableCents;
        const unavailable =
          reason ||
          (channel !== "WECHAT" && order.businessType === "RECHARGE"
            ? "充值不能使用已有余额支付"
            : channel === "BADMINTON_COIN" &&
                (!Number.isFinite(centValue) || centValue <= 0)
              ? "抵扣规则暂不可用"
              : channel !== "WECHAT" && availableBalance < debitAmount
                ? "可用余额不足（冻结余额不可使用）"
                : "");
        return {
          channel,
          enabled: !unavailable,
          reason: unavailable,
          debitAmount,
          availableBalance,
          unit: channel === "BADMINTON_COIN" ? "COIN" : "CENT",
        };
      },
    ),
  };
}
