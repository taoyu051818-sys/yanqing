import type {
  TrainingEnrollmentView,
  TrainingProductView,
  TrainingSessionView,
} from "@yanqing/shared";
import type { Ref, ComputedRef } from "vue";
import { nextTick } from "vue";
import { endpoints } from "../../../../../services/api";
import type { useSessionStore } from "../../../../../stores/session";
import type { CourtAvailability } from "../../../../../types/domain";
import {
  findOpsDeepLinkRecord,
  opsDeepLinkDomId,
  type OpsDeepLinkQuery,
} from "../../../../../utils/work-item-deep-link";

interface ActionContext {
  session: ReturnType<typeof useSessionStore>;
  mayViewTraining: ComputedRef<boolean>;
  errorMessage: Ref<string, string>;
  loading: Ref<boolean, boolean>;
  canManageTrials: ComputedRef<boolean>;
  canConfigureTraining: ComputedRef<boolean>;
  lessons: Ref<TrainingSessionView[]>;
  enrollments: Ref<TrainingEnrollmentView[]>;
  corrections: Ref<any[], any[]>;
  products: Ref<TrainingProductView[]>;
  trials: Ref<any[], any[]>;
  leads: Ref<any[], any[]>;
  trialStudents: Ref<any[], any[]>;
  trialMembers: Ref<any[], any[]>;
  activeYouthRule: Ref<any, any>;
  youthRules: Ref<any[], any[]>;
  staffUsers: Ref<any[], any[]>;
  classProductIndex: Ref<number, number>;
  activeProducts: ComputedRef<TrainingProductView[]>;
  sessionClassIndex: Ref<number, number>;
  sessionClasses: ComputedRef<any[]>;
  trialSessionIndex: Ref<number, number>;
  schedulableTrialSessions: ComputedRef<TrainingSessionView[]>;
  selectedTrialClass: ComputedRef<any>;
  trialCoachId: Ref<string, string>;
  canCreateSession: ComputedRef<boolean>;
  managementView: Ref<string, string>;
  managementViewHandled: Ref<boolean, boolean>;
  deepLinkHandled: Ref<boolean, boolean>;
  deepLinkQuery: Ref<OpsDeepLinkQuery>;
  focusedRecord: Ref<string, string>;
  courtAvailability: Ref<CourtAvailability | null>;
  sessionDate: Ref<string, string>;
  selectedCourtIds: Ref<string[], string[]>;
  sessionCourts: ComputedRef<
    { id: string; name: string; usage: string; enabled: boolean }[]
  >;
}

export function useCoachLoadingActions({
  session,
  mayViewTraining,
  errorMessage,
  loading,
  canManageTrials,
  canConfigureTraining,
  lessons,
  enrollments,
  corrections,
  products,
  trials,
  leads,
  trialStudents,
  trialMembers,
  activeYouthRule,
  youthRules,
  staffUsers,
  classProductIndex,
  activeProducts,
  sessionClassIndex,
  sessionClasses,
  trialSessionIndex,
  schedulableTrialSessions,
  selectedTrialClass,
  trialCoachId,
  canCreateSession,
  managementView,
  managementViewHandled,
  deepLinkHandled,
  deepLinkQuery,
  focusedRecord,
  courtAvailability,
  sessionDate,
  selectedCourtIds,
  sessionCourts,
}: ActionContext) {
  async function load() {
    await session.hydrate();
    if (!mayViewTraining.value) {
      errorMessage.value = "当前账号没有培训经营页权限。";
      return;
    }
    loading.value = true;
    errorMessage.value = "";
    const result = await Promise.allSettled([
      endpoints.trainingSessions(),
      endpoints.adminEnrollments(),
      endpoints.trainingConsumeCorrections(),
      endpoints.trainingProducts(),
      endpoints.trainingTrials(),
      canManageTrials.value
        ? endpoints.customerLeads()
        : Promise.resolve({ items: [] }),
      canManageTrials.value
        ? endpoints.adminTrainingStudents()
        : Promise.resolve([]),
      canManageTrials.value
        ? endpoints.members()
        : Promise.resolve({ items: [] }),
      endpoints.activeYouthTrainingRule(),
      canConfigureTraining.value
        ? endpoints.youthTrainingRules()
        : Promise.resolve([]),
      canConfigureTraining.value
        ? endpoints.governanceUsers({ page: 1, pageSize: 100 })
        : Promise.resolve({ items: [] }),
    ]);
    if (result[0].status === "fulfilled") lessons.value = result[0].value || [];
    if (result[1].status === "fulfilled")
      enrollments.value = result[1].value || [];
    if (result[2].status === "fulfilled")
      corrections.value = result[2].value || [];
    if (result[3].status === "fulfilled")
      products.value = result[3].value || [];
    if (result[4].status === "fulfilled") trials.value = result[4].value || [];
    if (result[5].status === "fulfilled")
      leads.value = (result[5].value as any)?.items || [];
    if (result[6].status === "fulfilled")
      trialStudents.value = result[6].value || [];
    if (result[7].status === "fulfilled")
      trialMembers.value =
        (result[7].value as any)?.items || result[7].value || [];
    if (result[8].status === "fulfilled")
      activeYouthRule.value = result[8].value || null;
    if (result[9].status === "fulfilled")
      youthRules.value = result[9].value || [];
    if (result[10].status === "fulfilled") {
      const payload: any = result[10].value;
      staffUsers.value = Array.isArray(payload)
        ? payload
        : payload?.items || [];
    }
    const failed = result.find((item) => item.status === "rejected") as
      PromiseRejectedResult | undefined;
    if (failed)
      errorMessage.value =
        failed.reason?.message || "部分培训经营数据加载失败。";
    if (classProductIndex.value >= activeProducts.value.length)
      classProductIndex.value = 0;
    if (sessionClassIndex.value >= sessionClasses.value.length)
      sessionClassIndex.value = 0;
    if (trialSessionIndex.value >= schedulableTrialSessions.value.length)
      trialSessionIndex.value = 0;
    if (selectedTrialClass.value?.coachId)
      trialCoachId.value = selectedTrialClass.value.coachId;
    if (canCreateSession.value) await loadCourtAvailability();
    loading.value = false;
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

  async function applyCoachDeepLink() {
    if (deepLinkHandled.value || !deepLinkQuery.value.focus) return;
    const focus = deepLinkQuery.value.focus;
    let record: any = null;
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
          (enrollment.attendances || []).map((attendance: any) => ({
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

  async function loadCourtAvailability() {
    try {
      courtAvailability.value = await endpoints.availability(sessionDate.value);
      selectedCourtIds.value = selectedCourtIds.value.filter((id) =>
        sessionCourts.value.some((court) => court.id === id),
      );
    } catch (cause: any) {
      errorMessage.value = cause?.message || "场地可用状态加载失败。";
    }
  }
  return { load, applyCoachDeepLink, loadCourtAvailability };
}
