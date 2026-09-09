import { ref } from "vue";

export function useTrainingTrialForm() {
  const trialSubjectOptions = ["会员", "客户线索", "青少年学员"];
  const trialSubjectIndex = ref(0);
  const trialMemberIndex = ref(0);
  const trialLeadIndex = ref(0);
  const trialStudentIndex = ref(0);
  const trialSessionIndex = ref(0);
  const trialCoachId = ref("");
  const trialSourceOptions = [
    { value: "STORE_VISIT", label: "到店咨询" },
    { value: "WECHAT_GROUP", label: "微信群" },
    { value: "DOUYIN", label: "抖音" },
    { value: "REFERRAL", label: "好友推荐" },
    { value: "OTHER", label: "其他渠道" },
  ];
  const trialSourceIndex = ref(0);
  const trialReason = ref("");
  const trialLinkLead = ref(false);
  return {
    trialSubjectOptions,
    trialSubjectIndex,
    trialMemberIndex,
    trialLeadIndex,
    trialStudentIndex,
    trialSessionIndex,
    trialCoachId,
    trialSourceOptions,
    trialSourceIndex,
    trialReason,
    trialLinkLead,
  };
}
