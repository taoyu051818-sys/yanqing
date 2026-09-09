import { mockUser } from "../../core";
import { getOrders } from "../../venue";
import { ok, hasMockRole, requireMockRole } from "../../policies/common.js";
import { mockOrderResponse } from "../../policies/orders.js";
import type { MockRouteResult, MockRouteOptions } from "../route-contract.js";

export async function handleOrdersAny(
  method: string,
  url: string,
  data: any,
  options: MockRouteOptions,
): Promise<MockRouteResult> {
  if (url === "/orders") {
    const mine = getOrders().filter(
      (order) =>
        (order.memberId === mockUser().id || !order.memberId) &&
        (!data.status || order.status === data.status) &&
        (!data.businessType || order.businessType === data.businessType),
    );
    const page = Math.max(1, Number(data.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(data.pageSize) || 20));
    const sorted = [...mine].sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
    return {
      handled: true,
      value: ok({
        items: sorted
          .slice((page - 1) * pageSize, page * pageSize)
          .map(mockOrderResponse),
        total: mine.length,
        page,
        pageSize,
      }),
    };
  }
  return { handled: false };
}

export async function handleOrdersAdminAllAny(
  method: string,
  url: string,
  data: any,
  options: MockRouteOptions,
): Promise<MockRouteResult> {
  if (url === "/orders/admin/all") {
    requireMockRole("FRONT_DESK", "FINANCE", "ADMIN", "SUPER_ADMIN");
    return {
      handled: true,
      value: ok({
        items: getOrders().map(mockOrderResponse),
        total: getOrders().length,
      }),
    };
  }
  return { handled: false };
}

export async function handleOrderDetailGet(
  method: string,
  url: string,
  data: any,
  options: MockRouteOptions,
): Promise<MockRouteResult> {
  const orderDetailMatch = url.match(/^\/orders\/([^/]+)$/);
  if (orderDetailMatch && method === "GET") {
    const order = getOrders().find((item) => item.id === orderDetailMatch[1]);
    if (!order) throw new Error("订单不存在");
    if (
      order.memberId &&
      order.memberId !== mockUser().id &&
      !hasMockRole("FRONT_DESK", "FINANCE", "ADMIN", "SUPER_ADMIN")
    )
      throw new Error("无权查看该订单");
    return { handled: true, value: ok(mockOrderResponse(order)) };
  }
  return { handled: false };
}
