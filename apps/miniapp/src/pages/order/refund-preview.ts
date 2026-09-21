import type { OrderView } from "@yanqing/shared";

export function refundDestination(order: OrderView) {
  const channels = [
    ...new Set(
      (order.payments || [])
        .filter((p) => p.status === "SUCCEEDED")
        .map((p) => p.channel),
    ),
  ];
  if (!channels.length && order.paymentChannel)
    channels.push(order.paymentChannel);
  const cash = channels.includes("OFFLINE_CASH");
  const labels: Record<string, string> = {
    WECHAT: "微信原路退回",
    OFFLINE_CASH: "现场退回现金",
    CASH_PRINCIPAL: "退回本金余额",
    GIFT_BALANCE: "退回赠送余额",
    BADMINTON_COIN: "退回羽毛币",
  };
  return {
    cash,
    label:
      channels
        .map((channel) => labels[channel] || "按原支付方式退回")
        .join("、") || "按原支付方式退回",
  };
}
