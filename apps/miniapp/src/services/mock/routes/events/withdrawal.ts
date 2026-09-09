import { mockUser } from "../../core";
import { getOrders, saveOrders } from "../../venue";
import { getAuditLogs, saveEventDetail, saveAuditLogs } from "../../state";
import {
  ok,
  mockRoles,
  hasMockRole,
  text,
  requireIdempotencyKey,
  newId,
  creationCommandHash,
} from "../../policies/common.js";
import { newOrderNo } from "../../policies/orders.js";
import {
  promoteMockEventWaitlist,
  requireEvent,
} from "../../policies/events.js";
import type { MockRouteResult, MockRouteOptions } from "../route-contract.js";

export async function handleCancelEventRegistrationPost(
  method: string,
  url: string,
  data: any,
  options: MockRouteOptions,
): Promise<MockRouteResult> {
  const cancelEventRegistrationMatch = url.match(
    /^\/events\/([^/]+)\/registration\/cancel$/,
  );
  if (cancelEventRegistrationMatch && method === "POST") {
    const detail = requireEvent(cancelEventRegistrationMatch[1]);
    const reason = text(data.reason);
    if (reason.length < 2) throw new Error("退出原因至少2个字");
    const idempotencyKey = requireIdempotencyKey(
      data.idempotencyKey,
      "参赛退出幂等键",
    );
    const requestId = `EVENT_REGISTRATION_CANCEL:${idempotencyKey}`;
    const existingAudit = getAuditLogs().find(
      (entry) => entry.requestId === requestId,
    );
    if (existingAudit) {
      const team = (detail.teams || []).find(
        (item: any) => item.id === existingAudit.objectId,
      );
      const commandHash = creationCommandHash({
        kind: "EVENT_REGISTRATION_CANCEL",
        eventId: detail.id,
        teamId: existingAudit.objectId,
        reason,
        actorId: mockUser().id,
      });
      if (
        !team ||
        existingAudit.actorId !== mockUser().id ||
        existingAudit.newValue?.commandHash !== commandHash
      )
        throw new Error("参赛退出幂等键已用于不同命令");
      const order = getOrders().find((item) => item.id === team.orderId);
      const refund = (order?.refunds || []).find(
        (item: any) =>
          item.idempotencyKey ===
          `EVENT_TEAM_CANCEL:${team.id}:${idempotencyKey}`,
      );
      return {
        handled: true,
        value: ok({
          registration: team,
          refund: refund || null,
          outcome: team.cancellationPending
            ? "REFUND_REQUESTED"
            : refund?.status === "REJECTED"
              ? "REFUND_REJECTED"
              : team.status === "REFUNDED"
                ? "REFUNDED"
                : "CANCELLED",
          idempotent: true,
        }),
      };
    }
    if (!["OPEN", "FULL"].includes(detail.status))
      throw new Error("赛事当前状态不允许退出报名");
    const now = new Date();
    if (new Date(detail.startsAt) <= now)
      throw new Error("赛事已开赛，不能自助退出");
    const manager = hasMockRole("EVENT_MANAGER", "ADMIN", "SUPER_ADMIN");
    const requestedTeamId = text(data.teamId);
    const team = (detail.teams || [])
      .filter((item: any) =>
        ["WAITLISTED", "REGISTERED", "PAID"].includes(item.status),
      )
      .filter((item: any) =>
        manager && requestedTeamId
          ? item.id === requestedTeamId
          : item.captainId === mockUser().id,
      )
      .sort((left: any, right: any) =>
        String(right.createdAt || "").localeCompare(
          String(left.createdAt || ""),
        ),
      )[0];
    if (!team) throw new Error("没有可退出的赛事报名");
    if (team.captainId !== mockUser().id && !manager)
      throw new Error("仅队长或赛事管理员可退出报名");
    if (team.cancelIdempotencyKey)
      throw new Error("该报名已经提交过另一退出命令");
    const commandHash = creationCommandHash({
      kind: "EVENT_REGISTRATION_CANCEL",
      eventId: detail.id,
      teamId: team.id,
      reason,
      actorId: mockUser().id,
    });
    const evidence = {
      cancelReason: reason,
      cancelIdempotencyKey: idempotencyKey,
      cancelCommandHash: commandHash,
      cancelledById: mockUser().id,
      cancelRequestedAt: now.toISOString(),
    };
    const orders = getOrders();
    const order = orders.find((item) => item.id === team.orderId);
    let refund: any = null;
    let promotion: any = null;
    let outcome = "CANCELLED";
    if (["WAITLISTED", "REGISTERED"].includes(team.status)) {
      if (team.status === "REGISTERED" && order?.status !== "PENDING")
        throw new Error("待支付订单状态已变化，请刷新后重试");
      if (order) {
        order.status = "CANCELLED";
        order.cancelledAt = now.toISOString();
      }
      Object.assign(team, evidence, {
        status: "CANCELLED",
        paymentDueAt: null,
        cancellationPending: false,
        cancellationResolvedAt: now.toISOString(),
        cancelledAt: now.toISOString(),
      });
      promotion = promoteMockEventWaitlist(detail, orders, now);
    } else {
      if (!order || order.status !== "PAID")
        throw new Error("已支付订单状态已变化，请刷新后重试");
      if (
        (order.refunds || []).some((item: any) =>
          ["REQUESTED", "APPROVED", "PROCESSING"].includes(item.status),
        )
      )
        throw new Error("订单已有待处理退款，不能重复申请退出");
      const amountCents =
        Number(order.paidCents || 0) - Number(order.refundedCents || 0);
      if (amountCents <= 0) throw new Error("订单已无可退金额");
      Object.assign(team, evidence, {
        cancellationPending: true,
        cancellationResolvedAt: null,
      });
      refund = {
        id: newId("refund"),
        refundNo: newOrderNo("RF"),
        idempotencyKey: `EVENT_TEAM_CANCEL:${team.id}:${idempotencyKey}`,
        orderId: order.id,
        requestedById: mockUser().id,
        amountCents,
        reason: `赛事报名退出：${reason}`,
        status: "REQUESTED",
        originalOrderStatus: order.status,
        requestedAt: now.toISOString(),
      };
      order.refunds = [...(order.refunds || []), refund];
      order.status = "REFUND_PENDING";
      outcome = "REFUND_REQUESTED";
    }
    saveOrders(orders);
    saveEventDetail(detail);
    saveAuditLogs([
      {
        id: newId("audit"),
        actorId: mockUser().id,
        actorRole: mockRoles()[0],
        action:
          outcome === "REFUND_REQUESTED"
            ? "EVENT_REGISTRATION_REFUND_REQUESTED"
            : "EVENT_REGISTRATION_CANCELLED",
        objectType: "EventTeam",
        objectId: team.id,
        reason,
        requestId,
        oldValue: null,
        newValue: {
          commandHash,
          outcome,
          refundId: refund?.id || null,
          promotedTeamIds:
            promotion?.promotions?.map((item: any) => item.registration.id) ||
            [],
        },
        createdAt: now.toISOString(),
      },
      ...getAuditLogs(),
    ]);
    return {
      handled: true,
      value: ok({ registration: team, refund, outcome, promotion }),
    };
  }
  return { handled: false };
}
