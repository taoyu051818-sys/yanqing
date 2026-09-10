import { readFileSync } from "node:fs";
import ts from "typescript";
import { watch } from "vue";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { OrderView } from "@yanqing/shared";
import { endpoints } from "../../services/api";
import { saveAuthSession } from "../../services/auth-session";
import { useOrderList } from "./use-order-list";
import { useOrderActionScope } from "./order-action-scope";
import { useOrderPayment } from "./use-order-payment";
import { useOrderAftersales } from "./use-order-aftersales";
import { useOrderClock } from "./use-order-clock";

vi.mock("../../services/api", () => ({
  endpoints: {
    order: vi.fn(),
    orders: vi.fn(),
    paymentOptions: vi.fn(),
    payOrder: vi.fn(),
  },
}));
vi.mock("../../services/http", () => ({ isMockMode: false }));
vi.mock("../../utils/member-navigation", () => ({
  requestMemberLogin: vi.fn(),
}));
const source = readFileSync(new URL("./index.vue", import.meta.url), "utf8")
  .split('<script setup lang="ts">')[1]
  .split("</script>")[0];
const js = ts
  .transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
    },
    transformers: {
      before: [
        (context) => (file) =>
          ts.visitNode(file, function visit(node): ts.VisitResult<ts.Node> {
            return ts.isImportDeclaration(node)
              ? undefined
              : ts.visitEachChild(node, visit, context);
          }) as ts.SourceFile,
      ],
    },
  })
  .outputText.replace(/^export \{\};?$/gm, "");

function fixture(notifyImmediately = false) {
  vi.resetAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-09T06:00:00Z"));
  const storage = new Map<string, unknown>();
  let status: OrderView["status"] = "PENDING";
  const order = (): OrderView => ({
    id: "venue-order",
    orderNo: "VN-test",
    businessType: "VENUE",
    status,
    title: "场地预约",
    subjectAccount: "VENUE",
    sourceChannel: "MINIAPP",
    listAmountCents: 6000,
    discountCents: 0,
    refundedCents: 0,
    createdAt: "2026-09-09T06:00:00Z",
    payableCents: 6000,
    paidCents: status === "PAID" ? 6000 : 0,
    paymentExpiresAt: "2026-09-09T06:10:00Z",
  });
  vi.mocked(endpoints.order).mockImplementation(async () => order());
  vi.mocked(endpoints.orders).mockImplementation(async () => ({
    items: [order()],
    total: 1,
    page: 1,
    pageSize: 20,
  }));
  vi.mocked(endpoints.paymentOptions).mockResolvedValue({
    orderId: "venue-order",
    payableCents: 6000,
    quotedAt: "2026-09-09T06:00:00Z",
    options: [
      {
        channel: "WECHAT",
        enabled: true,
        debitAmount: 6000,
        unit: "CENT",
        reason: "",
      },
    ],
  });
  vi.mocked(endpoints.payOrder).mockResolvedValue({
    status: "PROCESSING",
    channel: "WECHAT",
    amountCents: 6000,
    createdAt: "2026-09-09T06:00:00Z",
    paidAt: null,
    wechatPay: {
      package: "prepay_id=isolated",
      nonceStr: "nonce",
      timeStamp: "1",
      signType: "RSA",
      paySign: "test",
    },
  });
  const session = {
    isAuthenticated: true,
    user: { id: "member" },
    hydrate: vi.fn(async () => true),
  };
  const requestPayment = vi.fn(async () => {
    if (notifyImmediately) status = "PAID";
  });
  vi.stubGlobal("uni", {
    getStorageSync: (key: string) => storage.get(key),
    setStorageSync: (key: string, value: unknown) => storage.set(key, value),
    removeStorageSync: (key: string) => storage.delete(key),
    requestPayment,
    showToast: vi.fn(),
    stopPullDownRefresh: vi.fn(),
  });
  saveAuthSession("token", "member");
  const noop = () => {};
  const deps = {
    watch,
    useOrderList,
    useOrderActionScope,
    useOrderPayment,
    useOrderAftersales,
    useOrderClock,
    useSessionStore: () => session,
    onLoad: noop,
    onShow: noop,
    onHide: noop,
    onUnload: noop,
    onPullDownRefresh: noop,
  };
  const page = new Function(
    ...Object.keys(deps),
    js +
      ";return { load, preparePay, pay, orders, startCountdown: clock.start, stopCountdown: clock.stop, paymentConfirmation }",
  )(...Object.values(deps));
  return {
    page,
    session,
    requestPayment,
    notify: () => {
      status = "PAID";
    },
  };
}
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
describe("order page payment confirmation regression", () => {
  it("refreshes automatically when notification arrives five seconds after native payment success", async () => {
    const f = fixture();
    await f.page.load();
    f.page.startCountdown();
    const pending = f.page.orders.value[0];
    await f.page.preparePay(pending);
    await f.page.pay(pending);
    await vi.advanceTimersByTimeAsync(0);
    expect(f.requestPayment).toHaveBeenCalledOnce();
    const readsAfterPayment = vi.mocked(endpoints.orders).mock.calls.length;
    expect(f.page.orders.value[0].status).toBe("PENDING");
    await vi.advanceTimersByTimeAsync(5000);
    f.notify();
    await vi.advanceTimersByTimeAsync(25000);
    expect(vi.mocked(endpoints.orders).mock.calls.length).toBeGreaterThan(
      readsAfterPayment,
    );
    expect(f.page.paymentConfirmation.value).toBeNull();
    expect(f.page.orders.value[0].status).toBe("PAID");
    f.page.stopCountdown();
  });
  it("shows paid when the provider notification beats the one immediate query", async () => {
    const f = fixture(true);
    await f.page.load();
    const pending = f.page.orders.value[0];
    await f.page.preparePay(pending);
    await f.page.pay(pending);
    await vi.advanceTimersByTimeAsync(0);
    expect(f.page.orders.value[0].status).toBe("PAID");
  });
});
