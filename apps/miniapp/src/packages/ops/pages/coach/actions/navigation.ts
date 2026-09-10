import { nextTick, ref, type Ref } from "vue";
import type {
  TrainingEnrollmentView,
  TrainingSessionView,
} from "@yanqing/shared";
import type {
  TrainingCorrectionView,
  TrainingTrialView,
} from "../../../../../types/training-operations";
import {
  findOpsDeepLinkRecord,
  opsDeepLinkDomId,
  parseOpsDeepLinkQuery,
  type OpsDeepLinkQuery,
} from "../../../../../utils/work-item-deep-link";

export function useCoachNavigation({
  lessons,
  enrollments,
  corrections,
  trials,
}: {
  lessons: Ref<TrainingSessionView[]>;
  enrollments: Ref<TrainingEnrollmentView[]>;
  corrections: Ref<TrainingCorrectionView[]>;
  trials: Ref<TrainingTrialView[]>;
}) {
  const deepLinkQuery = ref<OpsDeepLinkQuery>({});
  const deepLinkHandled = ref(false);
  const focusedRecord = ref("");
  const managementView = ref("");
  const managementViewHandled = ref(false);
  function setQuery(options: Record<string, unknown> | undefined) {
    deepLinkQuery.value = parseOpsDeepLinkQuery(options);
    deepLinkHandled.value = false;
    focusedRecord.value = "";
    managementView.value =
      typeof options?.view === "string" ? options.view : "";
    managementViewHandled.value = false;
  }
  async function applyCoachDeepLink() {
    if (deepLinkHandled.value || !deepLinkQuery.value.focus) return;
    const focus = deepLinkQuery.value.focus;
    let record: { id: string } | null = null;
    let prefix = "";
    let label = "培训记录";
    if (focus === "consume-correction") {
      record = findOpsDeepLinkRecord(corrections.value, deepLinkQuery.value, [
        "id",
        "recognitionId",
        "attendanceId",
      ]);
      prefix = "coach-correction";
      label = "消课冲正申请";
    } else if (focus === "trial") {
      record = findOpsDeepLinkRecord(trials.value, deepLinkQuery.value, ["id"]);
      prefix = "coach-trial";
      label = "试听预约";
    } else if (focus === "attendance" || focus === "session") {
      record = findOpsDeepLinkRecord(lessons.value, deepLinkQuery.value, [
        "id",
      ]);
      if (!record) {
        const attendances = enrollments.value.flatMap((enrollment) =>
          (enrollment.attendances || []).map((attendance) => ({
            ...attendance,
            enrollmentId: enrollment.id,
          })),
        );
        const attendance = findOpsDeepLinkRecord(
          attendances,
          deepLinkQuery.value,
          ["id", "sessionId"],
        );
        if (attendance)
          record =
            lessons.value.find(
              (lesson) => lesson.id === attendance.sessionId,
            ) || null;
      }
      prefix = "coach-lesson";
      label = "培训课次或点名记录";
    } else {
      deepLinkHandled.value = true;
      uni.showToast({ title: `无法识别培训待办类型：${focus}`, icon: "none" });
      return;
    }
    deepLinkHandled.value = true;
    if (!record) {
      uni.showToast({
        title: `未找到待办对应的${label}，可能已处理或无权查看`,
        icon: "none",
      });
      return;
    }
    focusedRecord.value = `${prefix}:${record.id}`;
    await nextTick();
    uni.pageScrollTo({
      selector: `#${opsDeepLinkDomId(prefix, record.id)}`,
      duration: 250,
    });
  }

  async function apply() {
    await applyCoachDeepLink();
    if (managementView.value === "products" && !managementViewHandled.value) {
      managementViewHandled.value = true;
      await nextTick();
      uni.pageScrollTo({
        selector: "#training-product-management",
        duration: 280,
      });
    }
  }
  return { focusedRecord, setQuery, apply };
}
