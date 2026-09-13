<script setup lang="ts">
import { useCoachViewModel } from "./actions/projection.js";

import { useTrainingProductForm } from "./forms/product-form";
import { useTrainingClassForm } from "./forms/class-form";
import { useTrainingSessionForm } from "./forms/session-form";
import { useTrainingTrialForm } from "./forms/trial-form";
import { useYouthRuleForm } from "./forms/rule-form";

import { useCoachTeachingData } from "./data/teaching";
import { useCoachCatalogData } from "./data/catalog";
import { useCoachTrialData } from "./data/trials";
import { useCoachYouthRuleData } from "./data/youth-rules";
import { useCoachCourtData } from "./data/courts";
import { useCoachNavigation } from "./actions/navigation";
import { useCoachLoadingActions } from "./actions/loading.js";

import TrialAppointments from "./sections/TrialAppointments.vue";
import YouthRules from "./sections/YouthRules.vue";
import TrainingProducts from "./sections/TrainingProducts.vue";
import TrainingConfiguration from "./sections/TrainingConfiguration.vue";
import TrainingSchedule from "./sections/TrainingSchedule.vue";
import LessonAttendance from "./sections/LessonAttendance.vue";
import ConsumptionCorrections from "./sections/ConsumptionCorrections.vue";

import { onUnmounted, ref } from "vue";
import { onLoad, onShow } from "@dcloudio/uni-app";
import OperationsFrame from "../../components/OperationsFrame.vue";
import OperationTask from "../../components/OperationTask.vue";
import { useOperationTask } from "../../components/operation-task";
import MetricCard from "../../../../components/MetricCard.vue";
import { useSessionStore } from "../../../../stores/session";
import { useCoachCatalogActions } from "./actions/catalog.js";
import { useCoachScheduleActions } from "./actions/schedule.js";
import { useCoachTrialsActions } from "./actions/trials.js";
import { useCoachRulesActions } from "./actions/rules.js";
import { useCoachCorrectionsActions } from "./actions/corrections.js";
import { useCoachAttendanceActions } from "./actions/attendance.js";
const task = useOperationTask();

const session = useSessionStore();

const dataScope = () =>
  `${session.user?.id || ""}:${[...session.roles].sort().join(",")}`;
const teaching = useCoachTeachingData(dataScope);
const catalog = useCoachCatalogData(dataScope);
const trialData = useCoachTrialData(dataScope);
const rulesData = useCoachYouthRuleData(dataScope);
const { lessons, enrollments, corrections } = teaching;
const { products, staffUsers } = catalog;
const { trials, leads, trialStudents, trialMembers } = trialData;
const { activeYouthRule, youthRules } = rulesData;
const navigation = useCoachNavigation({
  lessons,
  enrollments,
  corrections,
  trials,
});
const { focusedRecord } = navigation;

const actionKey = ref("");

const actionMessage = ref("");

const {
  productCode,
  productName,
  productAudienceIndex,
  productTotalSessions,
  productValidityDays,
  productPriceYuan,
  productReason,
  audienceOptions,
  editingProductId,
  editProductName,
  editProductTotalSessions,
  editProductValidityDays,
  editProductPriceYuan,
  editProductReason,
} = useTrainingProductForm();

const {
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
} = useTrainingClassForm();

const {
  sessionClassIndex,
  sessionDate,
  sessionStartTime,
  sessionEndTime,
  selectedCourtIds,
  sessionNote,
  sessionReason,
} = useTrainingSessionForm();

const courtData = useCoachCourtData(dataScope, sessionDate, selectedCourtIds);
const { courtAvailability } = courtData;

const {
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
} = useTrainingTrialForm();

const {
  ruleMaxSessions,
  ruleMaxValidityDays,
  ruleMaxAmountYuan,
  ruleWarningDays,
  ruleHardBlock,
  ruleEffectiveDate,
  ruleEffectiveTime,
  ruleReason,
} = useYouthRuleForm();

const {
  mayViewTraining,
  canConfigureTraining,
  canManageTrials,
  canAssessTrials,
  canConvertTrials,
  canDraftYouthRule,
  canReviewYouthRule,
  canCreateSession,
  canProposeConsume,
  roleLabel,
  isChecker,
  canMarkAttendance,
  canRequestCorrection,
  coachUsers,
  coachOptions,
  requestedCorrections,
  activeProducts,
  activeClasses,
  sessionClasses,
  selectedClassProduct,
  selectedSessionClass,
  schedulableTrialSessions,
  selectedTrialSession,
  selectedTrialClass,
  selectedTrialProduct,
  selectedTrialSubject,
  sessionCourts,
  sessionStartsAt,
  sessionEndsAt,
  blockedCourtIds,
  activeLessons,
  activeStudents,
  metrics,
} = useCoachViewModel({
  session,
  staffUsers,
  corrections,
  products,
  classProductIndex,
  sessionClassIndex,
  lessons,
  trialSessionIndex,
  trialSubjectIndex,
  leads,
  trialLeadIndex,
  trialStudents,
  trialStudentIndex,
  trialMembers,
  trialMemberIndex,
  courtAvailability,
  sessionDate,
  sessionStartTime,
  sessionEndTime,
  enrollments,
  trials,
});

async function loadCourtAvailability() {
  await courtData.refresh();
  if (courtData.error.value) errorMessage.value = courtData.error.value;
}

const { loading, errorMessage, load, dispose } = useCoachLoadingActions({
  session,
  mayViewTraining,
  async refreshData() {
    await Promise.all([
      teaching.refresh(),
      catalog.refresh(canConfigureTraining.value),
      trialData.refresh(canManageTrials.value),
      rulesData.refresh(canConfigureTraining.value),
    ]);
    return (
      teaching.error.value ||
      catalog.error.value ||
      trialData.error.value ||
      rulesData.error.value
    );
  },
  resetData() {
    teaching.reset();
    catalog.reset();
    trialData.reset();
    rulesData.reset();
    courtData.reset();
  },
  async afterRefresh(isCurrent) {
    if (classProductIndex.value >= activeProducts.value.length)
      classProductIndex.value = 0;
    if (sessionClassIndex.value >= sessionClasses.value.length)
      sessionClassIndex.value = 0;
    if (trialSessionIndex.value >= schedulableTrialSessions.value.length)
      trialSessionIndex.value = 0;
    if (selectedTrialClass.value?.coachId)
      trialCoachId.value = selectedTrialClass.value.coachId;
    if (canCreateSession.value) await loadCourtAvailability();
    if (isCurrent()) await navigation.apply();
  },
});

function coachDisplayName(
  coachId?: string | null,
  fallback = "班级教练待配置",
) {
  if (!coachId) return fallback;
  if (coachId === session.user?.id)
    return session.user?.displayName || "当前教练";
  const staff = staffUsers.value.find((item) => item.id === coachId);
  if (staff?.displayName) return staff.displayName;
  const trial = trials.value.find(
    (item) => item.coachId === coachId && item.coach?.displayName,
  );
  return trial?.coach?.displayName || "已配置教练";
}

async function runCreation(
  key: string,
  successMessage: string,
  operation: () => Promise<unknown>,
) {
  if (actionKey.value || loading.value) return false;
  actionKey.value = key;
  errorMessage.value = "";
  uni.showLoading({ title: "创建中", mask: true });
  try {
    await operation();
    actionMessage.value = successMessage;
    await load();
    uni.showToast({ title: "创建成功", icon: "success" });
    return true;
  } catch (cause: any) {
    errorMessage.value = cause?.message || "培训经营配置创建失败。";
    uni.showToast({ title: errorMessage.value, icon: "none" });
    return false;
  } finally {
    uni.hideLoading();
    actionKey.value = "";
  }
}

const {
  createProduct,
  beginProductEdit,
  cancelProductEdit,
  updateProduct,
  createClass,
  changeClassCoach,
  changeClassAssistant,
} = useCoachCatalogActions({
  canConfigureTraining,
  actionKey,
  errorMessage,
  productCode,
  productName,
  productReason,
  audienceOptions,
  productAudienceIndex,
  productTotalSessions,
  productValidityDays,
  productPriceYuan,
  runCreation: (...args: Parameters<typeof runCreation>) =>
    runCreation(...args),
  editingProductId,
  editProductName,
  editProductTotalSessions,
  editProductValidityDays,
  editProductPriceYuan,
  editProductReason,
  task,
  load: (...args: Parameters<typeof load>) => load(...args),
  actionMessage,
  selectedClassProduct,
  classCode,
  className,
  classReason,
  classEndTime,
  classStartTime,
  classCoachId,
  classAssistantId,
  classWeekdayIndex,
  classCapacity,
  classCoachCostYuan,
  classAssistantCostYuan,
  classMaterialCostYuan,
  weekdayOptions,
  coachOptions,
});

const {
  changeSessionDate,
  changeSessionCourts,
  isCourtBlocked,
  createSession,
} = useCoachScheduleActions({
  sessionDate,
  selectedCourtIds,
  loadCourtAvailability: (...args: Parameters<typeof loadCourtAvailability>) =>
    loadCourtAvailability(...args),
  blockedCourtIds,
  canCreateSession,
  actionKey,
  errorMessage,
  selectedSessionClass,
  sessionStartsAt,
  sessionEndsAt,
  sessionReason,
  sessionNote,
  sessionCourts,
  sessionStartTime,
  sessionEndTime,
  runCreation: (...args: Parameters<typeof runCreation>) =>
    runCreation(...args),
});

const {
  changeTrialSession,
  setTrialLinkLead,
  createTrial,
  transitionTrial,
  assessTrial,
  convertTrial,
  trialSourceLabel,
} = useCoachTrialsActions({
  trialSessionIndex,
  trialCoachId,
  selectedTrialClass,
  trialLinkLead,
  canManageTrials,
  actionKey,
  selectedTrialSession,
  selectedTrialProduct,
  selectedTrialSubject,
  trialReason,
  trialSubjectIndex,
  trialSourceOptions,
  trialSourceIndex,
  leads,
  trialLeadIndex,
  coachDisplayName: (...args: Parameters<typeof coachDisplayName>) =>
    coachDisplayName(...args),
  runCreation: (...args: Parameters<typeof runCreation>) =>
    runCreation(...args),
  errorMessage,
  task,
  operationWindowReason: (...args: Parameters<typeof operationWindowReason>) =>
    operationWindowReason(...args),
  load: (...args: Parameters<typeof load>) => load(...args),
  canAssessTrials,
  canConvertTrials,
  enrollments,
});

const { setRuleHardBlock, createYouthRule, decideYouthRule } =
  useCoachRulesActions({
    ruleHardBlock,
    canDraftYouthRule,
    actionKey,
    ruleReason,
    ruleMaxSessions,
    ruleMaxValidityDays,
    ruleMaxAmountYuan,
    ruleWarningDays,
    ruleEffectiveDate,
    ruleEffectiveTime,
    runCreation: (...args: Parameters<typeof runCreation>) =>
      runCreation(...args),
    errorMessage,
    canReviewYouthRule,
    task,
    load: (...args: Parameters<typeof load>) => load(...args),
  });

const {
  recognitionTimeline,
  activeRecognition,
  activeCorrection,
  isOwnCorrection,
  correctionStudentName,
  requestCorrection,
  decideCorrection,
} = useCoachCorrectionsActions({
  attendanceFor: (...args: Parameters<typeof attendanceFor>) =>
    attendanceFor(...args),
  corrections,
  session,
  canRequestCorrection,
  errorMessage,
  task,
  load: (...args: Parameters<typeof load>) => load(...args),
  isChecker,
});

const {
  studentsFor,
  isActiveEnrollment,
  canScheduleMakeup,
  scheduleMakeup,
  attendanceFor,
  attendanceStatus,
  isRefundPending,
  attendanceLabel,
  hasPendingProposal,
  isConsumableLesson,
  lessonWindowState,
  canUseLessonWindow,
  attendanceWindowHint,
  completionActionLabel,
  hasUnresolvedAttendance,
  operationWindowReason,
  mark,
  propose,
  confirm,
  complete,
} = useCoachAttendanceActions({
  enrollments,
  lessons,
  session,
  task,
  load: (...args: Parameters<typeof load>) => load(...args),
  errorMessage,
});

onLoad(navigation.setQuery);
onShow(load);
onUnmounted(dispose);
</script>

<template>
  <OperationsFrame
    access="training"
    icon="training"
    title="培训运营"
    eyebrow="TRAINING OPERATIONS"
    :role="roleLabel"
    description="以课表为主线，按点名、消课建议、主管确认和课后反馈完成培训账本闭环。"
  >
    <OperationTask :task="task" />
    <view v-if="errorMessage" class="card error-panel">
      <view
        ><text class="panel-title">操作未完成</text
        ><text class="muted">{{ errorMessage }}</text></view
      >
      <button
        class="secondary inline"
        :disabled="loading || Boolean(actionKey)"
        @tap="load"
      >
        重试
      </button>
    </view>
    <view class="metric-grid"
      ><MetricCard
        v-for="item in metrics"
        :key="item[0]"
        :label="item[0]"
        :value="item[1]"
        :note="item[2]"
    /></view>
    <view v-if="actionMessage" class="notice card">{{ actionMessage }}</view>

    <TrialAppointments
      :trials="trials"
      :canManageTrials="canManageTrials"
      :trialSubjectOptions="trialSubjectOptions"
      v-model:trialSubjectIndex="trialSubjectIndex"
      :trialMembers="trialMembers"
      :selectTrialMember="(member) => { trialMembers = [member, ...trialMembers.filter(item => item.id !== member.id)]; trialMemberIndex = 0 }"
      v-model:trialMemberIndex="trialMemberIndex"
      :selectedTrialSubject="selectedTrialSubject"
      :leads="leads"
      v-model:trialLeadIndex="trialLeadIndex"
      :trialStudents="trialStudents"
      v-model:trialStudentIndex="trialStudentIndex"
      :trialLinkLead="trialLinkLead"
      :setTrialLinkLead="setTrialLinkLead"
      :schedulableTrialSessions="schedulableTrialSessions"
      :trialSessionIndex="trialSessionIndex"
      :changeTrialSession="changeTrialSession"
      :selectedTrialSession="selectedTrialSession"
      :selectedTrialClass="selectedTrialClass"
      :selectedTrialProduct="selectedTrialProduct"
      :coachDisplayName="coachDisplayName"
      :trialCoachId="trialCoachId"
      :trialSourceOptions="trialSourceOptions"
      v-model:trialSourceIndex="trialSourceIndex"
      v-model:trialReason="trialReason"
      :actionKey="actionKey"
      :loading="loading"
      :createTrial="createTrial"
      :focusedRecord="focusedRecord"
      :trialSourceLabel="trialSourceLabel"
      :transitionTrial="transitionTrial"
      :canAssessTrials="canAssessTrials"
      :assessTrial="assessTrial"
      :canConvertTrials="canConvertTrials"
      :convertTrial="convertTrial"
    />

    <YouthRules
      v-if="canConfigureTraining"
      :canConfigureTraining="canConfigureTraining"
      :activeYouthRule="activeYouthRule"
      :canDraftYouthRule="canDraftYouthRule"
      v-model:ruleMaxSessions="ruleMaxSessions"
      v-model:ruleMaxValidityDays="ruleMaxValidityDays"
      v-model:ruleMaxAmountYuan="ruleMaxAmountYuan"
      v-model:ruleWarningDays="ruleWarningDays"
      v-model:ruleEffectiveDate="ruleEffectiveDate"
      v-model:ruleEffectiveTime="ruleEffectiveTime"
      :ruleHardBlock="ruleHardBlock"
      :setRuleHardBlock="setRuleHardBlock"
      v-model:ruleReason="ruleReason"
      :actionKey="actionKey"
      :loading="loading"
      :createYouthRule="createYouthRule"
      :youthRules="youthRules"
      :canReviewYouthRule="canReviewYouthRule"
      :decideYouthRule="decideYouthRule"
    />

    <TrainingProducts
      :activeProducts="activeProducts"
      :activeClasses="activeClasses"
      :products="products"
      :coachDisplayName="coachDisplayName"
      :canConfigureTraining="canConfigureTraining"
      :actionKey="actionKey"
      :beginProductEdit="beginProductEdit"
      :updateProduct="updateProduct"
      :editingProductId="editingProductId"
      v-model:editProductName="editProductName"
      v-model:editProductTotalSessions="editProductTotalSessions"
      v-model:editProductValidityDays="editProductValidityDays"
      v-model:editProductPriceYuan="editProductPriceYuan"
      v-model:editProductReason="editProductReason"
      :cancelProductEdit="cancelProductEdit"
      :loading="loading"
    />

    <TrainingConfiguration
      v-if="canConfigureTraining"
      :canConfigureTraining="canConfigureTraining"
      v-model:productCode="productCode"
      v-model:productName="productName"
      :audienceOptions="audienceOptions"
      v-model:productAudienceIndex="productAudienceIndex"
      v-model:productTotalSessions="productTotalSessions"
      v-model:productValidityDays="productValidityDays"
      v-model:productPriceYuan="productPriceYuan"
      v-model:productReason="productReason"
      :actionKey="actionKey"
      :loading="loading"
      :createProduct="createProduct"
      :activeProducts="activeProducts"
      v-model:classProductIndex="classProductIndex"
      :selectedClassProduct="selectedClassProduct"
      v-model:classCode="classCode"
      v-model:className="className"
      :weekdayOptions="weekdayOptions"
      v-model:classWeekdayIndex="classWeekdayIndex"
      v-model:classStartTime="classStartTime"
      v-model:classEndTime="classEndTime"
      v-model:classCapacity="classCapacity"
      :coachOptions="coachOptions"
      :changeClassCoach="changeClassCoach"
      :coachDisplayName="coachDisplayName"
      :classCoachId="classCoachId"
      :changeClassAssistant="changeClassAssistant"
      :classAssistantId="classAssistantId"
      v-model:classCoachCostYuan="classCoachCostYuan"
      v-model:classAssistantCostYuan="classAssistantCostYuan"
      v-model:classMaterialCostYuan="classMaterialCostYuan"
      v-model:classReason="classReason"
      :createClass="createClass"
    />

    <TrainingSchedule
      v-if="canCreateSession"
      :canCreateSession="canCreateSession"
      :sessionClasses="sessionClasses"
      v-model:sessionClassIndex="sessionClassIndex"
      :selectedSessionClass="selectedSessionClass"
      :sessionDate="sessionDate"
      :changeSessionDate="changeSessionDate"
      v-model:sessionStartTime="sessionStartTime"
      v-model:sessionEndTime="sessionEndTime"
      :changeSessionCourts="changeSessionCourts"
      :sessionCourts="sessionCourts"
      :isCourtBlocked="isCourtBlocked"
      :selectedCourtIds="selectedCourtIds"
      v-model:sessionNote="sessionNote"
      v-model:sessionReason="sessionReason"
      :actionKey="actionKey"
      :loading="loading"
      :createSession="createSession"
    />

    <LessonAttendance
      :loading="loading"
      :activeLessons="activeLessons"
      :lessons="lessons"
      :focusedRecord="focusedRecord"
      :studentsFor="studentsFor"
      :isActiveEnrollment="isActiveEnrollment"
      :canScheduleMakeup="canScheduleMakeup"
      :scheduleMakeup="scheduleMakeup"
      :attendanceStatus="attendanceStatus"
      :attendanceLabel="attendanceLabel"
      :recognitionTimeline="recognitionTimeline"
      :isConsumableLesson="isConsumableLesson"
      :canMarkAttendance="canMarkAttendance"
      :canUseLessonWindow="canUseLessonWindow"
      :attendanceWindowHint="attendanceWindowHint"
      :mark="mark"
      :isRefundPending="isRefundPending"
      :canProposeConsume="canProposeConsume"
      :hasPendingProposal="hasPendingProposal"
      :attendanceFor="attendanceFor"
      :propose="propose"
      :isChecker="isChecker"
      :session="session"
      :confirm="confirm"
      :completionActionLabel="completionActionLabel"
      :canRequestCorrection="canRequestCorrection"
      :activeRecognition="activeRecognition"
      :activeCorrection="activeCorrection"
      :requestCorrection="requestCorrection"
      :canCreateSession="canCreateSession"
      :hasUnresolvedAttendance="hasUnresolvedAttendance"
      :complete="complete"
      :lessonWindowState="lessonWindowState"
    />
    <ConsumptionCorrections
      :corrections="corrections"
      :focusedRecord="focusedRecord"
      :correctionStudentName="correctionStudentName"
      :attendanceLabel="attendanceLabel"
      :isChecker="isChecker"
      :isOwnCorrection="isOwnCorrection"
      :decideCorrection="decideCorrection"
      :loading="loading"
    />
    <view class="section-title">教练工作边界</view>
    <view class="card boundary"
      ><text class="muted"
        >教练可处理学员出勤、消课与训练反馈；退款审批、库存调整和结算发布由对应岗位处理。</text
      ></view
    >
  </OperationsFrame>
</template>

<style scoped src="./page.css"></style>
