<script setup lang="ts">
import { useCoachViewModel } from "./actions/projection.js";

import { useTrainingProductForm } from "./forms/product-form";
import { useTrainingClassForm } from "./forms/class-form";
import { useTrainingSessionForm } from "./forms/session-form";
import { useTrainingTrialForm } from "./forms/trial-form";
import { useYouthRuleForm } from "./forms/rule-form";

import { useCoachLoadingActions } from "./actions/loading.js";

import TrialAppointments from "./sections/TrialAppointments.vue";
import YouthRules from "./sections/YouthRules.vue";
import TrainingProducts from "./sections/TrainingProducts.vue";
import TrainingConfiguration from "./sections/TrainingConfiguration.vue";
import TrainingSchedule from "./sections/TrainingSchedule.vue";
import LessonAttendance from "./sections/LessonAttendance.vue";
import ConsumptionCorrections from "./sections/ConsumptionCorrections.vue";

import { computed, nextTick, ref } from "vue";
import { onLoad, onShow } from "@dcloudio/uni-app";
import OperationsFrame from "../../components/OperationsFrame.vue";
import OperationTask from "../../components/OperationTask.vue";
import { useOperationTask, reasonField } from "../../components/operation-task";
import MetricCard from "../../../../components/MetricCard.vue";
import StatusBadge from "../../../../components/StatusBadge.vue";
import { hasOperationsAccess } from "../../../../config/operations";
import { endpoints } from "../../../../services/api";
import { useSessionStore } from "../../../../stores/session";
import type { CourtAvailability } from "../../../../types/domain";
import {
  idempotencyKey,
  money,
  shortDate,
  today as shanghaiDate,
} from "../../../../utils/format";
import { withPendingCreationKey } from "../../../../utils/pending-creation-key";
import {
  findOpsDeepLinkRecord,
  opsDeepLinkDomId,
  parseOpsDeepLinkQuery,
  type OpsDeepLinkQuery,
} from "../../../../utils/work-item-deep-link";
import { useCoachCatalogActions } from "./actions/catalog.js";
import { useCoachScheduleActions } from "./actions/schedule.js";
import { useCoachTrialsActions } from "./actions/trials.js";
import { useCoachRulesActions } from "./actions/rules.js";
import { useCoachCorrectionsActions } from "./actions/corrections.js";
import { useCoachAttendanceActions } from "./actions/attendance.js";
const task = useOperationTask();

const session = useSessionStore();

const lessons = ref<any[]>([]);

const enrollments = ref<any[]>([]);

const corrections = ref<any[]>([]);

const products = ref<any[]>([]);

const courtAvailability = ref<CourtAvailability | null>(null);

const trials = ref<any[]>([]);

const leads = ref<any[]>([]);

const trialStudents = ref<any[]>([]);

const trialMembers = ref<any[]>([]);

const staffUsers = ref<any[]>([]);

const youthRules = ref<any[]>([]);

const activeYouthRule = ref<any | null>(null);

const loading = ref(false);

const actionKey = ref("");

const actionMessage = ref("");

const errorMessage = ref("");

const deepLinkQuery = ref<OpsDeepLinkQuery>({});

const deepLinkHandled = ref(false);

const focusedRecord = ref("");

const managementView = ref("");

const managementViewHandled = ref(false);

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

function coachDisplayName(coachId?: string, fallback = "班级教练待配置") {
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

function requiredReason(value: string) {
  const reason = value.trim();
  if (reason.length < 2 || reason.length > 300) {
    throw new Error("操作原因必须填写 2-300 个字符。");
  }
  return reason;
}

function positiveInteger(value: string, label: string, min = 1, max?: number) {
  const parsed = Number(value);
  if (
    !Number.isInteger(parsed) ||
    parsed < min ||
    (max !== undefined && parsed > max)
  ) {
    throw new Error(
      max === undefined
        ? `${label}必须为不小于 ${min} 的整数。`
        : `${label}必须为 ${min}-${max} 的整数。`,
    );
  }
  return parsed;
}

function yuanToCents(value: string, label: string, positive = false) {
  const normalized = value.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) {
    throw new Error(`${label}必须为非负金额，最多两位小数。`);
  }
  const cents = Math.round(Number(normalized) * 100);
  if (!Number.isSafeInteger(cents) || cents < (positive ? 1 : 0)) {
    throw new Error(`${label}${positive ? "必须大于 0" : "不能为负数"}。`);
  }
  return cents;
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
  requiredReason: (...args: Parameters<typeof requiredReason>) =>
    requiredReason(...args),
  productReason,
  audienceOptions,
  productAudienceIndex,
  positiveInteger: (...args: Parameters<typeof positiveInteger>) =>
    positiveInteger(...args),
  productTotalSessions,
  productValidityDays,
  yuanToCents: (...args: Parameters<typeof yuanToCents>) =>
    yuanToCents(...args),
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
  requiredReason: (...args: Parameters<typeof requiredReason>) =>
    requiredReason(...args),
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
  requiredReason: (...args: Parameters<typeof requiredReason>) =>
    requiredReason(...args),
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
    requiredReason: (...args: Parameters<typeof requiredReason>) =>
      requiredReason(...args),
    ruleReason,
    positiveInteger: (...args: Parameters<typeof positiveInteger>) =>
      positiveInteger(...args),
    ruleMaxSessions,
    ruleMaxValidityDays,
    yuanToCents: (...args: Parameters<typeof yuanToCents>) =>
      yuanToCents(...args),
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
  activeStudents,
  session,
  task,
  load: (...args: Parameters<typeof load>) => load(...args),
  errorMessage,
});

const { load, applyCoachDeepLink, loadCourtAvailability } =
  useCoachLoadingActions({
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
  });

onLoad((options) => {
  deepLinkQuery.value = parseOpsDeepLinkQuery(options);
  managementView.value = typeof options?.view === "string" ? options.view : "";
});

onShow(load);
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
