import { ref } from "vue";

export function useTrainingClassForm() {
  const classCode = ref("");
  const className = ref("");
  const classProductIndex = ref(0);
  const classWeekdayIndex = ref(2);
  const classStartTime = ref("19:00");
  const classEndTime = ref("21:00");
  const classCapacity = ref("12");
  const classCoachId = ref("");
  const classAssistantId = ref("");
  const classCoachCostYuan = ref("200");
  const classAssistantCostYuan = ref("0");
  const classMaterialCostYuan = ref("0");
  const classReason = ref("");
  const weekdayOptions = [
    "周一",
    "周二",
    "周三",
    "周四",
    "周五",
    "周六",
    "周日",
  ];
  return {
    classCode,
    className,
    classProductIndex,
    classWeekdayIndex,
    classStartTime,
    classEndTime,
    classCapacity,
    classCoachId,
    classAssistantId,
    classCoachCostYuan,
    classAssistantCostYuan,
    classMaterialCostYuan,
    classReason,
    weekdayOptions,
  };
}
