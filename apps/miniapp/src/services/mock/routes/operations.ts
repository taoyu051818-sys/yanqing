import { mockUser } from "../core";
import { getOrders } from "../venue";
import { getFrontDeskShifts, saveFrontDeskShifts } from "../state";
import {
  ok,
  hasMockRole,
  requireMockRole,
  text,
  integer,
  newId,
} from "../policies/common.js";
import {
  mockShanghaiBusinessDate,
  frontDeskShiftView,
} from "../policies/front-desk.js";
import type { MockRouteResult, MockRouteOptions } from "./route-contract.js";

export async function handleOperationsShiftsCurrentGet(
  method: string,
  url: string,
  data: any,
  options: MockRouteOptions,
): Promise<MockRouteResult> {
  if (url === "/operations/shifts/current" && method === "GET") {
    requireMockRole("FRONT_DESK", "ADMIN", "SUPER_ADMIN");
    const businessDate = mockShanghaiBusinessDate();
    const shift = getFrontDeskShifts().find(
      (item) =>
        item.businessDateLabel === businessDate &&
        item.venueCode === "MAIN" &&
        item.operatorId === mockUser().id,
    );
    return {
      handled: true,
      value: ok(shift ? frontDeskShiftView(shift) : null),
    };
  }
  return { handled: false };
}

export async function handleOperationsShiftsHistoryGet(
  method: string,
  url: string,
  data: any,
  options: MockRouteOptions,
): Promise<MockRouteResult> {
  if (url === "/operations/shifts/history" && method === "GET") {
    requireMockRole("FRONT_DESK", "FINANCE", "ADMIN", "SUPER_ADMIN");
    const canSeeAll = hasMockRole("FINANCE", "ADMIN", "SUPER_ADMIN");
    const status = text(data.status);
    if (status && !["OPEN", "CLOSED"].includes(status))
      throw new Error("班次状态无效");
    const operatorId = canSeeAll ? text(data.operatorId) : mockUser().id;
    const limit = Number.isInteger(integer(data.limit))
      ? Math.min(100, Math.max(1, integer(data.limit)))
      : 30;
    const shifts = getFrontDeskShifts()
      .filter(
        (item) =>
          item.venueCode === "MAIN" &&
          (!status || item.status === status) &&
          (!operatorId || item.operatorId === operatorId),
      )
      .sort((a, b) => String(b.openedAt).localeCompare(String(a.openedAt)))
      .slice(0, limit)
      .map(frontDeskShiftView);
    return { handled: true, value: ok(shifts) };
  }
  return { handled: false };
}

export async function handleOperationsShiftsOpenPost(
  method: string,
  url: string,
  data: any,
  options: MockRouteOptions,
): Promise<MockRouteResult> {
  if (url === "/operations/shifts/open" && method === "POST") {
    requireMockRole("FRONT_DESK", "ADMIN", "SUPER_ADMIN");
    const openingCashCents = integer(data.openingCashCents);
    if (!Number.isSafeInteger(openingCashCents) || openingCashCents < 0)
      throw new Error("开班备用金必须为非负整数分");
    const businessDateLabel = mockShanghaiBusinessDate();
    const shifts = getFrontDeskShifts();
    const existing = shifts.find(
      (item) =>
        item.businessDateLabel === businessDateLabel &&
        item.venueCode === "MAIN" &&
        item.operatorId === mockUser().id,
    );
    if (existing) {
      if (existing.status === "CLOSED")
        throw new Error("今日班次已经关闭，不能重复开班");
      if (Number(existing.openingCashCents) !== openingCashCents)
        throw new Error("今日班次已用不同备用金开班");
      return { handled: true, value: ok(frontDeskShiftView(existing)) };
    }
    const now = new Date().toISOString();
    const shift = {
      id: newId("front-desk-shift"),
      businessDate: new Date(
        `${businessDateLabel}T00:00:00+08:00`,
      ).toISOString(),
      businessDateLabel,
      venueCode: "MAIN",
      operatorId: mockUser().id,
      status: "OPEN",
      openedAt: now,
      openingCashCents,
      closedAt: null,
      closingCashCents: null,
      expectedCashCents: null,
      cashVarianceCents: null,
      varianceReviewedById: null,
      varianceReviewedAt: null,
      varianceReviewReason: null,
      handoverNote: null,
      closeReason: null,
      pendingSnapshot: null,
      openedById: mockUser().id,
      closedById: null,
      auditTrail: [
        {
          action: "FRONT_DESK_SHIFT_OPENED",
          actorId: mockUser().id,
          createdAt: now,
          openingCashCents,
        },
      ],
      createdAt: now,
      updatedAt: now,
    };
    saveFrontDeskShifts([shift, ...shifts]);
    return { handled: true, value: ok(frontDeskShiftView(shift)) };
  }
  return { handled: false };
}

export async function handleCloseFrontDeskShiftPost(
  method: string,
  url: string,
  data: any,
  options: MockRouteOptions,
): Promise<MockRouteResult> {
  const closeFrontDeskShiftMatch = url.match(
    /^\/operations\/shifts\/([^/]+)\/close$/,
  );
  if (closeFrontDeskShiftMatch && method === "POST") {
    requireMockRole("FRONT_DESK", "ADMIN", "SUPER_ADMIN");
    const shifts = getFrontDeskShifts();
    const shift = shifts.find(
      (item) => item.id === closeFrontDeskShiftMatch[1],
    );
    if (!shift) throw new Error("前台班次不存在");
    const administrator = hasMockRole("ADMIN", "SUPER_ADMIN");
    const delegated = shift.operatorId !== mockUser().id;
    if (delegated && !administrator) throw new Error("只能关闭自己的前台班次");
    const closingCashCents = integer(data.closingCashCents);
    const handoverNote = text(data.handoverNote);
    const closeReason = text(data.reason) || null;
    if (!Number.isSafeInteger(closingCashCents) || closingCashCents < 0)
      throw new Error("关班现金实点必须为非负整数分");
    if (handoverNote.length < 2 || handoverNote.length > 1000)
      throw new Error("交接备注长度必须为2-1000个字符");
    if (delegated && (!closeReason || closeReason.length < 2))
      throw new Error("管理员代关班次必须填写原因");
    if (closeReason && closeReason.length > 300)
      throw new Error("代关原因不能超过300个字符");
    if (shift.status === "CLOSED") {
      if (
        shift.closedById === mockUser().id &&
        Number(shift.closingCashCents) === closingCashCents &&
        shift.handoverNote === handoverNote &&
        (shift.closeReason || null) === closeReason
      )
        return { handled: true, value: ok(frontDeskShiftView(shift)) };
      throw new Error("班次已经用另一组关班数据关闭");
    }

    const allOrders = getOrders();
    const operationalOrders = allOrders.filter(
      (order) =>
        order.createdById === shift.operatorId ||
        (order.businessType === "VENUE" &&
          (order.bookings || []).some(
            (booking: any) =>
              booking.status !== "CANCELLED" &&
              mockShanghaiBusinessDate(new Date(booking.startsAt)) ===
                shift.businessDateLabel,
          )),
    );
    const cashOrders = allOrders.filter(
      (order) =>
        order.paymentChannel === "OFFLINE_CASH" &&
        order.paymentOperatorId === shift.operatorId &&
        [
          "PAID",
          "CHECKED_IN",
          "COMPLETED",
          "REFUND_PENDING",
          "PARTIALLY_REFUNDED",
          "REFUNDED",
        ].includes(order.status) &&
        mockShanghaiBusinessDate(new Date(order.paidAt || order.createdAt)) ===
          shift.businessDateLabel,
    );
    const cashReceiptsCents = cashOrders.reduce(
      (sum, order) => sum + Number(order.paidCents || 0),
      0,
    );
    const cashRefundsCents = cashOrders.reduce(
      (sum, order) =>
        sum +
        (order.refunds || [])
          .filter(
            (refund: any) =>
              refund.status === "SUCCEEDED" &&
              mockShanghaiBusinessDate(
                new Date(refund.completedAt || refund.requestedAt),
              ) === shift.businessDateLabel,
          )
          .reduce(
            (refundSum: number, refund: any) =>
              refundSum + Number(refund.amountCents || 0),
            0,
          ),
      0,
    );
    const expectedCashCents =
      Number(shift.openingCashCents) + cashReceiptsCents - cashRefundsCents;
    if (expectedCashCents < 0)
      throw new Error("现金退款超过备用金与现金收款，请先由财务核对异常");
    const pendingOrders = operationalOrders.filter((order) =>
      [
        "PENDING",
        "PAID",
        "CHECKED_IN",
        "REFUND_PENDING",
        "PARTIALLY_REFUNDED",
      ].includes(order.status),
    );
    const pendingRefunds = allOrders.flatMap((order) =>
      (order.refunds || [])
        .filter(
          (refund: any) =>
            (order.createdById === shift.operatorId ||
              refund.requestedById === shift.operatorId) &&
            ["REQUESTED", "APPROVED", "PROCESSING", "FAILED"].includes(
              refund.status,
            ),
        )
        .map((refund: any) => ({ ...refund, orderId: order.id })),
    );
    const cashVarianceCents = closingCashCents - expectedCashCents;
    const now = new Date().toISOString();
    const exceptions = [
      ...(pendingRefunds.length
        ? [{ kind: "PENDING_REFUNDS", count: pendingRefunds.length }]
        : []),
      ...(cashVarianceCents
        ? [{ kind: "CASH_VARIANCE", amountCents: cashVarianceCents }]
        : []),
    ];
    Object.assign(shift, {
      status: "CLOSED",
      closedAt: now,
      closingCashCents,
      expectedCashCents,
      cashVarianceCents,
      handoverNote,
      closeReason,
      pendingSnapshot: {
        generatedAt: now,
        businessDate: shift.businessDateLabel,
        venueCode: "MAIN",
        operatorId: shift.operatorId,
        cash: {
          openingCashCents: shift.openingCashCents,
          cashReceiptsCents,
          cashRefundsCents,
          expectedCashCents,
        },
        pendingOrders: { count: pendingOrders.length, items: pendingOrders },
        pendingRefunds: {
          count: pendingRefunds.length,
          items: pendingRefunds,
        },
        pendingPayments: { count: 0 },
        exceptions,
      },
      closedById: mockUser().id,
      auditTrail: [
        ...(shift.auditTrail || []),
        {
          action: "FRONT_DESK_SHIFT_CLOSED",
          actorId: mockUser().id,
          createdAt: now,
          reason: delegated ? closeReason : handoverNote,
          closingCashCents,
          expectedCashCents,
          cashVarianceCents,
        },
      ],
      updatedAt: now,
    });
    saveFrontDeskShifts(shifts);
    return { handled: true, value: ok(frontDeskShiftView(shift)) };
  }
  return { handled: false };
}

export async function handleReviewFrontDeskVariancePost(
  method: string,
  url: string,
  data: any,
  options: MockRouteOptions,
): Promise<MockRouteResult> {
  const reviewFrontDeskVarianceMatch = url.match(
    /^\/operations\/shifts\/([^/]+)\/review-variance$/,
  );
  if (reviewFrontDeskVarianceMatch && method === "POST") {
    requireMockRole("FINANCE", "ADMIN", "SUPER_ADMIN");
    const shifts = getFrontDeskShifts();
    const shift = shifts.find(
      (item) => item.id === reviewFrontDeskVarianceMatch[1],
    );
    if (!shift) throw new Error("前台班次不存在");
    if (shift.status !== "CLOSED")
      throw new Error("班次尚未关闭，不能复核现金差异");
    const reason = text(data.reason) || null;
    if (reason && (reason.length < 2 || reason.length > 300))
      throw new Error("差异复核原因长度必须为2-300个字符");
    if (shift.varianceReviewedById) {
      if (
        shift.varianceReviewedById === mockUser().id &&
        (shift.varianceReviewReason || null) === reason
      )
        return { handled: true, value: ok(frontDeskShiftView(shift)) };
      throw new Error("现金差异已经由其他复核结果处理");
    }
    if (
      shift.operatorId === mockUser().id ||
      shift.closedById === mockUser().id
    )
      throw new Error("班次操作人与关班人不能复核自己的现金差异");
    if (Number(shift.cashVarianceCents || 0) !== 0 && !reason)
      throw new Error("非零现金差异必须填写复核原因");
    const now = new Date().toISOString();
    shift.varianceReviewedById = mockUser().id;
    shift.varianceReviewedAt = now;
    shift.varianceReviewReason = reason;
    shift.auditTrail = [
      ...(shift.auditTrail || []),
      {
        action: "FRONT_DESK_SHIFT_VARIANCE_REVIEWED",
        actorId: mockUser().id,
        reason: reason || "零差异确认",
        createdAt: now,
      },
    ];
    shift.updatedAt = now;
    saveFrontDeskShifts(shifts);
    return { handled: true, value: ok(frontDeskShiftView(shift)) };
  }
  return { handled: false };
}
