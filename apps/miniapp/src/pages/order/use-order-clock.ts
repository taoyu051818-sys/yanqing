import { ref, type Ref } from "vue";
import type { OrderView } from "@yanqing/shared";
import { deadlineExpired, paymentCountdown } from "./order-presentation";
export function useOrderClock(
  orders: Ref<OrderView[]>,
  refresh: () => Promise<unknown>,
) {
  const nowMs = ref(Date.now());
  let countdownTimer: ReturnType<typeof setInterval> | undefined;
  let expiryRefreshPending = false;
  const isExpired = (order: OrderView) => deadlineExpired(order, nowMs.value);
  const countdown = (order: OrderView) => paymentCountdown(order, nowMs.value);
  function start() {
    if (countdownTimer) clearInterval(countdownTimer);
    nowMs.value = Date.now();
    countdownTimer = setInterval(() => {
      nowMs.value = Date.now();
      if (
        !expiryRefreshPending &&
        orders.value.some(
          (order) => order.status === "PENDING" && isExpired(order),
        )
      ) {
        expiryRefreshPending = true;
        void refresh().finally(() => {
          expiryRefreshPending = false;
        });
      }
    }, 1000);
  }
  function stop() {
    if (countdownTimer) clearInterval(countdownTimer);
    countdownTimer = undefined;
  }
  return {
    nowMs,
    deadlineExpired: isExpired,
    paymentCountdown: countdown,
    start,
    stop,
  };
}
