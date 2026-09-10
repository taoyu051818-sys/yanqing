import { computed, ref } from "vue";
import type { OrderView, PaymentChannel, PaymentQuote } from "@yanqing/shared";
import { endpoints } from "../../services/api";
import { isMockMode } from "../../services/http";
import { createPaymentConfirmation } from "../../utils/payment-confirmation";
import { apiFeedback } from "../../services/api-feedback";
import { withPendingCreationKey } from "../../utils/pending-creation-key";
import { money } from "../../utils/format";
import type { OrderList } from "./use-order-list";
import type { OrderActionScope } from "./order-action-scope";
import { orderFailure } from "./order-errors";

export function useOrderPayment(
  scope: OrderActionScope,
  orders: Pick<OrderList, "load" | "replaceOrder">,
  session: { hydrate: () => Promise<unknown> },
  deadlineExpired: (order: OrderView) => boolean,
) {
  const { actionKey } = scope;
  const load = () => orders.load();
  const payingId = ref("");
  const paymentChannel = ref<PaymentChannel | "">("WECHAT");
  const paymentError = ref("");
  const paymentQuote = ref<PaymentQuote | null>(null);
  const balanceLoading = ref(false);
  let quoteGeneration = 0;
  const confirmation = createPaymentConfirmation(
    endpoints.order,
    async (order) => {
      const current = scope.capture();
      if (!current()) return;
      orders.replaceOrder(order);
      await load();
      if (current()) await session.hydrate();
    },
  );
  const paymentConfirmation = confirmation.state;
  let canWechatPay = isMockMode;
  // #ifdef MP-WEIXIN
  canWechatPay = true;
  // #endif
  const paymentLabels: Record<PaymentChannel, string> = {
    WECHAT: isMockMode ? "微信支付（模拟）" : "微信支付",
    CASH_PRINCIPAL: "充值余额",
    GIFT_BALANCE: "赠送余额",
    BADMINTON_COIN: "羽毛球币",
    OFFLINE_CASH: "线下现金",
    COUPON: "优惠券",
  };
  const freeConfirmation = computed(
    () => paymentQuote.value?.payableCents === 0,
  );
  const paymentChoices = computed<
    Array<{
      channel: PaymentChannel;
      label: string;
      note: string;
      disabled: boolean;
      debitAmount: number;
    }>
  >(() =>
    (paymentQuote.value?.options || []).map((option) => {
      if (freeConfirmation.value)
        return {
          channel: option.channel,
          debitAmount: 0,
          label: "免费确认",
          note: option.reason || "本订单无需付款，确认后即可生效",
          disabled: !option.enabled,
        };
      const coin = option.unit === "COIN";
      const wechat = option.channel === "WECHAT";
      const balance = coin
        ? option.availableBalance + " 币"
        : money(option.availableBalance);
      const amount = coin
        ? option.debitAmount + " 币"
        : money(option.debitAmount);
      return {
        channel: option.channel,
        debitAmount: option.debitAmount,
        label: paymentLabels[option.channel],
        note:
          option.reason ||
          (wechat
            ? isMockMode
              ? "仅演示，不扣真实资金"
              : canWechatPay
                ? "确认后调起微信支付"
                : "请在微信小程序内完成微信支付"
            : "可用 " + balance + " · 本次扣除 " + amount),
        disabled: !option.enabled || (wechat && !canWechatPay),
      };
    }),
  );
  async function preparePay(order: OrderView) {
    if (
      actionKey.value ||
      balanceLoading.value ||
      paymentConfirmation.value?.orderId === order.id
    )
      return;
    const current = scope.capture();
    if (!current()) return;
    const run = ++quoteGeneration;
    payingId.value = order.id;
    paymentChannel.value = "WECHAT";
    paymentError.value = "";
    paymentQuote.value = null;
    balanceLoading.value = true;
    try {
      const quote = await endpoints.paymentOptions(order.id);
      if (!current() || run !== quoteGeneration || payingId.value !== order.id)
        return;
      paymentQuote.value = quote;
      paymentChannel.value =
        paymentChoices.value.find((item) => !item.disabled)?.channel || "";
    } catch (cause: unknown) {
      if (!current() || run !== quoteGeneration) return;
      const failure = orderFailure(cause);
      paymentError.value = apiFeedback(failure.message, failure.statusCode);
    } finally {
      if (run === quoteGeneration) balanceLoading.value = false;
    }
  }
  async function pay(order: OrderView) {
    if (
      actionKey.value ||
      paymentConfirmation.value?.orderId === order.id ||
      deadlineExpired(order) ||
      order.status !== "PENDING" ||
      payingId.value !== order.id ||
      balanceLoading.value ||
      paymentQuote.value?.orderId !== order.id
    )
      return;
    let nativePaymentStarted = false;
    const channel = paymentChannel.value;
    if (
      !paymentChoices.value.some(
        (item) => item.channel === channel && !item.disabled,
      )
    )
      return;
    const action = scope.begin(`pay:${order.id}`);
    if (!action) return;
    paymentError.value = "";
    try {
      const payment = await withPendingCreationKey(
        "order.payment",
        {
          orderId: order.id,
          channel,
          expectedDebitAmount: paymentQuote.value?.options.find(
            (item) => item.channel === channel,
          )?.debitAmount,
        },
        (idempotencyKey) =>
          endpoints.payOrder(order.id, {
            channel,
            idempotencyKey,
            expectedDebitAmount: paymentQuote.value?.options.find(
              (item) => item.channel === channel,
            )?.debitAmount,
          }),
      );
      if (!action.isCurrent()) return;
      const wechatPay = payment.wechatPay;
      if (!isMockMode && channel === "WECHAT" && wechatPay) {
        nativePaymentStarted = true;
        await uni.requestPayment({ provider: "wxpay", ...wechatPay });
        if (!action.isCurrent()) return;
        uni.showToast({ title: "支付结果确认中", icon: "success" });
      } else {
        uni.showToast({
          title:
            payment.status === "SUCCEEDED"
              ? order.payableCents === 0
                ? "订单确认成功"
                : "支付成功"
              : "正在同步支付结果",
          icon: "none",
        });
      }
      payingId.value = "";
      if (
        !isMockMode &&
        channel === "WECHAT" &&
        payment.status === "PROCESSING"
      ) {
        confirmation.start(order.id);
        return;
      }
      await load();
      if (action.isCurrent()) await session.hydrate();
    } catch (cause: unknown) {
      if (!action.isCurrent()) return;
      const failure = orderFailure(cause);
      if (nativePaymentStarted && !/cancel/.test(failure.errMsg)) {
        payingId.value = "";
        confirmation.start(order.id);
      }
      paymentError.value = /cancel/.test(failure.errMsg)
        ? "你已取消付款，订单仍保留，可稍后重试。"
        : apiFeedback(failure.message, failure.statusCode);
    } finally {
      action.finish();
    }
  }

  function reset() {
    quoteGeneration++;
    confirmation.stop();
    payingId.value = "";
    paymentChannel.value = "WECHAT";
    paymentQuote.value = null;
    paymentError.value = "";
    balanceLoading.value = false;
  }
  return {
    payingId,
    paymentChannel,
    paymentError,
    paymentQuote,
    balanceLoading,
    freeConfirmation,
    paymentChoices,
    confirmation,
    paymentConfirmation,
    preparePay,
    pay,
    reset,
  };
}
