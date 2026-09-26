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
} from "../../../utils/work-item-deep-link";

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
  const activeView = ref("lessons");
  const lessonId = ref("");
  function setQuery(options: Record<string, unknown> | undefined) {
    deepLinkQuery.value = parseOpsDeepLinkQuery(options);
    deepLinkHandled.value = false;
    focusedRecord.value = "";
    const views = ['lessons', 'trials', 'products', 'rules', 'corrections', 'create-session', 'create-product', 'create-class', 'create-trial', 'edit-product'];
    activeView.value = typeof options?.view === 'string' && views.includes(options.view) ? options.view : 'lessons';
    lessonId.value = typeof options?.lessonId === 'string' ? options.lessonId : '';
    const titles: Record<string, string> = { 'create-trial':'预约试听', 'edit-product':'修改课程', 'create-session':'新建课次', 'create-product':'新建课程产品', 'create-class':'新建班级', products:'课程班级' };
    uni.setNavigationBarTitle({ title: lessonId.value ? '课次详情' : titles[activeView.value] || '培训管理' });
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
      activeView.value = "corrections";
      prefix = "coach-correction";
      label = "消课冲正申请";
    } else if (focus === "trial") {
      record = findOpsDeepLinkRecord(trials.value, deepLinkQuery.value, ["id"]);
      activeView.value = "trials";
      prefix = "coach-trial";
      label = "试听预约";
    } else if (focus === "attendance" || focus === "session") {
      record = findOpsDeepLinkRecord(lessons.value, deepLinkQuery.value, [
        "id",
      ]);
      if (!record) {
        record = lessons.value.find(lesson => findOpsDeepLinkRecord(lesson.attendances || [], deepLinkQuery.value, ["id", "sessionId"])) || null;
      }
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
    if (prefix === 'coach-lesson') { activeView.value = 'lessons'; lessonId.value = record.id; uni.setNavigationBarTitle({ title:'课次详情' }); }
    await nextTick();
    uni.pageScrollTo({
      selector: `#${opsDeepLinkDomId(prefix, record.id)}`,
      duration: 250,
    });
  }

  function sessionQuery() {
    if (lessonId.value) return { id: lessonId.value };
    const query = deepLinkQuery.value;
    if (query.focus === "session") return { id: query.sessionId || query.id };
    if (query.focus === "attendance") return query.sessionId ? { id: query.sessionId } : { attendanceId: query.attendanceId || query.id };
    return {};
  }
  return { focusedRecord, activeView, lessonId, setQuery, sessionQuery, apply: applyCoachDeepLink };
}
