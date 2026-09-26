import { computed, ref } from "vue";
import type { TrainingSessionPage, TrainingSessionQuery } from "@yanqing/shared";
import { endpoints } from "../../../../../services/api";
import { useTrainingResource, type DataScope } from "./resource";

/** Pagination state is owned by both account and search conditions. */
export function useTrainingSessionList(scope: DataScope, query: () => TrainingSessionQuery) {
  const owner = () => `${scope()}:${JSON.stringify(query())}`;
  const page = useTrainingResource<TrainingSessionPage>(() => ({ items: [], page: 0, pageSize: 50, hasMore: false }), owner);
  const loading = ref(false);
  let generation = 0;
  let lastAppend = false;
  function reset() { generation++; page.reset(); loading.value = false; }
  async function fetch(append: boolean) {
    if (append && (loading.value || !page.data.value.hasMore)) return;
    lastAppend = append;
    const request = ++generation;
    const previous = page.data.value;
    const criteria = { ...query(), page: append ? previous.page + 1 : 1, pageSize: 50 };
    loading.value = true;
    await page.load(async () => {
      const result = await endpoints.trainingSessionPage(criteria);
      return { ...result, items: append ? [...new Map([...previous.items, ...result.items].map(item => [item.id, item])).values()] : result.items };
    });
    if (request === generation) loading.value = false;
  }
  return { items: computed(() => page.data.value.items), hasMore: computed(() => page.data.value.hasMore), error: page.error, loading, reset, refresh: () => fetch(false), more: () => fetch(true), retry: () => fetch(lastAppend) };
}
