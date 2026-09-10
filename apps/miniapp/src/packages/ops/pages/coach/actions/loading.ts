import { ref, type Ref } from "vue";
import type { useSessionStore } from "../../../../../stores/session";
import { loadingError } from "../data/resource";

export function useCoachLoadingActions({
  session,
  mayViewTraining,
  refreshData,
  resetData,
  afterRefresh,
}: {
  session: Pick<
    ReturnType<typeof useSessionStore>,
    "hydrate" | "user" | "roles"
  >;
  mayViewTraining: Ref<boolean>;
  refreshData: () => Promise<string>;
  resetData: () => void;
  afterRefresh: (isCurrent: () => boolean) => Promise<void>;
}) {
  const loading = ref(false);
  const errorMessage = ref("");
  let generation = 0;
  const scope = () =>
    `${session.user?.id || ""}:${[...session.roles].sort().join(",")}`;
  function dispose() {
    generation++;
    resetData();
    loading.value = false;
  }
  async function load() {
    const request = ++generation;
    loading.value = true;
    errorMessage.value = "";
    let actor: string | undefined;
    try {
      await session.hydrate();
      if (request !== generation) return;
      actor = scope();
      if (!mayViewTraining.value) {
        resetData();
        errorMessage.value = "当前账号没有培训经营页权限。";
        return;
      }
      const error = await refreshData();
      if (request !== generation || actor !== scope()) return;
      errorMessage.value = error;
      await afterRefresh(() => request === generation && actor === scope());
    } catch (cause: unknown) {
      if (request === generation && (actor === undefined || actor === scope()))
        errorMessage.value = loadingError(cause, "部分培训经营数据加载失败。");
    } finally {
      if (request === generation) {
        if (actor !== undefined && actor !== scope()) resetData();
        loading.value = false;
      }
    }
  }
  return { loading, errorMessage, load, dispose };
}
