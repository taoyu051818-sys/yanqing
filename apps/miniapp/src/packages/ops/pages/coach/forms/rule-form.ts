import { ref } from "vue";
import { today as shanghaiDate } from "../../../../../utils/format";

export function useYouthRuleForm() {
  const ruleMaxSessions = ref("");
  const ruleMaxValidityDays = ref("");
  const ruleMaxAmountYuan = ref("");
  const ruleWarningDays = ref("0");
  const ruleHardBlock = ref(true);
  const ruleEffectiveImmediately = ref(true);
  const ruleEffectiveDate = ref(shanghaiDate(1));
  const ruleEffectiveTime = ref("09:00");
  const ruleReason = ref("");
  return {
    ruleMaxSessions,
    ruleMaxValidityDays,
    ruleMaxAmountYuan,
    ruleWarningDays,
    ruleHardBlock,
    ruleEffectiveImmediately,
    ruleEffectiveDate,
    ruleEffectiveTime,
    ruleReason,
  };
}
