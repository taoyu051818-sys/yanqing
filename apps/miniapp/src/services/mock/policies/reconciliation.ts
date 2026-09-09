import { mockConsignmentReconciliationTotals } from "../consignment-settlement";
import { getOrders } from "../venue";
import {
  getEnrollments,
  getEventDetail,
  getGames,
  getFrontDeskShifts,
  getInventoryTransactions,
  getSettlements,
  getTrainingSessions,
  getTrainingSettlements,
} from "../state";
import { activeMockConsumeRecognition } from "./training.js";

export const mockReconciliationTotals = (date: string) => {
  const dayStart = new Date(`${date}T00:00:00+08:00`).getTime();
  const dayEnd = dayStart + 86_400_000;
  const inDay = (value: unknown) => {
    const time = new Date(String(value || "")).getTime();
    return Number.isFinite(time) && time >= dayStart && time < dayEnd;
  };
  const overlapsDay = (item: any) =>
    new Date(item.periodStart || 0).getTime() < dayEnd &&
    new Date(item.periodEnd || 0).getTime() > dayStart;
  const finalOrderStatuses = [
    "PAID",
    "CHECKED_IN",
    "COMPLETED",
    "REFUND_PENDING",
    "PARTIALLY_REFUNDED",
    "REFUNDED",
  ];
  const orders = getOrders();
  const paidOrders = orders.filter(
    (order) => inDay(order.paidAt) && finalOrderStatuses.includes(order.status),
  );
  const completedRefunds = orders
    .flatMap((order) => order.refunds || [])
    .filter(
      (refund: any) =>
        refund.status === "SUCCEEDED" && inDay(refund.completedAt),
    );
  const recognitions = getEnrollments()
    .flatMap((enrollment) => enrollment.attendances || [])
    .flatMap((attendance: any) => attendance.revenueRecognitions || [])
    .filter((recognition: any) => inDay(recognition.createdAt));
  const inventory = getInventoryTransactions().filter((transaction) =>
    inDay(transaction.createdAt),
  );
  const trainingSettlements = getTrainingSettlements().filter(
    (settlement) => settlement.status === "SETTLED" && overlapsDay(settlement),
  );
  const allianceSettlements = getSettlements().filter(
    (settlement) => settlement.status === "SETTLED" && overlapsDay(settlement),
  );

  return {
    orderPaidCents: paidOrders.reduce(
      (sum, order) => sum + Number(order.paidCents || 0),
      0,
    ),
    orderRefundedCents: paidOrders.reduce(
      (sum, order) => sum + Number(order.refundedCents || 0),
      0,
    ),
    successfulPaymentCents: orders
      .filter(
        (order) =>
          inDay(order.paidAt) &&
          (["SUCCEEDED", "REFUNDED"].includes(order.paymentStatus) ||
            Boolean(order.paymentId)),
      )
      .reduce(
        (sum, order) =>
          sum + Number(order.paymentAmountCents ?? order.paidCents ?? 0),
        0,
      ),
    completedRefundCents: completedRefunds.reduce(
      (sum: number, refund: any) => sum + Number(refund.amountCents || 0),
      0,
    ),
    trainingEffectiveRevenueCents: recognitions.reduce(
      (sum: number, recognition: any) =>
        sum + Number(recognition.effectiveRevenueCents || 0),
      0,
    ),
    trainingVenueContributionCents: recognitions.reduce(
      (sum: number, recognition: any) =>
        sum + Number(recognition.venueContributionCents || 0),
      0,
    ),
    trainingSettlementVenueContributionCents: trainingSettlements.reduce(
      (sum, settlement) => sum + Number(settlement.venueContributionCents || 0),
      0,
    ),
    allianceAttributedGmvCents: allianceSettlements.reduce(
      (sum, settlement) => sum + Number(settlement.attributedGmvCents || 0),
      0,
    ),
    allianceCooperationFeeCents: allianceSettlements.reduce(
      (sum, settlement) => sum + Number(settlement.cooperationFeeCents || 0),
      0,
    ),
    ...mockConsignmentReconciliationTotals(date),
    inventoryTransactionCount: inventory.length,
    inventoryCostCents: inventory.reduce(
      (sum, transaction) =>
        sum +
        Math.abs(Number(transaction.quantity || 0)) *
          Number(transaction.unitCostCents || 0),
      0,
    ),
  };
};

export const mockReconciliationBlockers = (date: string) => {
  const dayStart = new Date(`${date}T00:00:00+08:00`).getTime();
  const dayEnd = dayStart + 86_400_000;
  const pendingRefunds = getOrders()
    .flatMap((order) => order.refunds || [])
    .filter(
      (refund: any) =>
        ["REQUESTED", "APPROVED", "PROCESSING"].includes(refund.status) &&
        new Date(refund.requestedAt || 0).getTime() < dayEnd,
    ).length;
  const pendingPayments = getOrders().filter(
    (order) =>
      ["CREATED", "PROCESSING"].includes(order.paymentStatus) &&
      new Date(order.createdAt || 0).getTime() < dayEnd,
  ).length;
  const unfulfilledOrders = getOrders().filter((order) => {
    if (!["VENUE", "GAME", "EVENT"].includes(order.businessType)) return false;
    if (order.completedAt) return false;
    if (
      ![
        "PAID",
        "CHECKED_IN",
        "COMPLETED",
        "REFUND_PENDING",
        "PARTIALLY_REFUNDED",
      ].includes(order.status)
    )
      return false;
    if (order.businessType === "VENUE") {
      return (order.bookings || []).some(
        (booking: any) =>
          new Date(booking.endsAt || 0).getTime() < dayEnd &&
          ["CONFIRMED", "CHECKED_IN"].includes(booking.status),
      );
    }
    if (order.businessType === "GAME") {
      const game = getGames().find(
        (item) => item.id === (order.gameId || order.parameterSnapshot?.gameId),
      );
      const registration = game?.registrations?.find(
        (item: any) => item.orderId === order.id,
      );
      return Boolean(
        game &&
        new Date(game.endsAt || 0).getTime() < dayEnd &&
        ["PAID", "CHECKED_IN"].includes(registration?.status),
      );
    }
    const eventId = order.eventId || order.parameterSnapshot?.eventId;
    const detail = eventId ? getEventDetail(eventId) : null;
    const team = detail?.teams?.find((item: any) => item.orderId === order.id);
    return Boolean(
      detail &&
      new Date(detail.startsAt || 0).getTime() < dayEnd &&
      ["PAID", "CHECKED_IN"].includes(team?.status),
    );
  }).length;
  const enrollments = getEnrollments();
  const unfulfilledTrainingSessions = getTrainingSessions().filter(
    (session) =>
      session.status !== "CANCELLED" &&
      new Date(session.endsAt || 0).getTime() < dayEnd &&
      enrollments.some((enrollment) =>
        (enrollment.attendances || []).some((attendance: any) => {
          if (attendance.sessionId !== session.id) return false;
          if (attendance.status === "PENDING") return true;
          if (attendance.status !== "ATTENDED") return false;
          return (
            Number(attendance.consumedSessions || 0) === 0 ||
            !activeMockConsumeRecognition(attendance)
          );
        }),
      ),
  ).length;
  const dayShifts = getFrontDeskShifts().filter(
    (shift) => shift.businessDateLabel === date && shift.venueCode === "MAIN",
  );
  const openShifts = dayShifts.filter(
    (shift) => shift.status === "OPEN",
  ).length;
  const unreviewedVariances = dayShifts.filter(
    (shift) =>
      shift.status === "CLOSED" &&
      Number(shift.cashVarianceCents || 0) !== 0 &&
      !shift.varianceReviewedAt,
  ).length;
  return [
    ...(pendingRefunds
      ? [
          {
            kind: "PENDING_REFUNDS",
            count: pendingRefunds,
            message: `有 ${pendingRefunds} 笔退款待处理`,
          },
        ]
      : []),
    ...(pendingPayments
      ? [
          {
            kind: "PENDING_PAYMENTS",
            count: pendingPayments,
            message: `有 ${pendingPayments} 笔支付待处理`,
          },
        ]
      : []),
    ...(unfulfilledOrders
      ? [
          {
            kind: "UNFULFILLED_ORDERS",
            count: unfulfilledOrders,
            message: `有 ${unfulfilledOrders} 笔已到期场地/球局/赛事订单尚未确认履约`,
          },
        ]
      : []),
    ...(unfulfilledTrainingSessions
      ? [
          {
            kind: "UNFULFILLED_TRAINING_SESSIONS",
            count: unfulfilledTrainingSessions,
            message: `有 ${unfulfilledTrainingSessions} 节已结束培训课次尚未完成点名或消课`,
          },
        ]
      : []),
    ...(openShifts
      ? [
          {
            kind: "OPEN_FRONT_DESK_SHIFTS",
            count: openShifts,
            message: `有 ${openShifts} 个前台班次尚未关班`,
          },
        ]
      : []),
    ...(unreviewedVariances
      ? [
          {
            kind: "UNREVIEWED_CASH_VARIANCES",
            count: unreviewedVariances,
            message: `有 ${unreviewedVariances} 个班次现金差异待复核`,
          },
        ]
      : []),
  ];
};
