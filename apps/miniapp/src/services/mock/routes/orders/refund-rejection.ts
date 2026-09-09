import { mockUser } from "../../core";
import { getOrders, saveOrders } from "../../venue";
import { saveEventDetail } from "../../state";
import { ok, requireMockRole, text } from "../../policies/common.js";
import {
  assertMockRefundOriginIsConsistent,
  mockRefundCommandResponse,
} from "../../policies/orders.js";
import { requireEvent } from "../../policies/events.js";
import type { MockRouteResult, MockRouteOptions } from "../route-contract.js";

export async function handleRejectRefundPost(
  method: string,
  url: string,
  data: any,
  options: MockRouteOptions,
): Promise<MockRouteResult> {
  const rejectRefundMatch = url.match(/^\/orders\/refunds\/([^/]+)\/reject$/);
  if (rejectRefundMatch && method === "POST") {
    requireMockRole("FINANCE", "ADMIN", "SUPER_ADMIN");
    const orders = getOrders();
    const order = orders.find((item) =>
      item.refunds?.some((refund: any) => refund.id === rejectRefundMatch[1]),
    );
    const refund = order?.refunds?.find(
      (item: any) => item.id === rejectRefundMatch[1],
    );
    if (!order || !refund) throw new Error("退款申请不存在");
    if (refund.requestedById === mockUser().id)
      throw new Error("退款申请人与审批人不能是同一账号");
    if (refund.status === "REJECTED")
      return { handled: true, value: ok(mockRefundCommandResponse(refund)) };
    if (!["REQUESTED", "REFUND_PENDING"].includes(refund.status))
      throw new Error("当前退款状态不能驳回");
    if (
      ["GAME_CANCEL:", "EVENT_CANCEL:", "EVENT_LATE_PAYMENT:"].some((prefix) =>
        String(refund.idempotencyKey || "").startsWith(prefix),
      )
    )
      throw new Error("系统强制退款不可驳回，请完成审批并原路退回");
    const rejectionReason = text(data.reason) || "审核未通过";
    if (rejectionReason.length < 2) throw new Error("驳回原因至少需要2个字");
    if (
      !["PAID", "CHECKED_IN", "COMPLETED", "PARTIALLY_REFUNDED"].includes(
        refund.originalOrderStatus,
      )
    )
      throw new Error("退款缺少原订单状态证据");
    refund.status = "REJECTED";
    refund.approvedAt = new Date().toISOString();
    refund.rejectionReason = rejectionReason;
    const hasPending = (order.refunds || []).some((item: any) =>
      ["REQUESTED", "APPROVED", "PROCESSING"].includes(item.status),
    );
    if (hasPending) {
      order.status = "REFUND_PENDING";
    } else {
      const restoredStatus =
        Number(order.refundedCents || 0) > 0
          ? "PARTIALLY_REFUNDED"
          : refund.originalOrderStatus;
      assertMockRefundOriginIsConsistent(
        restoredStatus,
        order.completedAt,
        order.refundedCents,
      );
      order.status = restoredStatus;
    }
    if (order.businessType === "EVENT") {
      const eventId = order.eventId || order.parameterSnapshot?.eventId;
      if (eventId) {
        const detail = requireEvent(eventId);
        const team = (detail.teams || []).find(
          (item: any) =>
            item.id ===
              (order.eventTeamId || order.parameterSnapshot?.eventTeamId) ||
            item.orderId === order.id,
        );
        if (
          team?.cancellationPending &&
          refund.idempotencyKey ===
            `EVENT_TEAM_CANCEL:${team.id}:${team.cancelIdempotencyKey}`
        ) {
          team.cancellationPending = false;
          team.cancellationResolvedAt = new Date().toISOString();
          saveEventDetail(detail);
        }
      }
    }
    saveOrders(orders);
    return { handled: true, value: ok(mockRefundCommandResponse(refund)) };
  }
  return { handled: false };
}
