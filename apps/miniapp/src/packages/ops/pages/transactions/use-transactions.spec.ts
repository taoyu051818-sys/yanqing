import { beforeEach, expect, it, vi } from "vitest";
import { endpoints } from "../../../../services/api";
import { useTransactions } from "./use-transactions";
const state = vi.hoisted(() => ({ owner: 1, dispose: () => {} }));
vi.mock("vue", async () => ({
  ...(await vi.importActual<object>("vue")),
  onUnmounted: (fn: () => void) => {
    state.dispose = fn;
  },
}));
vi.mock("../../../../services/auth-session", () => ({
  captureAuthSession: () => state.owner,
  isAuthSessionCurrent: (owner: number) => owner === state.owner,
}));
vi.mock("../../../../services/api", () => ({
  endpoints: {
    adminOrders: vi.fn(),
    ledgerTimeline: vi.fn(),
    refundTimeline: vi.fn(),
  },
}));
beforeEach(() => {
  vi.resetAllMocks();
  state.owner = 1;
  vi.stubGlobal("uni", { stopPullDownRefresh: vi.fn() });
});
it("ignores a delayed previous view and late responses from the previous account", async () => {
  let resolve!: (value: any) => void;
  vi.mocked(endpoints.adminOrders).mockReturnValue(
    new Promise((r) => (resolve = r)),
  );
  vi.mocked(endpoints.ledgerTimeline).mockResolvedValue({
    items: [{ id: "receipt" }],
    summary: [],
    nextCursor: null,
  } as any);
  const data = useTransactions();
  const old = data.load();
  data.view.value = "ledger";
  await data.load();
  resolve({ items: [{ id: "old-order" }], total: 1 });
  await old;
  expect(data.items.value.map((x) => x.id)).toEqual(["receipt"]);
  data.view.value = "orders";
  const pending = data.load();
  state.owner = 2;
  resolve({ items: [{ id: "private" }], total: 1 });
  await pending;
  expect(data.items.value).toEqual([]);
});
it("refreshes every previously loaded page while keeping the same filters", async () => {
  const ids = Array.from({ length: 26 }, (_, i) => ({
    id: String(i),
    status: "PAID",
  }));
  vi.mocked(endpoints.adminOrders).mockImplementation(
    async (q) =>
      ({
        items: ids.slice(((q?.page || 1) - 1) * 20, (q?.page || 1) * 20),
        total: 26,
        page: q?.page || 1,
        pageSize: 20,
      }) as any,
  );
  const data = useTransactions();
  data.keyword.value = "member";
  data.dateFrom.value = "2026-09-01";
  await data.load();
  await data.load(true);
  expect(data.items.value).toHaveLength(26);
  ids[0] = { id: "0", status: "REFUNDED" };
  await data.load(false, true);
  expect(data.items.value).toHaveLength(26);
  expect(data.items.value[0].status).toBe("REFUNDED");
  expect(data.keyword.value).toBe("member");
  expect(data.dateFrom.value).toBe("2026-09-01");
  expect(data.hasMore.value).toBe(false);
});
it("leaves failed reads visibly failed and does not apply a result after disposal", async () => {
  vi.mocked(endpoints.adminOrders).mockRejectedValueOnce(
    Error("temporary outage"),
  );
  const data = useTransactions();
  await data.load();
  expect(data.error.value).toBe("temporary outage");
  expect(data.total.value).toBeNull();
  let resolve!: (value: any) => void;
  vi.mocked(endpoints.adminOrders).mockReturnValue(
    new Promise((r) => (resolve = r)),
  );
  const pending = data.load();
  state.dispose();
  resolve({ items: [{ id: "late" }], total: 1 });
  await pending;
  expect(data.items.value).toEqual([]);
});
