import { ref } from "vue";
import {
  captureAuthSession,
  isAuthSessionCurrent,
} from "../services/auth-session";

import type { OrderView } from "@yanqing/shared";
type CancellableOrder = Partial<
  Pick<
    OrderView,
    | "businessType"
    | "status"
    | "payableCents"
    | "paidCents"
    | "refundedCents"
    | "completedAt"
  >
> & { bookings?: Array<{ status: string; startsAt: string }> };
const MAX_ATTEMPTS = 15;
const INTERVAL_MS = 2000;

/** Read the server's result; native payment success alone is not an order status. */
export function createPaymentConfirmation<T extends { status: string }>(
  fetchOrder: (id: string) => Promise<T>,
  onResult: (order: T) => void | Promise<void>,
) {
  const state = ref<{
    orderId: string;
    checking: boolean;
    message: string;
  } | null>(null);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let generation = 0;
  let paused = false;
  let owner = captureAuthSession();
  function stop(clear = true) {
    generation++;
    clearTimeout(timer);
    timer = undefined;
    if (clear) state.value = null;
    else if (state.value) state.value.checking = false;
  }
  function start(orderId: string) {
    stop();
    owner = captureAuthSession();
    const run = generation;
    state.value = {
      orderId,
      checking: !paused,
      message: "支付已提交，正在确认订单状态，请勿重复付款。",
    };
    if (paused) return;
    let attempts = 0;
    const current = () =>
      run === generation && !paused && isAuthSessionCurrent(owner);
    const check = async () => {
      if (!current()) {
        if (run === generation) stop();
        return;
      }
      attempts++;
      try {
        const order = await fetchOrder(orderId);
        if (!current()) {
          if (run === generation) stop();
          return;
        }
        if (order.status !== "PENDING") {
          stop();
          await onResult(order);
          return;
        }
      } catch {
        if (!current()) {
          if (run === generation) stop();
          return;
        }
      }
      if (attempts >= MAX_ATTEMPTS) {
        state.value = {
          orderId,
          checking: false,
          message:
            "支付结果暂未确认。请重新查询，或联系前台核对，请勿重复付款。",
        };
      } else
        timer = setTimeout(() => {
          void check();
        }, INTERVAL_MS);
    };
    void check();
  }
  function pause() {
    paused = true;
    stop(false);
  }
  function resume() {
    paused = false;
    if (!isAuthSessionCurrent(owner)) {
      stop();
      return;
    }
    if (state.value) start(state.value.orderId);
  }
  return { state, start, stop, pause, resume };
}

export const canCancelFreeVenue = (order: CancellableOrder, now = Date.now()) =>
  order.businessType === "VENUE" &&
  order.status === "PAID" &&
  order.payableCents === 0 &&
  order.paidCents === 0 &&
  Number(order.refundedCents || 0) === 0 &&
  !order.completedAt &&
  Boolean(order.bookings?.length) &&
  order.bookings?.every(
    (booking) =>
      booking.status === "CONFIRMED" &&
      new Date(booking.startsAt).getTime() > now,
  );
