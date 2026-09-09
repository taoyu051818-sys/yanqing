import { ref } from "vue";
import { today as shanghaiDate } from "../../../../../utils/format";

export function useTrainingSessionForm() {
  const sessionClassIndex = ref(0);
  const sessionDate = ref(shanghaiDate(1));
  const sessionStartTime = ref("19:00");
  const sessionEndTime = ref("21:00");
  const selectedCourtIds = ref<string[]>([]);
  const sessionNote = ref("");
  const sessionReason = ref("");
  return {
    sessionClassIndex,
    sessionDate,
    sessionStartTime,
    sessionEndTime,
    selectedCourtIds,
    sessionNote,
    sessionReason,
  };
}
