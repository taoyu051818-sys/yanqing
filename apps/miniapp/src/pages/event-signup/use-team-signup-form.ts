import { computed, reactive, ref, type Ref } from "vue";
import type { DoublesCategory } from "../../types/event-signup";
import { participantError, participantPhone } from "../../utils/event-signup";

/** Form state is local to one team signup; resetting also clears consent and contact details. */
export function useTeamSignupForm(error: Ref<string>) {
  const mode = ref<"MANUAL" | "INVITE">("MANUAL");
  const consent = ref(false),
    captainPlays = ref(true);
  const form = reactive({
    name: "",
    playerAName: "",
    playerAPhone: "",
    playerBName: "",
    playerBPhone: "",
  });
  const fieldErrors = reactive<Record<string, string>>({});
  const category = ref<DoublesCategory>("MIXED_DOUBLES");
  const categories: Array<{ value: DoublesCategory; label: string }> = [
    { value: "MEN_DOUBLES", label: "男双" },
    { value: "WOMEN_DOUBLES", label: "女双" },
    { value: "MIXED_DOUBLES", label: "混双" },
  ];
  const participants = [
    { label: "选手一", name: "playerAName", phone: "playerAPhone" },
    { label: "选手二", name: "playerBName", phone: "playerBPhone" },
  ] as const;
  const visibleParticipants = computed(() =>
    mode.value === "MANUAL" ? participants : participants.slice(0, 1),
  );
  function checkParticipant(which: "playerAName" | "playerBName") {
    const phoneKey = which === "playerAName" ? "playerAPhone" : "playerBPhone";
    const issue = participantError(form[which], form[phoneKey]);
    fieldErrors[which] = !form[which].trim() ? "请填写选手姓名" : "";
    fieldErrors[phoneKey] = form[which].trim() ? issue : "";
    return issue;
  }
  function validate(receiver = false) {
    error.value = "";
    let issue = "";
    if (!receiver && !form.name.trim()) {
      fieldErrors.name = "请填写队伍名称";
      issue = fieldErrors.name;
    }
    if (!receiver) issue ||= checkParticipant("playerAName");
    if (receiver || mode.value === "MANUAL")
      issue ||= checkParticipant("playerBName");
    if (
      !receiver &&
      mode.value === "MANUAL" &&
      participantPhone(form.playerAPhone) ===
        participantPhone(form.playerBPhone)
    )
      issue ||= "两位选手不能使用相同的联系电话";
    if (!consent.value)
      issue ||= receiver
        ? "请先确认同意组队及报名信息使用说明"
        : "请先确认已征得两位选手同意";
    if (issue) {
      error.value = issue;
      uni.showToast({ title: issue, icon: "none" });
    }
    return !issue;
  }
  function resetForm() {
    consent.value = false;
    captainPlays.value = true;
    mode.value = "MANUAL";
    category.value = "MIXED_DOUBLES";
    Object.assign(form, {
      name: "",
      playerAName: "",
      playerAPhone: "",
      playerBName: "",
      playerBPhone: "",
    });
    Object.keys(fieldErrors).forEach((key) => delete fieldErrors[key]);
  }
  return {
    mode,
    consent,
    captainPlays,
    form,
    fieldErrors,
    category,
    categories,
    visibleParticipants,
    checkParticipant,
    validate,
    resetForm,
  };
}
