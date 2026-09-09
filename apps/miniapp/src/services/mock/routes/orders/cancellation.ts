import { mockUser } from "../../core";
import { getOrders, saveOrders } from "../../venue";
import {
  getCoupons,
  getCouponTemplates,
  getEnrollments,
  getGames,
  getReferralRewards,
  getVenueBookings,
  saveCoupons,
  saveCouponTemplates,
  saveEnrollments,
  saveGames,
  saveReferralRewards,
  saveVenueBookings,
} from "../../state";
import {
  ok,
  hasMockRole,
  text,
  requireIdempotencyKey,
  creationCommandHash,
} from "../../policies/common.js";
import { saveMockMasterAudit } from "../../policies/master-data.js";
import { mockOrderResponse } from "../../policies/orders.js";
import { promoteMockGameWaitlist } from "../../policies/games.js";
import type { MockRouteResult, MockRouteOptions } from "../route-contract.js";

export async function handleCancelPendingOrderPost(
  method: string,
  url: string,
  data: any,
  options: MockRouteOptions,
): Promise<MockRouteResult> {
  const cancelPendingOrderMatch = url.match(/^\/orders\/([^/]+)\/cancel$/);
  if (cancelPendingOrderMatch && method === "POST") {
    requireIdempotencyKey(data.idempotencyKey, "取消订单幂等键");
    const orders = getOrders();
    const order = orders.find((item) => item.id === cancelPendingOrderMatch[1]);
    if (!order) throw new Error("订单不存在");
    if (
      order.memberId &&
      order.memberId !== mockUser().id &&
      !hasMockRole("FRONT_DESK", "ADMIN", "SUPER_ADMIN")
    ) {
      throw new Error("仅会员本人、前台或管理员可取消待支付订单");
    }
    if (
      ![
        "VENUE",
        "GAME",
        "TRAINING",
        "MEMBERSHIP",
        "RECHARGE",
        "GOODS",
      ].includes(order.businessType)
    )
      throw new Error("请从赛事报名详情退出");
    if (order.status === "CANCELLED")
      return { handled: true, value: ok(mockOrderResponse(order)) };
    if (
      order.businessType === "VENUE" &&
      order.status === "PAID" &&
      order.payableCents === 0 &&
      order.paidCents === 0 &&
      !order.refundedCents
    ) {
      const allBookings = getVenueBookings();
      const bookings = allBookings.filter(
        (row: any) => row.orderId === order.id,
      );
      const now = new Date();
      if (
        order.completedAt ||
        !bookings.length ||
        bookings.some(
          (row: any) =>
            row.status !== "CONFIRMED" || new Date(row.startsAt) <= now,
        )
      )
        throw new Error("仅未开始、未核销的免费预约可取消");
      if (
        order.refunds?.length ||
        order.payments?.some(
          (row: any) =>
            row.amountCents > 0 &&
            ["CREATED", "PROCESSING", "SUCCEEDED", "REFUNDED"].includes(
              row.status,
            ),
        )
      )
        throw new Error("订单付款记录已变化，请刷新后重试");
      const coupons = getCoupons();
      const templates = getCouponTemplates();
      const coupon = order.consumedCouponCode
        ? coupons.find((row: any) => row.code === order.consumedCouponCode)
        : null;
      const template = coupon
        ? templates.find((row: any) => row.id === coupon.templateId)
        : null;
      if (
        order.consumedCouponCode &&
        (!coupon ||
          coupon.status !== "REDEEMED" ||
          coupon.attributionOrderId !== order.id ||
          coupon.holderId !== order.memberId ||
          !template ||
          template.redeemedCount < 1)
      )
        throw new Error("预约优惠券记录不一致，请联系工作人员核对");
      if (coupon && template) {
        Object.assign(coupon, {
          status: new Date(coupon.expiresAt) > now ? "CLAIMED" : "EXPIRED",
          redeemedAt: null,
          redeemedById: null,
          redeemedMerchantId: null,
          attributionOrderId: null,
          attributedAmountCents: 0,
          idempotencyKey: null,
        });
        template.redeemedCount--;
        saveCoupons(coupons);
        saveCouponTemplates(templates);
      }
      order.status = "CANCELLED";
      order.cancelledAt = now.toISOString();
      order.bookings = bookings.map((row: any) => ({
        ...row,
        status: "CANCELLED",
        holdExpiresAt: null,
      }));
      saveVenueBookings(
        allBookings.map((row: any) =>
          row.orderId === order.id
            ? { ...row, status: "CANCELLED", holdExpiresAt: null }
            : row,
        ),
      );
      saveReferralRewards(
        getReferralRewards().map((row: any) =>
          row.triggerOrderId === order.id &&
          ["PENDING_OBSERVATION", "AVAILABLE"].includes(row.status)
            ? { ...row, status: "REVERSED", reversedAt: now.toISOString() }
            : row,
        ),
      );
      saveOrders(orders);
      saveMockMasterAudit({
        action: "ZERO_AMOUNT_VENUE_CANCELLED",
        objectType: "Order",
        objectId: order.id,
        requestId: text(data.idempotencyKey),
        commandHash: creationCommandHash({
          kind: "ZERO_AMOUNT_VENUE_CANCEL",
          orderId: order.id,
          reason: text(data.reason),
        }),
        oldValue: { status: "PAID" },
        newValue: {
          status: "CANCELLED",
          bookingStatus: "CANCELLED",
          refundRequired: false,
          couponRestored: Boolean(coupon),
        },
        reason: text(data.reason),
      });
      return { handled: true, value: ok(mockOrderResponse(order)) };
    }
    if (order.status !== "PENDING")
      throw new Error("订单已进入支付或履约流程，不能直接取消");
    if (order.businessType === "GAME") {
      const games = getGames();
      const game = games.find((item) =>
        (item.registrations || []).some((row: any) => row.orderId === order.id),
      );
      const registration = game?.registrations?.find(
        (item: any) => item.orderId === order.id,
      );
      if (!game || registration?.status !== "REGISTERED")
        throw new Error("球局报名状态已经变化，请刷新后重试");
      if (Number(order.paidCents || 0) > 0)
        throw new Error("订单已经支付，请刷新后按退款流程处理");
      order.status = "CANCELLED";
      order.cancelledAt = new Date().toISOString();
      order.paymentStatus = order.paymentStatus
        ? "CLOSED"
        : order.paymentStatus;
      registration.status = "CANCELLED";
      if (order.gameRegistration) order.gameRegistration.status = "CANCELLED";
      const promoted = promoteMockGameWaitlist(game);
      saveGames(games);
      saveOrders(promoted ? [promoted.order, ...orders] : orders);
      saveMockMasterAudit({
        action: "GAME_ORDER_CANCELLED_BY_USER",
        objectType: "Order",
        objectId: order.id,
        requestId: text(data.idempotencyKey),
        oldValue: { status: "PENDING" },
        commandHash: creationCommandHash({
          kind: "GAME_ORDER_CANCEL",
          orderId: order.id,
          reason: text(data.reason) || "用户取消待支付球局订单",
        }),
        newValue: {
          status: "CANCELLED",
          gameId: game.id,
          registrationStatus: "CANCELLED",
          promotedRegistrationId: promoted?.registration.id || null,
        },
        reason: text(data.reason) || "用户取消待支付球局订单",
      });
      return { handled: true, value: ok(mockOrderResponse(order)) };
    }
    const cancelledAt = new Date().toISOString();
    if (order.businessType === "TRAINING") {
      const enrollments = getEnrollments();
      const enrollment = enrollments.find(
        (item) =>
          item.orderId === order.id || item.id === order.trainingEnrollmentId,
      );
      if (!enrollment || enrollment.status !== "PENDING_PAYMENT")
        throw new Error("课程报名状态已经变化");
      enrollment.status = "CANCELLED";
      enrollment.seatReservedUntil = null;
      saveEnrollments(enrollments);
    }
    if (order.businessType === "MEMBERSHIP" && order.membership)
      order.membership.status = "CANCELLED";
    order.status = "CANCELLED";
    order.cancelledAt = cancelledAt;
    order.paymentStatus = order.paymentStatus ? "CLOSED" : order.paymentStatus;
    order.bookings = (order.bookings || []).map((booking: any) => ({
      ...booking,
      status: booking.status === "HELD" ? "CANCELLED" : booking.status,
      holdExpiresAt: null,
    }));
    saveVenueBookings(
      getVenueBookings().map((booking: any) =>
        booking.orderId === order.id && booking.status === "HELD"
          ? { ...booking, status: "CANCELLED", holdExpiresAt: null }
          : booking,
      ),
    );
    saveOrders(orders);
    saveMockMasterAudit({
      action: order.businessType + "_ORDER_CANCELLED_BY_USER",
      objectType: "Order",
      objectId: order.id,
      requestId: text(data.idempotencyKey),
      commandHash: creationCommandHash({
        kind: order.businessType + "_ORDER_CANCEL",
        orderId: order.id,
        reason: text(data.reason) || "用户取消待支付订单",
      }),
      oldValue: { status: "PENDING" },
      newValue: {
        status: "CANCELLED",
        bookingStatus: "CANCELLED",
        cancelledAt,
      },
      reason: text(data.reason) || "用户取消待支付订单",
    });
    return { handled: true, value: ok(mockOrderResponse(order)) };
  }
  return { handled: false };
}
