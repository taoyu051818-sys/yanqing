import type {
  TrainingEnrollmentView,
  TrainingSessionView,
} from "@yanqing/shared";
import { computed } from "vue";
import { endpoints } from "../../../../../services/api";
import type { TrainingCorrectionView } from "../../../../../types/training-operations";
import { useTrainingResource, type DataScope } from "./resource";

export function useCoachTeachingData(scope: DataScope) {
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
      lessons.load(() => endpoints.trainingSessions()),
      enrollments.load(() => endpoints.adminEnrollments()),
      corrections.load(() => endpoints.trainingConsumeCorrections()),
    ]);
  }
  function reset() {
    lessons.reset();
    enrollments.reset();
    corrections.reset();
  }
  return {
    lessons: lessons.data,
    enrollments: enrollments.data,
    corrections: corrections.data,
    error: computed(
      () =>
        lessons.error.value ||
        enrollments.error.value ||
        corrections.error.value,
    ),
    refresh,
    reset,
  };
}
