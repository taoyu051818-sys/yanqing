import { computed, onUnmounted, ref } from "vue";
import { endpoints } from "../../../../services/api";
import {
  captureAuthSession,
  isAuthSessionCurrent,
} from "../../../../services/auth-session";
import { today } from "../../../../utils/format";
export function useTransactions() {
  const view = ref("orders"),
    keyword = ref(""),
    dateFrom = ref(today()),
    dateTo = ref(today());
  const status = ref(""),
    businessType = ref(""),
    channel = ref(""),
    scope = ref("EXTERNAL"),
    dateBasis = ref("created");
  const items = ref<any[]>([]),
    summary = ref<any[]>([]),
    total = ref<number | null>(null),
    loading = ref(false),
    error = ref("");
  const cursor = ref<string | null>(null),
    page = ref(0);
  let generation = 0,
    alive = true;
  const filterKey = computed(() =>
    JSON.stringify([
      view.value,
      keyword.value,
      dateFrom.value,
      dateTo.value,
      status.value,
      businessType.value,
      channel.value,
      scope.value,
      dateBasis.value,
    ]),
  );
  function clear() {
    generation++;
    items.value = [];
    summary.value = [];
    total.value = null;
    cursor.value = null;
    page.value = 0;
    error.value = "";
    loading.value = false;
  }
  const hasMore = computed(() =>
    view.value === "orders"
      ? total.value != null && items.value.length < total.value
      : Boolean(cursor.value),
  );
  async function load(more = false, preserve = false) {
    if (more && (loading.value || !hasMore.value)) return;
    const run = ++generation,
      owner = captureAuthSession(),
      key = filterKey.value;
    const current = () =>
      alive &&
      run === generation &&
      key === filterKey.value &&
      isAuthSessionCurrent(owner);
    const retainedCount = preserve ? items.value.length : 0;
    if (!more && !preserve) {
      items.value = [];
      summary.value = [];
      total.value = null;
      cursor.value = null;
      page.value = 0;
    }
    loading.value = true;
    error.value = "";
    try {
      const common = {
        pageSize: 20,
        keyword: keyword.value.trim() || undefined,
        dateFrom: dateFrom.value || undefined,
        dateTo: dateTo.value || undefined,
      };
      const fetchPage = (number: number, after: string | null): Promise<any> =>
        view.value === "orders"
          ? endpoints.adminOrders({
              ...common,
              page: number,
              status: status.value || undefined,
              businessType: businessType.value || undefined,
              channel: channel.value || undefined,
              dateBasis: dateBasis.value,
            })
          : view.value === "refunds"
            ? endpoints.refundTimeline({
                ...common,
                status: status.value || "ACTIVE",
                cursor: after || undefined,
              })
            : endpoints.ledgerTimeline({
                ...common,
                scope: scope.value,
                cursor: after || undefined,
              });
      let loadedPage = more ? page.value + 1 : 1;
      let result = await fetchPage(loadedPage, more ? cursor.value : null);
      if (!current()) return;
      const rows = [...result.items];
      while (
        preserve &&
        rows.length < retainedCount &&
        (view.value === "orders"
          ? rows.length < result.total
          : Boolean(result.nextCursor))
      ) {
        loadedPage++;
        result = await fetchPage(loadedPage, result.nextCursor);
        if (!current()) return;
        rows.push(...result.items);
        if (!result.items.length) break;
      }
      items.value = more ? [...items.value, ...rows] : rows;
      total.value = result.total ?? null;
      summary.value = result.summary || [];
      cursor.value = result.nextCursor || null;
      page.value = loadedPage;
    } catch (cause: any) {
      if (current()) error.value = cause?.message || "记录加载失败，请重试";
    } finally {
      if (run === generation) {
        loading.value = false;
        uni.stopPullDownRefresh();
      }
    }
  }
  function changeView(next: string) {
    if (view.value === next) return;
    view.value = next;
    status.value = "";
    businessType.value = "";
    channel.value = "";
    dateBasis.value = "created";
    dateFrom.value = next === "refunds" ? "" : today();
    dateTo.value = dateFrom.value;
    void load();
  }
  onUnmounted(() => {
    alive = false;
    generation++;
  });
  return {
    view,
    keyword,
    dateFrom,
    dateTo,
    status,
    businessType,
    channel,
    scope,
    dateBasis,
    items,
    summary,
    total,
    loading,
    error,
    hasMore,
    load,
    clear,
    changeView,
  };
}
