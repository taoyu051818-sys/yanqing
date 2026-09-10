import { computed } from "vue";
import { endpoints } from "../../../../../services/api";
import type { MemberDirectoryItem } from "../../../../../types/domain";
import type {
  TrainingLeadSummary,
  TrainingStudentSummary,
  TrainingTrialView,
} from "../../../../../types/training-operations";
import { useTrainingResource, pageItems, type DataScope } from "./resource";

export function useCoachTrialData(scope: DataScope) {
  const trials = useTrainingResource<TrainingTrialView[]>(() => [], scope);
  const leads = useTrainingResource<TrainingLeadSummary[]>(() => [], scope);
  const students = useTrainingResource<TrainingStudentSummary[]>(
    () => [],
    scope,
  );
  const members = useTrainingResource<MemberDirectoryItem[]>(() => [], scope);
  async function refresh(canManage: boolean) {
    await Promise.all([
      trials.load(() => endpoints.trainingTrials()),
      leads.load(async () =>
        canManage ? pageItems(await endpoints.customerLeads()) : [],
      ),
      students.load(async () =>
        canManage ? await endpoints.adminTrainingStudents() : [],
      ),
      members.load(async () =>
        canManage ? pageItems(await endpoints.members()) : [],
      ),
    ]);
  }
  function reset() {
    trials.reset();
    leads.reset();
    students.reset();
    members.reset();
  }
  return {
    trials: trials.data,
    leads: leads.data,
    trialStudents: students.data,
    trialMembers: members.data,
    error: computed(
      () =>
        trials.error.value ||
        leads.error.value ||
        students.error.value ||
        members.error.value,
    ),
    refresh,
    reset,
  };
}
