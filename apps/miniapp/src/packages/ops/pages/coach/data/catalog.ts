import type { TrainingProductView } from "@yanqing/shared";
import { computed } from "vue";
import { endpoints } from "../../../../../services/api";
import type { TrainingStaffSummary } from "../../../../../types/training-operations";
import { useTrainingResource, pageItems, type DataScope } from "./resource";

export function useCoachCatalogData(scope: DataScope) {
  const products = useTrainingResource<TrainingProductView[]>(() => [], scope);
  const staff = useTrainingResource<TrainingStaffSummary[]>(() => [], scope);
  async function refresh(canConfigure: boolean) {
    await Promise.all([
      products.load(() => endpoints.trainingProducts()),
      staff.load(async () =>
        canConfigure
          ? pageItems(
              await endpoints.governanceUsers({ page: 1, pageSize: 100 }),
            )
          : [],
      ),
    ]);
  }
  function reset() {
    products.reset();
    staff.reset();
  }
  return {
    products: products.data,
    staffUsers: staff.data,
    error: computed(() => products.error.value || staff.error.value),
    refresh,
    reset,
  };
}
