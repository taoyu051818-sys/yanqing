import { mockUser } from "../../core";
import { getOrders, saveOrders } from "../../venue";
import {
  getAuditLogs,
  getVenueBookings,
  saveAuditLogs,
  saveVenueBookings,
} from "../../state";
import {
  ok,
  requireMockRole,
  text,
  requireIdempotencyKey,
  newId,
  creationCommandHash,
} from "../../policies/common.js";
import { assertMockOperationWindow } from "../../policies/operation-window.js";
import { mockOrderResponse } from "../../policies/orders.js";
import { requireMockOpenFrontDeskShift } from "../../policies/front-desk.js";
import type { MockRouteResult, MockRouteOptions } from "../route-contract.js";

export async function handleVenueCheckInPost(
  method: string,
  url: string,
  data: any,
  options: MockRouteOptions,
): Promise<MockRouteResult> {
  const venueCheckInMatch = url.match(/^\/venues\/orders\/([^/]+)\/check-in$/);
  if (venueCheckInMatch && method === "POST") {
    requireMockRole("FRONT_DESK", "ADMIN", "SUPER_ADMIN");
    const orders = getOrders();
    const order = orders.find((item) => item.id === venueCheckInMatch[1]);
    if (!order || order.businessType !== "VENUE")
      throw new Error("订场订单不存在");
    if (order.status === "CHECKED_IN")
      return { handled: true, value: ok(mockOrderResponse(order)) };
    if (order.status !== "PAID") throw new Error("订单未支付或状态不可签到");
    const persistedBooking = getVenueBookings().find(
      (booking) =>
        booking.orderId === order.id && booking.status !== "CANCELLED",
    );
    const booking = persistedBooking || (order.bookings || [])[0];
    if (!booking) throw new Error("订单没有可履约的场地占用记录");
    const timeWindowPolicy = assertMockOperationWindow({
      parameterKey: "operations.venue_check_in_window.v1",
      defaults: { earlyMinutes: 30, lateMinutes: 30 },
      startsAt: booking.startsAt,
      endsAt: booking.startsAt,
      action: "VENUE_CHECK_IN",
      objectType: "Order",
      objectId: order.id,
      overrideReason: data.overrideReason,
    });
    const checkInShift = requireMockOpenFrontDeskShift();
    order.status = "CHECKED_IN";
    order.checkedInAt = new Date().toISOString();
    order.checkedInById = mockUser().id;
    order.checkInFrontDeskShiftId = checkInShift?.id || null;
    order.checkInAdminEmergencyBypass = !checkInShift;
    order.checkInTimeWindowPolicy = timeWindowPolicy;
    const bookings = getVenueBookings().map((booking) =>
      booking.orderId === order.id && booking.status === "CONFIRMED"
        ? { ...booking, status: "CHECKED_IN" }
        : booking,
    );
    saveVenueBookings(bookings);
    order.bookings = (order.bookings || []).map((booking: any) => ({
      ...booking,
      status: booking.status === "CONFIRMED" ? "CHECKED_IN" : booking.status,
    }));
    saveOrders(orders);
    return { handled: true, value: ok(mockOrderResponse(order)) };
  }
  return { handled: false };
}

export async function handleVenueFulfillmentPost(
  method: string,
  url: string,
  data: any,
  options: MockRouteOptions,
): Promise<MockRouteResult> {
  const venueFulfillmentMatch = url.match(
    /^\/venues\/orders\/([^/]+)\/fulfillment$/,
  );
  if (venueFulfillmentMatch && method === "POST") {
    requireMockRole("FRONT_DESK", "ADMIN", "SUPER_ADMIN");
    const orders = getOrders();
    const order = orders.find((item) => item.id === venueFulfillmentMatch[1]);
    if (!order || order.businessType !== "VENUE")
      throw new Error("订场履约记录不存在");
    const outcome = text(data.outcome);
    if (!["COMPLETED", "NO_SHOW"].includes(outcome))
      throw new Error("场地履约结果无效");
    const reason = text(data.reason);
    if (reason.length < 2 || reason.length > 300)
      throw new Error("履约原因长度必须为2-300个字符");
    const idempotencyKey = requireIdempotencyKey(
      data.idempotencyKey,
      "场地履约幂等键",
    );
    const evidenceSource = text(data.evidence?.source);
    if (
      ![
        "FRONT_DESK_ROLL_CALL",
        "ACCESS_CONTROL_LOG",
        "COURT_INSPECTION",
      ].includes(evidenceSource)
    )
      throw new Error("履约证据来源无效");
    const observedAt = new Date(String(data.evidence?.observedAt || ""));
    if (!Number.isFinite(observedAt.getTime()))
      throw new Error("履约证据时间无效");
    const commandHash = creationCommandHash({
      kind: "VENUE_FULFILLMENT",
      orderId: order.id,
      actorId: mockUser().id,
      outcome,
      reason,
      evidence: {
        source: evidenceSource,
        observedAt: observedAt.toISOString(),
      },
    });
    const persistedBookings = getVenueBookings();
    const replayBooking =
      persistedBookings.find(
        (booking) => booking.fulfillmentIdempotencyKey === idempotencyKey,
      ) ||
      orders
        .flatMap((item) => item.bookings || [])
        .find(
          (booking: any) =>
            booking.fulfillmentIdempotencyKey === idempotencyKey,
        );
    if (replayBooking) {
      if (
        replayBooking.orderId !== order.id ||
        replayBooking.fulfilledById !== mockUser().id ||
        replayBooking.fulfillmentCommandHash !== commandHash
      )
        throw new Error("履约幂等键已用于不同订单、命令或操作人");
      return { handled: true, value: ok(mockOrderResponse(order)) };
    }
    if (order.status === "REFUND_PENDING")
      throw new Error("订单正在等待退款审批，请先处理退款后再履约");
    const persistedBooking = persistedBookings.find(
      (booking) =>
        booking.orderId === order.id && booking.status !== "CANCELLED",
    );
    const orderBooking = (order.bookings || []).find(
      (booking: any) => booking.status !== "CANCELLED",
    );
    const booking = persistedBooking || orderBooking;
    if (!booking) throw new Error("订场履约记录不存在");
    if (booking.fulfilledAt || booking.fulfillmentIdempotencyKey)
      throw new Error("该场地订单已有不可变履约结果");
    const now = new Date();
    const startsAt = new Date(String(booking.startsAt || ""));
    const endsAt = new Date(String(booking.endsAt || ""));
    if (
      !Number.isFinite(startsAt.getTime()) ||
      !Number.isFinite(endsAt.getTime())
    )
      throw new Error("预约履约时间无效");
    if (endsAt > now) throw new Error("预约尚未结束，不能确认完成或未到场");
    if (
      !Number.isFinite(observedAt.getTime()) ||
      observedAt < startsAt ||
      observedAt > now
    )
      throw new Error("履约证据时间必须在预约开始后且不晚于当前时间");
    const expectedStatus = outcome === "COMPLETED" ? "CHECKED_IN" : "CONFIRMED";
    if (booking.status !== expectedStatus)
      throw new Error(
        outcome === "COMPLETED"
          ? "只有已签到场地订单可以确认完成"
          : "只有已支付且未签到场地订单可以标记未到场",
      );
    const shift = requireMockOpenFrontDeskShift();
    const nowIso = now.toISOString();
    const fulfillmentEvidence = {
      source: evidenceSource,
      observedAt: observedAt.toISOString(),
    };
    const applyBooking = (target: any) =>
      Object.assign(target, {
        status: outcome,
        fulfillmentIdempotencyKey: idempotencyKey,
        fulfillmentCommandHash: commandHash,
        fulfillmentReason: reason,
        fulfillmentEvidence,
        fulfilledById: mockUser().id,
        fulfilledAt: nowIso,
      });
    if (persistedBooking) applyBooking(persistedBooking);
    if (orderBooking && orderBooking !== persistedBooking)
      applyBooking(orderBooking);
    order.completedAt = order.completedAt || nowIso;
    if (!["REFUND_PENDING", "PARTIALLY_REFUNDED"].includes(order.status))
      order.status = "COMPLETED";
    order.fulfillmentOutcome = outcome;
    order.fulfillmentFrontDeskShiftId = shift?.id || null;
    order.fulfillmentAdminEmergencyBypass = !shift;
    saveVenueBookings(persistedBookings);
    saveOrders(orders);
    saveAuditLogs([
      {
        id: newId("audit"),
        actorId: mockUser().id,
        actorRole: mockUser().primaryRole,
        action:
          outcome === "NO_SHOW"
            ? "VENUE_BOOKING_NO_SHOW"
            : "VENUE_BOOKING_COMPLETED",
        objectType: "CourtBooking",
        objectId: booking.id,
        reason,
        requestId: idempotencyKey,
        result: "SUCCESS",
        oldValue: { status: expectedStatus },
        newValue: {
          status: outcome,
          orderId: order.id,
          evidence: fulfillmentEvidence,
        },
        createdAt: nowIso,
      },
      {
        id: newId("audit"),
        actorId: mockUser().id,
        actorRole: mockUser().primaryRole,
        action: "ORDER_COMPLETED",
        objectType: "Order",
        objectId: order.id,
        reason,
        result: "SUCCESS",
        newValue: { completedAt: order.completedAt, outcome },
        createdAt: nowIso,
      },
      ...getAuditLogs(),
    ]);
    return { handled: true, value: ok(mockOrderResponse(order)) };
  }
  return { handled: false };
}
