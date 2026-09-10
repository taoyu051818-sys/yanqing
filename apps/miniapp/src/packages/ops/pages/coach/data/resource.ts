import { computed, shallowRef, type ShallowRef } from "vue";

export type DataScope = () => string;
export function loadingError(cause: unknown, fallback: string) {
  return cause instanceof Error && cause.message ? cause.message : fallback;
}
export function pageItems<T>(payload: { items: T[] } | T[]): T[] {
  return Array.isArray(payload) ? payload : payload.items;
}

/** Owns a response and ignores requests superseded by a refresh or account change. */
export function useTrainingResource<T>(initial: () => T, scope: DataScope) {
  const value: ShallowRef<T> = shallowRef(initial());
  const error = shallowRef("");
  let generation = 0;
  const owner = shallowRef(scope());
  function reset() {
    generation++;
    owner.value = scope();
    value.value = initial();
    error.value = "";
  }
  async function load(fetch: () => Promise<T>): Promise<boolean> {
    if (owner.value !== scope()) reset();
    const request = ++generation;
    const actor = scope();
    error.value = "";
    try {
      const result = await fetch();
      if (request !== generation || actor !== scope()) return false;
      value.value = result;
      return true;
    } catch (cause: unknown) {
      if (request !== generation || actor !== scope()) return false;
      error.value = loadingError(cause, "部分培训经营数据加载失败。");
      return true;
    }
  }
  return {
    data: computed<T>(() =>
      owner.value === scope() ? value.value : initial(),
    ),
    error: computed(() => (owner.value === scope() ? error.value : "")),
    load,
    reset,
  };
}
