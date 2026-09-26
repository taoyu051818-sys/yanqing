import type {
  TrainingEnrollmentView,
  TrainingSessionView,
  TrainingSessionQuery,
} from "@yanqing/shared";
import { useTrainingSessionList } from "./session-list";
import { computed } from "vue";
import { endpoints } from "../../../../../services/api";
import type { TrainingCorrectionView } from "../../../../../types/training-operations";
import { useTrainingResource, type DataScope } from "./resource";

export function useCoachTeachingData(scope: DataScope, query: () => TrainingSessionQuery = () => ({}), detailQuery: () => { id?: string; attendanceId?: string } = () => ({})) {
  const list = useTrainingSessionList(scope, query);
  const detail = useTrainingResource<TrainingSessionView[]>(() => [], scope);
  const lessons = useTrainingResource<TrainingSessionView[]>(() => [], scope);
  const enrollments = useTrainingResource<TrainingEnrollmentView[]>(
    () => [],
    scope,
  );
  const corrections = useTrainingResource<TrainingCorrectionView[]>(
    () => [],
    scope,
  );
  async function refresh() {
    await Promise.all([
      list.refresh(),
      lessons.load(() => endpoints.trainingSessions({ upcoming: "true" })),
      detail.load(async () => {
        const target = detailQuery();
        if (target.id) return [await endpoints.trainingSession(target.id)];
        if (target.attendanceId) return (await endpoints.trainingSessionPage({ attendanceId: target.attendanceId })).items;
        return [];
      }),
      enrollments.load(() => endpoints.adminEnrollments()),
      corrections.load(() => endpoints.trainingConsumeCorrections()),
    ]);
  }
  function reset() {
    lessons.reset();
    list.reset();
    detail.reset();
    enrollments.reset();
    corrections.reset();
  }
  return {
    lessons: computed(() => [...new Map([...list.items.value, ...lessons.data.value, ...detail.data.value].map(item => [item.id, item])).values()]),
    list,
    enrollments: enrollments.data,
    corrections: corrections.data,
    error: computed(
      () =>
        detail.error.value ||
        lessons.error.value ||
        enrollments.error.value ||
        corrections.error.value,
    ),
    refresh,
    reset,
  };
}
