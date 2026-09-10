import { describe, expect, it, vi } from "vitest";
import { ref } from "vue";
import { useCoachLoadingActions } from "./loading";
function setup() {
  const session = {
    user: { id: "admin" },
    roles: ["ADMIN"],
    hydrate: vi.fn().mockResolvedValue(undefined),
  } as unknown as Parameters<typeof useCoachLoadingActions>[0]["session"];
  const mayViewTraining = ref(true);
  const refreshData = vi.fn().mockResolvedValue("");
  const resetData = vi.fn();
  const afterRefresh = vi.fn().mockResolvedValue(undefined);
  const actions = useCoachLoadingActions({
    session,
    mayViewTraining,
    refreshData,
    resetData,
    afterRefresh,
  });
  return {
    ...actions,
    session,
    mayViewTraining,
    refreshData,
    resetData,
    afterRefresh,
  };
}
describe("training page refresh lifecycle", () => {
  it("clears busy state when login hydration fails and can retry", async () => {
    const page = setup();
    vi.mocked(page.session.hydrate).mockRejectedValueOnce(
      new Error("登录已失效"),
    );
    await page.load();
    expect(page.loading.value).toBe(false);
    expect(page.errorMessage.value).toBe("登录已失效");
    expect(page.refreshData).not.toHaveBeenCalled();
    await page.load();
    expect(page.afterRefresh).toHaveBeenCalledOnce();
    expect(page.errorMessage.value).toBe("");
  });
  it("clears protected data and never requests it without training access", async () => {
    const page = setup();
    page.mayViewTraining.value = false;
    await page.load();
    expect(page.resetData).toHaveBeenCalledOnce();
    expect(page.refreshData).not.toHaveBeenCalled();
    expect(page.loading.value).toBe(false);
  });
  it("keeps busy until the newest refresh finishes and only navigates for that refresh", async () => {
    const page = setup();
    let finishOld!: (error: string) => void;
    let finishNew!: (error: string) => void;
    page.refreshData
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishOld = resolve;
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishNew = resolve;
          }),
      );
    const old = page.load();
    await vi.waitFor(() => expect(page.refreshData).toHaveBeenCalledTimes(1));
    const latest = page.load();
    await vi.waitFor(() => expect(page.refreshData).toHaveBeenCalledTimes(2));
    finishOld("旧请求失败");
    await old;
    expect(page.loading.value).toBe(true);
    expect(page.afterRefresh).not.toHaveBeenCalled();
    finishNew("");
    await latest;
    expect(page.loading.value).toBe(false);
    expect(page.errorMessage.value).toBe("");
    expect(page.afterRefresh).toHaveBeenCalledOnce();
  });
  it("clears responses when account or roles change during loading", async () => {
    const page = setup();
    let finish!: (error: string) => void;
    page.refreshData.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const pending = page.load();
    await vi.waitFor(() => expect(page.refreshData).toHaveBeenCalledOnce());
    page.session.roles.splice(0, page.session.roles.length, "MEMBER");
    finish("");
    await pending;
    expect(page.afterRefresh).not.toHaveBeenCalled();
    expect(page.resetData).toHaveBeenCalledOnce();
    expect(page.loading.value).toBe(false);
  });
  it("invalidates pending navigation when the page is disposed", async () => {
    const page = setup();
    let finish!: (error: string) => void;
    page.refreshData.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const pending = page.load();
    await vi.waitFor(() => expect(page.refreshData).toHaveBeenCalledOnce());
    page.dispose();
    finish("");
    await pending;
    expect(page.afterRefresh).not.toHaveBeenCalled();
    expect(page.loading.value).toBe(false);
  });
});
