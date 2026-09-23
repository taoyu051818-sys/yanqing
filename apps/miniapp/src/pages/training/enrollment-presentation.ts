import type { TrainingEnrollmentView, OrderView } from "@yanqing/shared";
import { money } from "../../utils/format";

export const consumed = (item: TrainingEnrollmentView) =>
  Number(item.consumedSessions ?? 0);
export const refundedCents = (item: TrainingEnrollmentView) =>
  Number(item.refundedCents || 0);
export const unusedPrepaidCents = (item: TrainingEnrollmentView) =>
  Number(item.prepaidBalanceCents || 0);
export const confirmedRevenueCents = (item: TrainingEnrollmentView) => {
  if (
    item.confirmedRevenueCents !== undefined &&
    item.confirmedRevenueCents !== null
  ) {
    return Number(item.confirmedRevenueCents);
  }
  const contractAmount = Number(
    item.totalAmountCents ?? item.product?.priceCents ?? 0,
  );
  return Math.max(
    0,
    contractAmount - unusedPrepaidCents(item) - refundedCents(item),
  );
};
export const receivedPrepaidCents = (item: TrainingEnrollmentView) => {
  if (item.status === "PENDING_PAYMENT") return 0;
  return (
    confirmedRevenueCents(item) + unusedPrepaidCents(item) + refundedCents(item)
  );
};
export const canRequestRefund = (item: TrainingEnrollmentView) =>
  Boolean(item.orderId) &&
  unusedPrepaidCents(item) > 0 &&
  ["ACTIVE", "PARTIALLY_REFUNDED"].includes(String(item.status));
const paymentLabels: Record<string, string> = {
  WECHAT: "微信支付",
  OFFLINE_CASH: "线下现金",
  CASH_PRINCIPAL: "现金本金账户",
  GIFT_BALANCE: "赠送余额",
  BADMINTON_COIN: "羽球币",
  COUPON: "优惠券",
};
export const paymentComposition = (order: OrderView) => {
  const payments = (Array.isArray(order.payments) ? order.payments : [])
    .filter((payment) =>
      ["SUCCEEDED", "REFUNDED"].includes(String(payment.status)),
    )
    .map(
      (payment) =>
        `${paymentLabels[payment.channel] || payment.channel} ${money(payment.amountCents)}`,
    );
  if (payments.length) return payments.join(" + ");
  const channel = order.paymentChannel;
  return channel ? paymentLabels[channel] || channel : "以原支付渠道为准";
};
