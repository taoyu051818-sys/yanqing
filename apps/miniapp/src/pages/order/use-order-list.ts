import { computed, ref } from "vue";
import type { OrderView } from "@yanqing/shared";
import { endpoints } from "../../services/api";
import {
  captureAuthSession,
  isAuthSessionCurrent,
} from "../../services/auth-session";
import { requestMemberLogin } from "../../utils/member-navigation";
import { orderFailure } from "./order-errors";

export const orderFilters = [
  { label: "全部", status: "" },
  { label: "待付款", status: "PENDING" },
  { label: "待使用", status: "PAID" },
  { label: "售后中", status: "REFUND_PENDING" },
];
export function useOrderList(session: { readonly isAuthenticated: boolean }) {
  const records = ref<OrderView[]>([]);
  const focusedId = ref("");
  const statusFilter = ref("");
  const page = ref(1);
  const total = ref(0);
  const loading = ref(false);
  const error = ref("");
  let generation = 0;
  let alive = true;
  function reset() {
    generation++;
    records.value = [];
    total.value = 0;
    page.value = 1;
    loading.value = false;
    error.value = "";
  }
  function dispose() {
    alive = false;
    reset();
  }
  function configure(query: Record<string, unknown> | undefined) {
    focusedId.value = typeof query?.id === "string" ? query.id : "";
    if (orderFilters.some((item) => item.status === query?.status))
      statusFilter.value = String(query?.status || "");
  }
  async function load(more = false) {
    if (!alive || (more && loading.value)) return;
    if (!session.isAuthenticated) {
      reset();
      uni.stopPullDownRefresh();
      return requestMemberLogin(
        focusedId.value
          ? `/pages/order/index?id=${encodeURIComponent(focusedId.value)}`
          : `/pages/order/index${statusFilter.value ? `?status=${statusFilter.value}` : ""}`,
      );
    }
    const run = ++generation;
    const owner = captureAuthSession();
    const requestedPage = more ? page.value + 1 : 1;
    const current = () =>
      alive && run === generation && isAuthSessionCurrent(owner);
    loading.value = true;
    error.value = "";
    try {
      const result = focusedId.value
        ? { items: [await endpoints.order(focusedId.value)], total: 1 }
        : await endpoints.orders({
            page: requestedPage,
            pageSize: 20,
            ...(statusFilter.value ? { status: statusFilter.value } : {}),
          });
      if (!current()) return;
      records.value = more ? [...records.value, ...result.items] : result.items;
      total.value = result.total;
      page.value = requestedPage;
    } catch (cause: unknown) {
      if (current()) {
        const failure = orderFailure(cause);
        error.value =
          failure.statusCode === 400
            ? "订单筛选未成功，请重试"
            : failure.message || "订单加载失败，请稍后重试";
      }
    } finally {
      if (alive && run === generation) {
        if (!isAuthSessionCurrent(owner)) reset();
        loading.value = false;
        uni.stopPullDownRefresh();
      }
    }
  }
  function filterOrders(status: string) {
    focusedId.value = "";
    statusFilter.value = status;
    reset();
    void load();
  }
  function replaceOrder(order: OrderView) {
    if (alive)
      records.value = records.value.map((item) =>
        item.id === order.id ? order : item,
      );
  }
  return {
    orders: computed(() => records.value),
    focusedId,
    statusFilter,
    total,
    loading,
    error,
    load,
    filterOrders,
    configure,
    reset,
    dispose,
    replaceOrder,
  };
}
export type OrderList = ReturnType<typeof useOrderList>;
