import type { OrderView } from "@yanqing/shared";
import { shortDate, dateTimeRange } from "../../utils/format";
const businessTypeLabel: Record<string, string> = {
  VENUE: "场地预订",
  GAME: "拼场球局",
  EVENT: "赛事报名",
  TRAINING: "培训课程",
  MEMBERSHIP: "会员开通",
  RECHARGE: "账户充值",
  GOODS: "商品购买",
  COUPON: "卡券权益",
};
export const businessTypeIcon: Record<string, string> = {
  VENUE: "venue",
  GAME: "sport",
  EVENT: "event",
  TRAINING: "training",
  MEMBERSHIP: "members",
  RECHARGE: "finance",
  GOODS: "shop",
  COUPON: "ticket",
};
export const displayBusinessType = (value?: string) =>
  businessTypeLabel[value || ""] || "其他消费";
export const paymentDeadline = (order: OrderView) =>
  order.paymentExpiresAt || order.eventTeam?.paymentDueAt || null;
export const deadlineExpired = (order: OrderView, now: number) => {
  const deadline = paymentDeadline(order);
  return Boolean(deadline && new Date(deadline).getTime() <= now);
};
export function paymentCountdown(order: OrderView, now: number) {
  const deadline = paymentDeadline(order);
  if (!deadline)
    return order.payableCents === 0 ? "请尽快确认订单" : "请尽快完成支付";
  const remainingSeconds = Math.max(
    0,
    Math.ceil((new Date(deadline).getTime() - now) / 1000),
  );
  if (!remainingSeconds) return "保留时间已到，正在同步订单状态";
  const minutes = Math.floor(remainingSeconds / 60);
  const seconds = String(remainingSeconds % 60).padStart(2, "0");
  return `${order.payableCents === 0 ? "确认" : "支付"}剩余 ${minutes}:${seconds}`;
}
export function orderTimeLabel(order: OrderView) {
  const booking = order.bookings?.[0];
  const game = order.gameRegistration?.game;
  const event = order.eventTeam?.event;
  const start = booking?.startsAt || game?.startsAt || event?.startsAt;
  const end = booking?.endsAt || game?.endsAt;
  if (!start) return `下单 ${shortDate(order.createdAt)}`;
  return `使用时间 ${dateTimeRange(start, end)}`;
}
export const refundableAmount = (order: OrderView) =>
  Math.max(
    0,
    Number(order.paidCents ?? order.payableCents ?? 0) -
      Number(order.refundedCents || 0),
  );
export const refundStatusLabels: Record<string, string> = {
  REQUESTED: "待审核",
  PENDING: "待审核",
  APPROVED: "已通过",
  PROCESSING: "处理中",
  SUCCEEDED: "已退款",
  REJECTED: "未通过",
  FAILED: "处理失败",
  CANCELLED: "已撤回",
};

export const canRequestOrderRefund = (order: OrderView) =>
  !["EVENT", "TRAINING"].includes(order.businessType) &&
  ["PAID", "CHECKED_IN", "COMPLETED", "PARTIALLY_REFUNDED"].includes(
    order.status,
  ) &&
  refundableAmount(order) > 0;
