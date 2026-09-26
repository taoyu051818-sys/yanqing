<script setup lang="ts">
import type { TrainingProductView } from "@yanqing/shared";
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
import YouthRuleNotice from "./sections/YouthRuleNotice.vue";
import YouthRules from "./sections/YouthRules.vue";
import TrainingProductEditor from "./sections/TrainingProductEditor.vue";
import TrainingProducts from "./sections/TrainingProducts.vue";
import TrainingConfiguration from "./sections/TrainingConfiguration.vue";
import TrainingSchedule from "./sections/TrainingSchedule.vue";
import LessonAttendance from "./sections/LessonAttendance.vue";
import ConsumptionCorrections from "./sections/ConsumptionCorrections.vue";

import { computed, getCurrentInstance, onUnmounted, ref, watch } from "vue";
import { preserveTrainingSelection, useTrainingFormNavigation, type TrainingCreationResult } from "./actions/form-navigation";
import OperationsTabs from "../../components/OperationsTabs.vue";
import LessonList from "./sections/LessonList.vue";
import { today } from "../../../../utils/format";
import { onLoad, onShow } from "@dcloudio/uni-app";
import OperationsFrame from "../../components/OperationsFrame.vue";
import OperationTask from "../../components/OperationTask.vue";
import { useOperationTask } from "../../components/operation-task";
import { useSessionStore } from "../../../../stores/session";
import { useCoachCatalogActions } from "./actions/catalog.js";
import { useCoachScheduleActions } from "./actions/schedule.js";
import { useCoachTrialsActions } from "./actions/trials.js";
import { useCoachRulesActions } from "./actions/rules.js";
import { useCoachCorrectionsActions } from "./actions/corrections.js";
import { useCoachAttendanceActions } from "./actions/attendance.js";
const task = useOperationTask();
const pageInstance = getCurrentInstance();
const lastCreated = ref<TrainingCreationResult | null>(null);

const session = useSessionStore();

const dataScope = () =>
  `${session.user?.id || ""}:${[...session.roles].sort().join(",")}`;
const lessonFilter = ref("today");
const lessonSearch = ref("");
const teaching = useCoachTeachingData(dataScope, () => ({
  ...(lessonFilter.value === "all" ? {} : { date: today(lessonFilter.value === "tomorrow" ? 1 : 0) }),
  search: lessonSearch.value.trim(),
}), () => navigation.sessionQuery());
const { items: filteredLessons, hasMore: moreLessons, loading: lessonsLoading, error: lessonsError } = teaching.list;
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
const { focusedRecord, activeView, lessonId } = navigation;
const sessionValidationField = ref("");

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
  ruleEffectiveImmediately,
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
// Refreshes preserve identities, never replace a removed selection with another person.
preserveTrainingSelection(trialStudents, trialStudentIndex);
preserveTrainingSelection(trialMembers, trialMemberIndex);
preserveTrainingSelection(leads, trialLeadIndex);
preserveTrainingSelection(activeProducts, classProductIndex);
preserveTrainingSelection(sessionClasses, sessionClassIndex);
preserveTrainingSelection(schedulableTrialSessions, trialSessionIndex);
const formNavigation = useTrainingFormNavigation({
  products: activeProducts, classes: sessionClasses, sessions: schedulableTrialSessions,
  productIndex: classProductIndex, classIndex: sessionClassIndex, trialSessionIndex,
});
watch(trialSubjectIndex, () => { trialSessionIndex.value = -1; });
watch(() => selectedTrialClass.value?.coachId, (coachId) => {
  trialCoachId.value = coachId || "";
}, { immediate: true });

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
    formNavigation.applySelection();
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
    const result = await operation();
    const kind = ({ "create-product": "product", "create-class": "class", "create-session": "session" } as const)[key as "create-product" | "create-class" | "create-session"];
    lastCreated.value = kind && result && typeof result === "object" && "id" in result && typeof result.id === "string" ? { kind, id: result.id } : null;
    actionMessage.value = successMessage;
    await load();
    uni.showToast({ title: "创建成功", icon: "success" });
    return true;
  } catch (cause: any) {
    errorMessage.value = cause?.message || "培训经营配置创建失败。";
    return false;
  } finally {
    uni.hideLoading();
    actionKey.value = "";
  }
}

const {
  catalogValidationField,
  clearCatalogError,
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
  onValidationError: (field) => { sessionValidationField.value = field; },
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
    ruleEffectiveImmediately,
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


const isCreationPage = computed(() => activeView.value.startsWith('create-') || activeView.value === 'edit-product');
const coachTabs = computed(() => [
  { key:'lessons', title:'课表' }, { key:'trials', title:'试听' }, { key:'products', title:'课程' },
  ...(canConfigureTraining.value ? [{ key:'rules', title:'限制' }] : []),
  { key:'corrections', title:'复核', count:requestedCorrections.value.length },
]);
let lessonSearchTimer: ReturnType<typeof setTimeout> | undefined;
watch([lessonFilter, lessonSearch], () => {
  clearTimeout(lessonSearchTimer);
  teaching.list.reset();
  lessonSearchTimer = setTimeout(() => { if (mayViewTraining.value) void teaching.list.refresh(); }, 250);
});
onUnmounted(() => clearTimeout(lessonSearchTimer));
const detailLessons = computed(() => lessons.value.filter(lesson => lesson.id === lessonId.value));
function openLesson(id: string) { uni.navigateTo({ url:`/packages/ops/pages/coach/index?lessonId=${encodeURIComponent(id)}` }); }
function openProductEditor(product: TrainingProductView) { uni.navigateTo({url:`/packages/ops/pages/coach/index?view=edit-product&productId=${encodeURIComponent(product.id)}`}); }
function openCreation(view: string, context: Record<string, string> = {}) { formNavigation.open(view, context); }
function finishCreation() {
  const page = pageInstance?.proxy as { getOpenerEventChannel?: () => { emit: (event: string, value: unknown) => void } } | null;
  if (lastCreated.value) page?.getOpenerEventChannel?.().emit("trainingCreated", lastCreated.value);
  uni.navigateBack({ fail: () => uni.redirectTo({ url: `/packages/ops/pages/coach/index?view=${activeView.value === "create-session" ? "lessons" : "products"}` }) });
}
watch(activeView, () => { if (!isCreationPage.value && !lessonId.value) uni.pageScrollTo({ scrollTop:0, duration:0 }); });

const requestedProductId = ref('');
const editingProduct = computed(() => products.value.find(product => product.id === requestedProductId.value));
watch(editingProduct, product => { if (product && !editingProductId.value) beginProductEdit(product); });
onLoad(options => {
  navigation.setQuery(options);
  requestedProductId.value = typeof options?.productId === 'string' ? options.productId : '';
  if (activeView.value === "create-class" && requestedProductId.value) formNavigation.selectOnRefresh({ kind: "product", id: requestedProductId.value });
  if (activeView.value === "create-session" && typeof options?.classId === "string") formNavigation.selectOnRefresh({ kind: "class", id: options.classId });
  const audience = audienceOptions.findIndex(item => item.value === options?.audience);
  if (activeView.value === "create-product" && audience >= 0) productAudienceIndex.value = audience;
});
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
    <OperationsTabs v-if="!lessonId && !isCreationPage" v-model="activeView" :items="coachTabs" label="培训分类" />
    <LessonList v-if="activeView === 'lessons' && !lessonId" v-model:filter="lessonFilter" v-model:search="lessonSearch" :lessons="filteredLessons" :loading="loading || lessonsLoading" :error="lessonsError" :has-more="moreLessons" @more="teaching.list.more()" @retry="teaching.list.retry()" :can-create="canCreateSession" :students-for="studentsFor" @open="openLesson" @create="openCreation('create-session')" />
    <view v-if="lessonId && !loading && !detailLessons.length" class="card empty">未找到该课次，可能已移除或当前账号无权查看。</view>

    <view v-if="errorMessage && !sessionValidationField && !isCreationPage" class="card error-panel">
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
    <view v-if="actionMessage" class="notice card">{{ actionMessage }}</view>

    <TrialAppointments
      v-if="['trials', 'create-trial'].includes(activeView) && !lessonId"
      :form-only="activeView === 'create-trial'"
      :error-message="errorMessage"
      :trials="trials"
      :canManageTrials="canManageTrials"
      :trialSubjectOptions="trialSubjectOptions"
      v-model:trialSubjectIndex="trialSubjectIndex"
      :trialMembers="trialMembers"
      :selectTrialMember="(member) => { trialData.selectMember(member); trialMemberIndex = 0 }"
      v-model:trialMemberIndex="trialMemberIndex"
      :selectedTrialSubject="selectedTrialSubject"
      :leads="leads"
      v-model:trialLeadIndex="trialLeadIndex"
      :trialStudents="trialStudents"
      :canCreateSession="canCreateSession"
      :canConfigureTraining="canConfigureTraining"
      :products="products"
      :coachOptions="coachOptions"
      @setup="openCreation"
      @select-student="(student) => { trialData.selectStudent(student); trialStudentIndex = 0 }"
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
      v-model:trialCoachId="trialCoachId"
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
      v-if="activeView === 'rules' && canConfigureTraining && !lessonId"
      :canConfigureTraining="canConfigureTraining"
      :activeYouthRule="activeYouthRule"
      :canDraftYouthRule="canDraftYouthRule"
      v-model:ruleMaxSessions="ruleMaxSessions"
      v-model:ruleMaxValidityDays="ruleMaxValidityDays"
      v-model:ruleMaxAmountYuan="ruleMaxAmountYuan"
      v-model:ruleWarningDays="ruleWarningDays"
      v-model:ruleEffectiveImmediately="ruleEffectiveImmediately"
      v-model:ruleEffectiveDate="ruleEffectiveDate"
      v-model:ruleEffectiveTime="ruleEffectiveTime"
      :ruleHardBlock="ruleHardBlock"
      :setRuleHardBlock="setRuleHardBlock"
      v-model:ruleReason="ruleReason"
      :actionKey="actionKey"
      :loading="loading"
      :error-message="errorMessage"
      :createYouthRule="createYouthRule"
      :youthRules="youthRules"
      :canReviewYouthRule="canReviewYouthRule"
      :decideYouthRule="decideYouthRule"
    />

    <YouthRuleNotice v-if="canConfigureTraining && !activeYouthRule && !loading && (activeView === 'products' || (activeView === 'create-product' && audienceOptions[productAudienceIndex]?.value !== 'ADULT') || (activeView === 'edit-product' && editingProduct?.audience !== 'ADULT'))"
      :active-rule="activeYouthRule" :rules="youthRules" @settings="openCreation('rules')" />

    <view v-if="activeView === 'products' && !lessonId && canConfigureTraining" class="creation-shortcuts"><button class="primary" @tap="openCreation('create-product')">新增课程</button><button class="secondary" @tap="openCreation('create-class')">新增班级</button></view>
    <TrainingProducts
      v-if="activeView === 'products' && !lessonId"
      :activeProducts="activeProducts"
      :activeClasses="activeClasses"
      :products="products"
      :coachDisplayName="coachDisplayName"
      :canConfigureTraining="canConfigureTraining"
      :actionKey="actionKey"
      :beginProductEdit="openProductEditor"
      :updateProduct="updateProduct"
      :loading="loading"
    />

    <TrainingProductEditor v-if="activeView === 'edit-product' && canConfigureTraining" :product="editingProduct" :error-message="errorMessage" :action-key="actionKey" :loading="loading" :update-product="updateProduct"
      :editingProductId="editingProductId"
      v-model:editProductName="editProductName"
      v-model:editProductTotalSessions="editProductTotalSessions"
      v-model:editProductValidityDays="editProductValidityDays"
      v-model:editProductPriceYuan="editProductPriceYuan"
      v-model:editProductReason="editProductReason"
      :cancelProductEdit="cancelProductEdit"
    />

    <TrainingConfiguration
      v-if="['create-product', 'create-class'].includes(activeView) && canConfigureTraining"
      @saved="finishCreation"
      @setup="openCreation"
      :form-type="activeView === 'create-product' ? 'product' : 'class'"
      :error-field="catalogValidationField"
      @clear-error="clearCatalogError"
      :error-message="errorMessage"
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
      v-if="activeView === 'create-session' && canCreateSession"
      @saved="finishCreation"
      @setup="openCreation"
      :canConfigureTraining="canConfigureTraining"
      :hasProducts="activeProducts.length > 0"
      :error-message="errorMessage"
      :error-field="sessionValidationField"
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
      :refresh="load"
      v-if="lessonId"
      :loading="loading"
      :activeLessons="activeLessons"
      :lessons="detailLessons"
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
      v-if="activeView === 'corrections' && !lessonId"
      :corrections="corrections"
      :focusedRecord="focusedRecord"
      :correctionStudentName="correctionStudentName"
      :attendanceLabel="attendanceLabel"
      :isChecker="isChecker"
      :isOwnCorrection="isOwnCorrection"
      :decideCorrection="decideCorrection"
      :loading="loading"
    />
  </OperationsFrame>
</template>

<style scoped src="./page.css"></style>

<style scoped>
.creation-shortcuts { display:flex; gap:20rpx; margin:12rpx 0 24rpx; }.creation-shortcuts button { flex:1; margin:0; font-size:28rpx; }
.error-panel { position:sticky; top:0; z-index:12; background:#fff0ef; }
</style>
