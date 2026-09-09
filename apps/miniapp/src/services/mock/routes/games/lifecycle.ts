import { mockUser } from "../../core";
import { getOrders, saveOrders } from "../../venue";
import {
  getGames,
  getAuditLogs,
  getVenueBookings,
  saveGames,
  saveAuditLogs,
  saveVenueBookings,
} from "../../state";
import {
  ok,
  hasMockRole,
  requireMockRole,
  text,
  requireIdempotencyKey,
  newId,
  creationCommandHash,
} from "../../policies/common.js";
import { newOrderNo } from "../../policies/orders.js";
import { gameCancellationResponse } from "../../policies/games.js";
import type { MockRouteResult, MockRouteOptions } from "../route-contract.js";

export async function handleCancelGamePost(
  method: string,
  url: string,
  data: any,
  options: MockRouteOptions,
): Promise<MockRouteResult> {
  const cancelGameMatch = url.match(/^\/games\/([^/]+)\/cancel$/);
  if (cancelGameMatch && method === "POST") {
    requireMockRole("HOST", "ADMIN", "SUPER_ADMIN");
    const reason = text(data.reason);
    if (reason.length < 2 || reason.length > 300)
      throw new Error("取消原因长度必须为2-300个字符");
    const idempotencyKey = requireIdempotencyKey(
      data.idempotencyKey,
      "球局取消幂等键",
    );
    const games = getGames();
    const game = games.find((item) => item.id === cancelGameMatch[1]);
    if (!game) throw new Error("球局不存在");
    const commandHash = creationCommandHash({
      kind: "GAME_CANCEL",
      gameId: game.id,
      reason,
      actorId: mockUser().id,
    });
    const replay = games.find(
      (item) => item.cancelIdempotencyKey === idempotencyKey,
    );
    if (replay) {
      if (
        replay.id !== game.id ||
        replay.cancelledById !== mockUser().id ||
        replay.cancelCommandHash !== commandHash
      )
        throw new Error("球局取消幂等键已用于不同命令");
      return {
        handled: true,
        value: ok(gameCancellationResponse({ game: replay, idempotent: true })),
      };
    }
    const hostOnly =
      hasMockRole("HOST") && !hasMockRole("ADMIN", "SUPER_ADMIN");
    if (hostOnly && game.hostId !== mockUser().id)
      throw new Error("仅本局主理人或管理员可取消球局");
    if (!["DRAFT", "OPEN", "FULL"].includes(game.status))
      throw new Error(`球局当前状态为 ${game.status}，不可取消`);
    const now = new Date();
    if (new Date(game.startsAt) <= now)
      throw new Error("球局已开赛，不能执行开赛前取消");
    const orders = getOrders();
    const activeRegistrations = (game.registrations || []).filter(
      (registration: any) =>
        ["WAITLISTED", "REGISTERED", "PAID", "CHECKED_IN"].includes(
          registration.status,
        ),
    );
    const waitlistCount = activeRegistrations.filter(
      (registration: any) => registration.status === "WAITLISTED",
    ).length;
    const refundRequests: any[] = [];
    let cancelledPendingOrders = 0;
    for (const registration of activeRegistrations) {
      const order = orders.find((item) => item.id === registration.orderId);
      const previousStatus = registration.status;
      registration.status = "CANCELLED";
      registration.checkedInAt = null;
      registration.cancelledAt = now.toISOString();
      if (!order) continue;
      if (order.status === "PENDING") {
        order.status = "CANCELLED";
        order.cancelledAt = now.toISOString();
        order.paymentStatus = ["CREATED", "PROCESSING", "FAILED"].includes(
          order.paymentStatus,
        )
          ? "CLOSED"
          : order.paymentStatus;
        cancelledPendingOrders += 1;
        continue;
      }
      const activeRefunds = (order.refunds || []).filter((refund: any) =>
        ["REQUESTED", "APPROVED", "PROCESSING"].includes(refund.status),
      );
      const activeRefundCents = activeRefunds.reduce(
        (sum: number, refund: any) => sum + Number(refund.amountCents || 0),
        0,
      );
      const amountCents = Math.max(
        0,
        Number(order.paidCents || 0) -
          Number(order.refundedCents || 0) -
          activeRefundCents,
      );
      if (amountCents <= 0) continue;
      const originalOrderStatus =
        Number(order.refundedCents || 0) > 0
          ? "PARTIALLY_REFUNDED"
          : order.status === "REFUND_PENDING"
            ? activeRefunds[0]?.originalOrderStatus
            : order.status;
      if (
        !["PAID", "CHECKED_IN", "COMPLETED", "PARTIALLY_REFUNDED"].includes(
          originalOrderStatus,
        )
      )
        throw new Error("球局取消退款缺少原订单状态证据");
      const refund = {
        id: newId("refund"),
        refundNo: newOrderNo("RF"),
        idempotencyKey: `GAME_CANCEL:${game.id}:${order.id}`,
        orderId: order.id,
        requestedById: mockUser().id,
        amountCents,
        reason: `球局取消：${reason}`,
        status: "REQUESTED",
        originalOrderStatus,
        requestedAt: now.toISOString(),
      };
      order.refunds = [...(order.refunds || []), refund];
      order.status = "REFUND_PENDING";
      refundRequests.push(refund);
      saveAuditLogs([
        {
          id: newId("audit"),
          actorId: mockUser().id,
          actorRole: mockUser().primaryRole,
          action: "GAME_CANCELLATION_REFUND_REQUESTED",
          objectType: "Refund",
          objectId: refund.id,
          reason,
          result: "SUCCESS",
          newValue: {
            gameId: game.id,
            registrationId: registration.id,
            previousStatus,
          },
          createdAt: now.toISOString(),
        },
        ...getAuditLogs(),
      ]);
    }
    const cancelPolicySnapshot = {
      version: 1,
      decidedAt: now.toISOString(),
      eligibility: "FULL_REMAINING_PAID_AMOUNT",
      approvalRequired: true,
      approvalRoles: ["FINANCE", "ADMIN", "SUPER_ADMIN"],
      actorScope: game.hostId === mockUser().id ? "HOST_OWNER" : "ADMIN",
      registrationCount: activeRegistrations.length,
      pendingOrderCount: cancelledPendingOrders,
      waitlistCount,
      refundRequestCount: refundRequests.length,
      refundRequestedCents: refundRequests.reduce(
        (sum, refund) => sum + Number(refund.amountCents || 0),
        0,
      ),
    };
    Object.assign(game, {
      status: "CANCELLED",
      cancelReason: reason,
      cancelPolicySnapshot,
      cancelIdempotencyKey: idempotencyKey,
      cancelCommandHash: commandHash,
      cancelledById: mockUser().id,
      cancelledAt: now.toISOString(),
    });
    const bookings = getVenueBookings();
    let cancelledBookingCount = 0;
    bookings.forEach((booking) => {
      if (booking.gameId === game.id && booking.status !== "CANCELLED") {
        booking.status = "CANCELLED";
        cancelledBookingCount += 1;
      }
    });
    saveVenueBookings(bookings);
    saveOrders(orders);
    saveGames(games);
    saveAuditLogs([
      {
        id: newId("audit"),
        actorId: mockUser().id,
        actorRole: mockUser().primaryRole,
        action: "GAME_CANCELLED",
        objectType: "Game",
        objectId: game.id,
        reason,
        requestId: idempotencyKey,
        result: "SUCCESS",
        newValue: { status: "CANCELLED", commandHash, cancelPolicySnapshot },
        createdAt: now.toISOString(),
      },
      ...getAuditLogs(),
    ]);
    return {
      handled: true,
      value: ok(
        gameCancellationResponse({
          game,
          cancelledBookingCount,
          cancelledPendingOrders,
          cancelledRegistrationIds: activeRegistrations.map(
            (item: any) => item.id,
          ),
          refundRequests,
        }),
      ),
    };
  }
  return { handled: false };
}

export async function handleCompleteGamePost(
  method: string,
  url: string,
  data: any,
  options: MockRouteOptions,
): Promise<MockRouteResult> {
  const completeGameMatch = url.match(/^\/games\/([^/]+)\/complete$/);
  if (completeGameMatch && method === "POST") {
    requireMockRole("HOST", "ADMIN", "SUPER_ADMIN");
    const list = getGames();
    const game = list.find((item) => item.id === completeGameMatch[1]);
    if (!game) throw new Error("球局不存在");
    const actorIsHost =
      hasMockRole("HOST") && !hasMockRole("ADMIN", "SUPER_ADMIN");
    if (actorIsHost && game.hostId && game.hostId !== mockUser().id)
      throw new Error("主理人只能结束自己负责的球局");
    if (game.status === "COMPLETED")
      return {
        handled: true,
        value: ok({
          checkedIn:
            Number(game.hostReward?.basisCount) ||
            (game.registrations || []).filter(
              (item: any) => item.status === "COMPLETED",
            ).length,
          reward: game.hostReward || null,
        }),
      };
    if (!["OPEN", "FULL", "IN_PROGRESS"].includes(game.status))
      throw new Error(`当前球局状态为 ${game.status}，不允许结束`);
    const endsAt = new Date(String(game.endsAt || ""));
    if (Number.isNaN(endsAt.getTime()))
      throw new Error("球局结束时间无效，不能结束并结算");
    if (endsAt > new Date()) throw new Error("球局尚未结束，不能结束并结算");
    const orders = getOrders();
    if (
      (game.registrations || []).some((registration: any) => {
        const order = orders.find((item) => item.id === registration.orderId);
        return order?.status === "REFUND_PENDING";
      })
    )
      throw new Error("球局存在等待退款审批的订单，请先处理退款后再结束");
    const completedAt = new Date().toISOString();
    for (const registration of game.registrations || []) {
      const previousStatus = registration.status;
      const order = orders.find((item) => item.id === registration.orderId);
      let outcome: string | null = null;
      if (
        previousStatus === "CHECKED_IN" &&
        (!order || !["REFUNDED", "CANCELLED"].includes(order.status))
      )
        outcome = "COMPLETED";
      else if (
        previousStatus === "PAID" &&
        (!order ||
          !["REFUND_PENDING", "REFUNDED", "CANCELLED"].includes(order.status))
      )
        outcome = "NO_SHOW";
      else if (["REGISTERED", "WAITLISTED"].includes(previousStatus))
        outcome = "CANCELLED";
      if (!outcome) continue;
      registration.status = outcome;
      if (previousStatus === "REGISTERED" && order?.status === "PENDING") {
        order.status = "CANCELLED";
        order.cancelledAt = completedAt;
      } else if (order && ["COMPLETED", "NO_SHOW"].includes(outcome)) {
        order.completedAt = order.completedAt || completedAt;
        order.fulfillmentOutcome = outcome;
        if (!["REFUND_PENDING", "PARTIALLY_REFUNDED"].includes(order.status))
          order.status = "COMPLETED";
      }
    }
    const checkedIn = (game.registrations || []).filter(
      (item: any) => item.status === "COMPLETED",
    ).length;
    game.status = "COMPLETED";
    game.hostReward = game.hostReward || {
      basisCount: checkedIn,
      rewardType: "BADMINTON_COIN",
      amount: Math.min(checkedIn * 20, 500),
      status: "PENDING_OBSERVATION",
    };
    const bookings = getVenueBookings();
    bookings.forEach((booking) => {
      if (booking.gameId === game.id && booking.status !== "CANCELLED")
        booking.status = "COMPLETED";
    });
    saveVenueBookings(bookings);
    saveOrders(orders);
    saveGames(list);
    return { handled: true, value: ok({ checkedIn, reward: game.hostReward }) };
  }
  return { handled: false };
}
