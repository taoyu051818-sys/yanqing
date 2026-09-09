import { mockUser } from "../../core";
import { getOrders, saveOrders } from "../../venue";
import { getAuditLogs, saveEventDetail, saveAuditLogs } from "../../state";
import {
  ok,
  mockRoles,
  requireMockRole,
  text,
  requireIdempotencyKey,
  newId,
  creationCommandHash,
} from "../../policies/common.js";
import { newOrderNo } from "../../policies/orders.js";
import {
  activeTeamStatuses,
  requireEvent,
  eventCancellationResponse,
} from "../../policies/events.js";
import type { MockRouteResult, MockRouteOptions } from "../route-contract.js";

export async function handleCancelEventPost(
  method: string,
  url: string,
  data: any,
  options: MockRouteOptions,
): Promise<MockRouteResult> {
  const cancelEventMatch = url.match(/^\/events\/([^/]+)\/cancel$/);
  if (cancelEventMatch && method === "POST") {
    requireMockRole("EVENT_MANAGER", "ADMIN", "SUPER_ADMIN");
    const detail = requireEvent(cancelEventMatch[1]);
    const reason = text(data.reason);
    if (reason.length < 2) throw new Error("取消原因至少2个字");
    const idempotencyKey = requireIdempotencyKey(
      data.idempotencyKey,
      "赛事取消幂等键",
    );
    const commandHash = creationCommandHash({
      kind: "EVENT_CANCEL",
      eventId: detail.id,
      reason,
      actorId: mockUser().id,
    });
    const requestId = `EVENT_CANCEL:${idempotencyKey}`;
    const replay = getAuditLogs().find(
      (entry) => entry.requestId === requestId,
    );
    if (replay) {
      if (
        replay.objectId !== detail.id ||
        replay.actorId !== mockUser().id ||
        replay.newValue?.commandHash !== commandHash
      )
        throw new Error("赛事取消幂等键已用于不同命令");
      return {
        handled: true,
        value: ok(
          eventCancellationResponse({ event: detail, idempotent: true }),
        ),
      };
    }
    if (!["DRAFT", "OPEN", "FULL"].includes(detail.status))
      throw new Error(`赛事当前状态为 ${detail.status}，不可取消`);
    const oldStatus = detail.status;
    const now = new Date();
    if (new Date(detail.startsAt) <= now)
      throw new Error("赛事已开赛，不能执行开赛前取消");
    const orders = getOrders();
    const refundRequests: any[] = [];
    let cancelledPendingOrders = 0;
    let cancelledWaitlist = 0;
    (detail.teams || []).forEach((team: any) => {
      if (![...activeTeamStatuses, "WAITLISTED"].includes(team.status)) return;
      if (team.status === "WAITLISTED") cancelledWaitlist += 1;
      const order = orders.find((item) => item.id === team.orderId);
      if (order?.status === "PENDING") {
        order.status = "CANCELLED";
        order.cancelledAt = now.toISOString();
        cancelledPendingOrders += 1;
      } else if (
        order &&
        Number(order.paidCents || 0) > Number(order.refundedCents || 0)
      ) {
        const activePending = (order.refunds || [])
          .filter((refund: any) =>
            ["REQUESTED", "APPROVED", "PROCESSING"].includes(refund.status),
          )
          .reduce(
            (sum: number, refund: any) => sum + Number(refund.amountCents || 0),
            0,
          );
        const amountCents = Math.max(
          0,
          Number(order.paidCents || 0) -
            Number(order.refundedCents || 0) -
            activePending,
        );
        if (amountCents > 0) {
          const originalOrderStatus =
            Number(order.refundedCents || 0) > 0
              ? "PARTIALLY_REFUNDED"
              : order.status === "REFUND_PENDING"
                ? (order.refunds || []).find((item: any) =>
                    ["REQUESTED", "APPROVED", "PROCESSING"].includes(
                      item.status,
                    ),
                  )?.originalOrderStatus
                : order.status;
          if (
            !["PAID", "CHECKED_IN", "COMPLETED", "PARTIALLY_REFUNDED"].includes(
              originalOrderStatus,
            )
          )
            throw new Error("赛事退款缺少原订单状态证据");
          const refund = {
            id: newId("refund"),
            refundNo: newOrderNo("RF"),
            idempotencyKey: `EVENT_CANCEL:${detail.id}:${order.id}`,
            orderId: order.id,
            requestedById: mockUser().id,
            amountCents,
            reason: `赛事取消：${reason}`,
            status: "REQUESTED",
            originalOrderStatus,
            requestedAt: now.toISOString(),
          };
          order.refunds = [...(order.refunds || []), refund];
          order.status = "REFUND_PENDING";
          refundRequests.push(refund);
        }
      }
      team.status = "CANCELLED";
      team.paymentDueAt = null;
      team.cancellationPending = false;
      if (team.cancelRequestedAt)
        team.cancellationResolvedAt =
          team.cancellationResolvedAt || now.toISOString();
      team.cancelledAt = now.toISOString();
    });
    const cancelPolicySnapshot = {
      version: 1,
      decidedAt: now.toISOString(),
      eligibility: "FULL_REMAINING_PAID_AMOUNT",
      approvalRequired: true,
      approvalRoles: ["FINANCE", "ADMIN", "SUPER_ADMIN"],
      cancelledPendingOrders,
      cancelledWaitlist,
      refundRequestCount: refundRequests.length,
      refundRequestedCents: refundRequests.reduce(
        (sum, refund) => sum + Number(refund.amountCents || 0),
        0,
      ),
    };
    Object.assign(detail, {
      status: "CANCELLED",
      cancelReason: reason,
      cancelPolicySnapshot,
      cancelIdempotencyKey: idempotencyKey,
      cancelCommandHash: commandHash,
      cancelledById: mockUser().id,
      cancelledAt: now.toISOString(),
    });
    saveOrders(orders);
    saveEventDetail(detail);
    saveAuditLogs([
      {
        id: newId("audit"),
        actorId: mockUser().id,
        actorRole: mockRoles()[0],
        action: "EVENT_CANCELLED",
        objectType: "Event",
        objectId: detail.id,
        reason,
        requestId,
        oldValue: { status: oldStatus },
        newValue: {
          status: "CANCELLED",
          commandHash,
          cancelPolicySnapshot,
          refundRequestIds: refundRequests.map((refund) => refund.id),
        },
        createdAt: now.toISOString(),
      },
      ...getAuditLogs(),
    ]);
    return {
      handled: true,
      value: ok(
        eventCancellationResponse({
          event: detail,
          cancelledPendingOrders,
          cancelledWaitlist,
          refundRequests,
        }),
      ),
    };
  }
  return { handled: false };
}
