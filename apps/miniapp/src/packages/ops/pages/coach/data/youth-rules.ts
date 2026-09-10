import { computed } from "vue";
import { endpoints } from "../../../../../services/api";
import type {
  YouthTrainingRuleView,
  YouthTrainingRuleManagementView,
} from "../../../../../types/training-operations";
import { useTrainingResource, type DataScope } from "./resource";

export function useCoachYouthRuleData(scope: DataScope) {
  const active = useTrainingResource<YouthTrainingRuleView | null>(
    () => null,
    scope,
  );
  const rules = useTrainingResource<YouthTrainingRuleManagementView[]>(
    () => [],
    scope,
  );
  async function refresh(canConfigure: boolean) {
    await Promise.all([
      active.load(() => endpoints.activeYouthTrainingRule()),
      rules.load(async () =>
        canConfigure ? await endpoints.youthTrainingRules() : [],
      ),
    ]);
  }
  function reset() {
    active.reset();
    rules.reset();
  }
  return {
    activeYouthRule: active.data,
    youthRules: rules.data,
    error: computed(() => active.error.value || rules.error.value),
    refresh,
    reset,
  };
}
