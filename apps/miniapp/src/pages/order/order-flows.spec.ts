import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ref } from "vue";
import type {
  OrderPage,
  OrderView,
  PaymentQuote,
  PaymentResult,
} from "@yanqing/shared";
import { endpoints } from "../../services/api";
import { saveAuthSession } from "../../services/auth-session";
import { requestMemberLogin } from "../../utils/member-navigation";
import { useOrderList } from "./use-order-list";
import { useOrderActionScope } from "./order-action-scope";
import { useOrderPayment } from "./use-order-payment";
import { useOrderAftersales } from "./use-order-aftersales";
import { useOrderClock } from "./use-order-clock";
import { canRequestOrderRefund } from "./order-presentation";

vi.mock("../../services/api", () => ({
  endpoints: {
    orders: vi.fn(),
    order: vi.fn(),
    paymentOptions: vi.fn(),
    payOrder: vi.fn(),
    cancelPendingOrder: vi.fn(),
    refundOrder: vi.fn(),
  },
}));
vi.mock("../../services/http", () => ({ isMockMode: false }));
vi.mock("../../utils/member-navigation", () => ({
  requestMemberLogin: vi.fn(),
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (cause: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const order = (id = "order", patch: Partial<OrderView> = {}): OrderView => ({
  id,
  orderNo: id,
  businessType: "VENUE",
  subjectAccount: "VENUE",
  sourceChannel: "MINIAPP",
  status: "PENDING",
  title: "1号场预约",
  listAmountCents: 5000,
  discountCents: 0,
  payableCents: 5000,
  paidCents: 0,
  refundedCents: 0,
  createdAt: "2026-09-10T01:00:00Z",
  ...patch,
});
const page = (items: OrderView[], current = 1): OrderPage => ({
  items,
  total: 40,
  page: current,
  pageSize: 20,
});
const quote = (
  channel: "WECHAT" | "CASH_PRINCIPAL" = "WECHAT",
  amount = 5000,
): PaymentQuote => ({
  orderId: "order",
  payableCents: amount,
  quotedAt: "2026-09-10T01:00:00Z",
  options: [
    {
      channel,
      enabled: true,
      reason: "",
      debitAmount: amount,
      availableBalance: 10000,
      unit: "CENT",
    },
  ],
});
const paid = (patch: Partial<PaymentResult> = {}): PaymentResult => ({
  status: "SUCCEEDED",
  amountCents: 5000,
  channel: "CASH_PRINCIPAL",
  createdAt: "2026-09-10T01:00:00Z",
  paidAt: "2026-09-10T01:00:00Z",
  ...patch,
});
const wxPay = {
  timeStamp: "1",
  nonceStr: "nonce",
  package: "prepay_id=test",
  signType: "RSA" as const,
  paySign: "test",
};
let ui: {
  showToast: ReturnType<typeof vi.fn>;
  showModal: ReturnType<typeof vi.fn>;
  requestPayment: ReturnType<typeof vi.fn>;
  stopPullDownRefresh: ReturnType<typeof vi.fn>;
};
beforeEach(() => {
  vi.resetAllMocks();
  const storage = new Map<string, unknown>();
  ui = {
    showToast: vi.fn(),
    showModal: vi.fn().mockResolvedValue({ confirm: true }),
    requestPayment: vi.fn().mockResolvedValue(undefined),
    stopPullDownRefresh: vi.fn(),
  };
  vi.stubGlobal("uni", {
    ...ui,
    getStorageSync: (key: string) => storage.get(key),
    setStorageSync: (key: string, value: unknown) => storage.set(key, value),
    removeStorageSync: (key: string) => storage.delete(key),
  });
  saveAuthSession("first-token", "member-a");
  vi.mocked(endpoints.orders).mockResolvedValue(page([order()]));
  vi.mocked(endpoints.paymentOptions).mockResolvedValue(quote());
  vi.mocked(endpoints.payOrder).mockResolvedValue(paid());
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function paymentFlow() {
  const scope = useOrderActionScope();
  const list = {
    load: vi.fn().mockResolvedValue(undefined),
    replaceOrder: vi.fn(),
  };
  const session = { hydrate: vi.fn().mockResolvedValue(undefined) };
  const flow = useOrderPayment(scope, list, session, () => false);
  return { flow, scope, list, session };
}
describe("order list ownership", () => {
  it("loads one next page even if load-more is tapped twice", async () => {
    const list = useOrderList({ isAuthenticated: true });
    await list.load();
    const next = deferred<OrderPage>();
    vi.mocked(endpoints.orders).mockReturnValueOnce(next.promise);
    const pending = list.load(true);
    await list.load(true);
    expect(endpoints.orders).toHaveBeenCalledTimes(2);
    next.resolve(page([order("second")], 2));
    await pending;
    expect(list.orders.value.map((item) => item.id)).toEqual([
      "order",
      "second",
    ]);
    expect(endpoints.orders).toHaveBeenLastCalledWith({
      page: 2,
      pageSize: 20,
    });
  });
  it("does not overwrite a newer filter with the older response", async () => {
    const list = useOrderList({ isAuthenticated: true });
    const old = deferred<OrderPage>();
    vi.mocked(endpoints.orders).mockReturnValueOnce(old.promise);
    const pending = list.load();
    list.filterOrders("PAID");
    await vi.waitFor(() => expect(list.loading.value).toBe(false));
    old.resolve(page([order("old")]));
    await pending;
    expect(list.orders.value[0].id).toBe("order");
    expect(list.statusFilter.value).toBe("PAID");
  });
  it.each(["account", "dispose"])(
    "ignores an in-flight list after %s changes",
    async (mode) => {
      const list = useOrderList({ isAuthenticated: true });
      const result = deferred<OrderPage>();
      vi.mocked(endpoints.orders).mockReturnValueOnce(result.promise);
      const pending = list.load();
      if (mode === "account") saveAuthSession("second-token", "member-b");
      else list.dispose();
      result.resolve(page([order("private")]));
      await pending;
      expect(list.orders.value).toEqual([]);
      expect(list.loading.value).toBe(false);
      if (mode === "dispose") {
        await list.load();
        expect(endpoints.orders).toHaveBeenCalledOnce();
      }
    },
  );
  it("opens the requested order after login and preserves retry on API failure", async () => {
    const session = { isAuthenticated: false };
    const list = useOrderList(session);
    list.configure({ id: "linked order" });
    await list.load();
    expect(requestMemberLogin).toHaveBeenCalledWith(
      "/pages/order/index?id=linked%20order",
    );
    session.isAuthenticated = true;
    vi.mocked(endpoints.order)
      .mockRejectedValueOnce(new Error("暂不可用"))
      .mockResolvedValueOnce(order());
    await list.load();
    expect(list.error.value).toBe("暂不可用");
    await list.load();
    expect(list.orders.value).toHaveLength(1);
    expect(list.error.value).toBe("");
  });
});

describe("payment and mutation ownership", () => {
  it("an older action cannot clear a newer action's busy state", () => {
    const scope = useOrderActionScope();
    const old = scope.begin("pay:old")!;
    expect(scope.begin("refund:blocked")).toBeNull();
    scope.reset();
    const latest = scope.begin("pay:new")!;
    old.finish();
    expect(scope.actionKey.value).toBe("pay:new");
    expect(old.isCurrent()).toBe(false);
    latest.finish();
    expect(scope.actionKey.value).toBe("");
    scope.dispose();
    expect(scope.begin("late")).toBeNull();
  });
  it("ignores a late quote after account replacement", async () => {
    const { flow, scope } = paymentFlow();
    const pendingQuote = deferred<PaymentQuote>();
    vi.mocked(endpoints.paymentOptions).mockReturnValueOnce(
      pendingQuote.promise,
    );
    const pending = flow.preparePay(order());
    saveAuthSession("second-token", "member-b");
    scope.reset();
    flow.reset();
    pendingQuote.resolve(quote());
    await pending;
    expect(flow.paymentQuote.value).toBeNull();
    expect(flow.payingId.value).toBe("");
  });
  it("uses the selected quote amount and prevents concurrent submission", async () => {
    const { flow, scope, list, session } = paymentFlow();
    vi.mocked(endpoints.paymentOptions).mockResolvedValue(
      quote("CASH_PRINCIPAL"),
    );
    await flow.preparePay(order());
    const payment = deferred<PaymentResult>();
    vi.mocked(endpoints.payOrder).mockReturnValueOnce(payment.promise);
    const pending = flow.pay(order());
    await flow.pay(order());
    expect(endpoints.payOrder).toHaveBeenCalledOnce();
    expect(endpoints.payOrder).toHaveBeenCalledWith(
      "order",
      expect.objectContaining({
        channel: "CASH_PRINCIPAL",
        expectedDebitAmount: 5000,
        idempotencyKey: expect.any(String),
      }),
    );
    payment.resolve(paid());
    await pending;
    expect(list.load).toHaveBeenCalledOnce();
    expect(session.hydrate).toHaveBeenCalledOnce();
    expect(scope.actionKey.value).toBe("");
  });
  it("never uses another order's quote", async () => {
    const { flow } = paymentFlow();
    await flow.preparePay(order());
    await flow.pay(order("other"));
    expect(endpoints.payOrder).not.toHaveBeenCalled();
  });
  it("confirms a free order through the quoted channel without a native payment", async () => {
    const { flow, list } = paymentFlow();
    vi.mocked(endpoints.paymentOptions).mockResolvedValue(quote("WECHAT", 0));
    vi.mocked(endpoints.payOrder).mockResolvedValue(
      paid({ channel: "WECHAT", amountCents: 0 }),
    );
    const free = order("order", { payableCents: 0 });
    await flow.preparePay(free);
    await flow.pay(free);
    expect(flow.freeConfirmation.value).toBe(true);
    expect(ui.requestPayment).not.toHaveBeenCalled();
    expect(list.load).toHaveBeenCalledOnce();
    expect(endpoints.payOrder).toHaveBeenCalledWith(
      "order",
      expect.objectContaining({ expectedDebitAmount: 0 }),
    );
  });
  it("waits for the server after native payment success and survives a hide/show", async () => {
    vi.useFakeTimers();
    const { flow, list } = paymentFlow();
    const native = deferred<void>();
    ui.requestPayment.mockReturnValueOnce(native.promise);
    vi.mocked(endpoints.payOrder).mockResolvedValue(
      paid({ channel: "WECHAT", status: "PROCESSING", wechatPay: wxPay }),
    );
    vi.mocked(endpoints.order)
      .mockResolvedValueOnce(order())
      .mockResolvedValueOnce(
        order("order", { status: "PAID", paidCents: 5000 }),
      );
    await flow.preparePay(order());
    const pending = flow.pay(order());
    await vi.advanceTimersByTimeAsync(0);
    flow.confirmation.pause();
    native.resolve();
    await pending;
    expect(list.replaceOrder).not.toHaveBeenCalled();
    expect(flow.paymentConfirmation.value?.checking).toBe(false);
    flow.confirmation.resume();
    await vi.advanceTimersByTimeAsync(2000);
    expect(list.replaceOrder).toHaveBeenCalledWith(
      expect.objectContaining({ status: "PAID" }),
    );
    expect(flow.paymentConfirmation.value).toBeNull();
  });
  it("keeps a native cancellation retryable", async () => {
    const { flow, list } = paymentFlow();
    vi.mocked(endpoints.payOrder).mockResolvedValue(
      paid({ channel: "WECHAT", status: "PROCESSING", wechatPay: wxPay }),
    );
    ui.requestPayment.mockRejectedValueOnce({
      errMsg: "requestPayment:fail cancel",
    });
    await flow.preparePay(order());
    await flow.pay(order());
    expect(flow.paymentError.value).toContain("取消付款");
    expect(flow.paymentConfirmation.value).toBeNull();
    expect(list.load).not.toHaveBeenCalled();
  });
  it("ignores payment results after the page is disposed", async () => {
    const { flow, scope, list } = paymentFlow();
    await flow.preparePay(order());
    const result = deferred<PaymentResult>();
    vi.mocked(endpoints.payOrder).mockReturnValueOnce(result.promise);
    const pending = flow.pay(order());
    scope.dispose();
    flow.reset();
    result.resolve(paid());
    await pending;
    expect(ui.showToast).not.toHaveBeenCalled();
    expect(list.load).not.toHaveBeenCalled();
    await flow.preparePay(order());
    expect(endpoints.paymentOptions).toHaveBeenCalledOnce();
  });
});

describe("order aftersales", () => {
  it("shares refund eligibility between the page and command", async () => {
    const load = vi.fn();
    const scope = useOrderActionScope();
    const flow = useOrderAftersales(scope, load, () => false);
    const course = order("course", {
      businessType: "TRAINING",
      status: "PAID",
      paidCents: 5000,
    });
    expect(canRequestOrderRefund(course)).toBe(false);
    await flow.refund(course, "调整安排");
    expect(endpoints.refundOrder).not.toHaveBeenCalled();
    const venue = order("paid", {
      status: "PAID",
      paidCents: 5000,
      refundedCents: 1000,
    });
    await flow.refund(venue, "调整安排");
    expect(endpoints.refundOrder).toHaveBeenCalledWith(
      "paid",
      expect.objectContaining({ amountCents: 4000 }),
    );
  });
  it("does not cancel after the account changes while confirmation is open", async () => {
    const modal = deferred<{ confirm: boolean }>();
    ui.showModal.mockReturnValueOnce(modal.promise);
    const flow = useOrderAftersales(
      useOrderActionScope(),
      vi.fn(),
      () => false,
    );
    const pending = flow.cancelPending(order());
    saveAuthSession("second-token", "member-b");
    modal.resolve({ confirm: true });
    await pending;
    expect(endpoints.cancelPendingOrder).not.toHaveBeenCalled();
  });
  it.each(["cancel", "refund"])(
    "does not show old %s results on a new account",
    async (kind) => {
      const scope = useOrderActionScope();
      const load = vi.fn();
      const flow = useOrderAftersales(scope, load, () => false);
      const result = deferred<unknown>();
      vi.mocked(
        kind === "cancel"
          ? endpoints.cancelPendingOrder
          : endpoints.refundOrder,
      ).mockReturnValueOnce(result.promise);
      const pending =
        kind === "cancel"
          ? flow.cancelPending(order())
          : flow.refund(
              order("paid", { status: "PAID", paidCents: 5000 }),
              "调整安排",
            );
      await vi.waitFor(() => expect(scope.actionKey.value).not.toBe(""));
      saveAuthSession("second-token", "member-b");
      scope.reset();
      flow.reset();
      result.resolve({});
      await pending;
      expect(ui.showToast).not.toHaveBeenCalled();
      expect(load).not.toHaveBeenCalled();
    },
  );
});

describe("order countdown lifecycle", () => {
  it("refreshes an expired hold once at a time and stops while hidden", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-10T01:00:00Z"));
    const result = deferred<void>();
    const refresh = vi.fn(() => result.promise);
    const clock = useOrderClock(
      ref([order("order", { paymentExpiresAt: "2026-09-10T01:00:01Z" })]),
      refresh,
    );
    clock.start();
    await vi.advanceTimersByTimeAsync(5000);
    expect(refresh).toHaveBeenCalledOnce();
    clock.stop();
    result.resolve();
    await vi.advanceTimersByTimeAsync(5000);
    expect(refresh).toHaveBeenCalledOnce();
  });
});
