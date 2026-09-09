import { mockUser } from "../../core";
import { getOrders, saveOrders } from "../../venue";
import { getEnrollments } from "../../state";
import {
  ok,
  hasMockRole,
  requireIdempotencyKey,
  newId,
} from "../../policies/common.js";
import {
  assertMockRefundOriginIsConsistent,
  mockRefundCommandResponse,
} from "../../policies/orders.js";
import { requireMockOpenFrontDeskShift } from "../../policies/front-desk.js";
import type { MockRouteResult, MockRouteOptions } from "../route-contract.js";

export async function handleRefundPost(
  method: string,
  url: string,
  data: any,
  options: MockRouteOptions,
): Promise<MockRouteResult> {
  const refundMatch = url.match(/^\/orders\/([^/]+)\/refunds$/);
  if (refundMatch && method === "POST") {
    const orders = getOrders();
    const order = orders.find((item) => item.id === refundMatch[1]);
    if (!order) throw new Error("订单不存在");
    const assistedRefund = Boolean(
      order.memberId && order.memberId !== mockUser().id,
    );
    if (assistedRefund && !hasMockRole("FRONT_DESK", "ADMIN", "SUPER_ADMIN"))
      throw new Error("仅会员本人、前台或管理员可申请退款");
    const amountCents = Number(
      data.amountCents ??
        Number(order.paidCents || 0) - Number(order.refundedCents || 0),
    );
    if (!Number.isInteger(amountCents) || amountCents <= 0)
      throw new Error("退款金额必须为正整数");
    const reason = String(data.reason || "前台服务申请退款").trim();
    if (reason.length < 2) throw new Error("退款原因至少需要2个字");
    const idempotency = data.idempotencyKey
      ? requireIdempotencyKey(data.idempotencyKey, "退款幂等键")
      : `refund:${order.id}:${amountCents}:${reason}`;
    const existing = orders
      .flatMap((item) => item.refunds || [])
      .find((refund: any) => refund.idempotencyKey === idempotency);
    if (existing) {
      if (existing.orderId && existing.orderId !== order.id)
        throw new Error("幂等键已用于其他订单");
      if (
        Number(existing.amountCents) !== amountCents ||
        existing.reason !== reason
      )
        throw new Error("退款幂等键已用于不同的退款内容");
      return { handled: true, value: ok(mockRefundCommandResponse(existing)) };
    }
    if (
      !["PAID", "CHECKED_IN", "COMPLETED", "PARTIALLY_REFUNDED"].includes(
        order.status,
      )
    )
      throw new Error("订单当前状态不可退款");
    assertMockRefundOriginIsConsistent(
      order.status,
      order.completedAt,
      order.refundedCents,
    );
    if (
      amountCents + Number(order.refundedCents || 0) >
      Number(order.paidCents || 0)
    )
      throw new Error("退款金额超过可退余额");
    const pendingAmount = (order.refunds || [])
      .filter((item: any) =>
        ["REQUESTED", "APPROVED", "PROCESSING"].includes(item.status),
      )
      .reduce(
        (sum: number, item: any) => sum + Number(item.amountCents || 0),
        0,
      );
    if (
      amountCents + Number(order.refundedCents || 0) + pendingAmount >
      Number(order.paidCents || 0)
    )
      throw new Error("退款金额超过剩余可退金额（含待审批退款）");
    if (
      order.businessType === "GOODS" &&
      amountCents !==
        Number(order.paidCents || 0) - Number(order.refundedCents || 0)
    )
      throw new Error("商品订单需整单退货，暂不支持金额型部分退款");
    if (order.businessType === "TRAINING") {
      const enrollment = getEnrollments().find(
        (item) =>
          item.orderId === order.id || item.id === order.trainingEnrollmentId,
      );
      if (!enrollment) throw new Error("培训订单缺少报名与预收账本");
      if (
        amountCents >
        Number(enrollment.prepaidBalanceCents || 0) - pendingAmount
      ) {
        throw new Error(
          "退款金额超过未消课预收余额；已消课收入须先走消课冲正流程",
        );
      }
    }
    const refundShift = assistedRefund ? requireMockOpenFrontDeskShift() : null;
    const refund = {
      id: newId("refund"),
      orderId: order.id,
      refundNo: `RF${Date.now()}`,
      idempotencyKey: idempotency,
      status: "REQUESTED",
      amountCents,
      reason,
      originalOrderStatus: order.status,
      requestedById: mockUser().id,
      requestedAt: new Date().toISOString(),
      frontDeskShiftId: refundShift?.id || null,
      adminEmergencyBypass: assistedRefund && !refundShift,
    };
    order.status = "REFUND_PENDING";
    order.refunds = [...(order.refunds || []), refund];
    saveOrders(orders);
    return { handled: true, value: ok(mockRefundCommandResponse(refund)) };
  }
  return { handled: false };
}
