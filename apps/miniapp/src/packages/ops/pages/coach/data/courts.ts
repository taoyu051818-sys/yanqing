import type { Ref } from "vue";
import { endpoints } from "../../../../../services/api";
import type { CourtAvailability } from "../../../../../types/domain";
import { useTrainingResource, type DataScope } from "./resource";

export function useCoachCourtData(
  scope: DataScope,
  date: Ref<string>,
  selectedCourtIds: Ref<string[]>,
) {
  const availability = useTrainingResource<CourtAvailability | null>(
    () => null,
    () => `${scope()}:${date.value}`,
  );
  async function refresh() {
    const requestedDate = date.value;
    const actor = scope();
    const accepted = await availability.load(() =>
      endpoints.availability(requestedDate),
    );
    if (
      !accepted ||
      requestedDate !== date.value ||
      actor !== scope() ||
      availability.error.value
    )
      return;
    const courts = availability.data.value?.courts || [];
    selectedCourtIds.value = selectedCourtIds.value.filter((id) =>
      courts.some((court) => court.id === id && court.enabled),
    );
  }
  return {
    courtAvailability: availability.data,
    error: availability.error,
    refresh,
    reset: availability.reset,
  };
}
