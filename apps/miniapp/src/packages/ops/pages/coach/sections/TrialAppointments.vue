<script setup lang="ts">
import type {
  TrainingTrialView,
  TrainingLeadSummary,
  TrainingStudentSummary,
} from "../../../../../types/training-operations";
import type { TrainingProductView, TrainingSessionView } from "@yanqing/shared";

import { trialSessionOptions, trialSetupGap } from "../actions/trial-availability";
import TrialPersonSearch from "./TrialPersonSearch.vue";
import { useUnsavedForm } from "../../../composables/use-unsaved-form";
import { toRefs, computed, ref, watch } from "vue";
import StatusBadge from "../../../../../components/StatusBadge.vue";
import { dateTimeRange, shortDate } from "../../../../../utils/format";
import { opsDeepLinkDomId } from "../../../utils/work-item-deep-link";

const changingPerson = ref(false),
  showNote = ref(false);
function openTrialForm() {
  uni.navigateTo({ url: "/packages/ops/pages/coach/index?view=create-trial" });
}
const props = defineProps<{
  formOnly: boolean;
  errorMessage: string;
  trials: TrainingTrialView[];
  canCreateSession: boolean;
  canConfigureTraining: boolean;
  products: TrainingProductView[];
  coachOptions: { id: string; displayName: string }[];
  canManageTrials: boolean;
  trialSubjectOptions: string[];
  trialSubjectIndex: number;
  trialMembers: any[];
  selectTrialMember: (member: any) => void;
  trialMemberIndex: number;
  selectedTrialSubject: any;
  leads: TrainingLeadSummary[];
  trialLeadIndex: number;
  trialStudents: TrainingStudentSummary[];
  trialStudentIndex: number;
  trialLinkLead: boolean;
  setTrialLinkLead: (event: any) => void;
  schedulableTrialSessions: TrainingSessionView[];
  trialSessionIndex: number;
  changeTrialSession: (event: any) => void;
  selectedTrialSession: any;
  selectedTrialClass: any;
  selectedTrialProduct: any;
  coachDisplayName: (coachId?: string, fallback?: string) => any;
  trialCoachId: string;
  trialSourceOptions: { value: string; label: string }[];
  trialSourceIndex: number;
  trialReason: string;
  actionKey: string;
  loading: boolean;
  createTrial: () => Promise<boolean | undefined>;
  focusedRecord: string;
  trialSourceLabel: (source?: string) => string;
  transitionTrial: (
    trial: any,
    action: "check-in" | "no-show" | "lost" | "cancel",
  ) => void;
  canAssessTrials: boolean;
  assessTrial: (trial: any) => void;
  canConvertTrials: boolean;
  convertTrial: (trial: any) => void;
}>();
const emit = defineEmits<{
  (event: "setup", view: string, context?: Record<string, string>): void;
  (event: "update:trialCoachId", value: string): void;
  (event: "update:trialSubjectIndex", value: number): void;
  (event: "select-student", student: TrainingStudentSummary): void;
  (event: "update:trialMemberIndex", value: number): void;
  (event: "update:trialLeadIndex", value: number): void;
  (event: "update:trialStudentIndex", value: number): void;
  (event: "update:trialSourceIndex", value: number): void;
  (event: "update:trialReason", value: string): void;
}>();
const {
  trials,
  canManageTrials,
  trialSubjectOptions,
  trialMembers,
  selectTrialMember,
  selectedTrialSubject,
  leads,
  trialStudents,
  trialLinkLead,
  setTrialLinkLead,
  schedulableTrialSessions,
  trialSessionIndex,
  changeTrialSession,
  selectedTrialSession,
  selectedTrialClass,
  selectedTrialProduct,
  coachDisplayName,
  trialCoachId,
  trialSourceOptions,
  actionKey,
  loading,
  createTrial,
  focusedRecord,
  trialSourceLabel,
  transitionTrial,
  canAssessTrials,
  assessTrial,
  canConvertTrials,
  convertTrial,
} = toRefs(props);
const trialSubjectIndex = computed({
  get: () => props.trialSubjectIndex,
  set: (value) => emit("update:trialSubjectIndex", value),
});
const trialMemberIndex = computed({
  get: () => props.trialMemberIndex,
  set: (value) => emit("update:trialMemberIndex", value),
});
const trialLeadIndex = computed({
  get: () => props.trialLeadIndex,
  set: (value) => emit("update:trialLeadIndex", value),
});
const trialStudentIndex = computed({
  get: () => props.trialStudentIndex,
  set: (value) => emit("update:trialStudentIndex", value),
});
const trialSourceIndex = computed({
  get: () => props.trialSourceIndex,
  set: (value) => emit("update:trialSourceIndex", value),
});
const trialReason = computed({
  get: () => props.trialReason,
  set: (value) => emit("update:trialReason", value),
});
const sessionOptions = computed(() => trialSessionOptions(props.schedulableTrialSessions));
const setupGap = computed(() => trialSetupGap(props.products, props.trialSubjectIndex === 2, props.schedulableTrialSessions.length > 0));
const canFixGap = computed(() => setupGap.value?.permission === "configure" ? props.canConfigureTraining : props.canCreateSession);
const availableCoaches = computed(() => props.coachOptions.filter(coach => coach.id));
const coachIndex = computed(() => availableCoaches.value.findIndex(coach => coach.id === props.trialCoachId));
function openSetup() {
  const gap = setupGap.value;
  if (gap) emit("setup", gap.view, gap.context);
}
const { markSaved } = useUnsavedForm(
  () => [
    props.selectedTrialSubject?.id || "",
    props.selectedTrialSession?.id || "",
    props.trialCoachId,
    props.trialSourceIndex,
    props.trialReason,
    props.trialLinkLead,
    props.trialLinkLead ? props.trialLeadIndex : -1,
  ],
  () => props.formOnly,
);
watch(
  () => props.loading,
  (loading, previous) => {
    if (previous && !loading && !props.selectedTrialSubject) markSaved();
  },
);
function selectPerson(kind: "member" | "student" | "lead", person: any) {
  emit(
    "update:trialSubjectIndex",
    kind === "member" ? 0 : kind === "lead" ? 1 : 2,
  );
  if (kind === "member") props.selectTrialMember(person);
  else if (kind === "student") emit("select-student", person);
  else
    emit(
      "update:trialLeadIndex",
      props.leads.findIndex((lead) => lead.id === person.id),
    );
  changingPerson.value = false;
}
async function save() {
  if (await props.createTrial()) {
    markSaved();
    uni.navigateBack();
  }
}
</script>

<template>
  <view :class="{ 'trial-form-page': formOnly }">
    <template v-if="!formOnly"
      ><view class="section-title"
        >试听预约 <text class="section-note">{{ trials.length }} 条</text></view
      ><button v-if="canManageTrials" class="primary" @tap="openTrialForm">
        预约试听
      </button></template
    >
    <view
      v-if="formOnly && canManageTrials"
      class="card creation-form trial-form"
    >
      <text class="field-label">1. 选择试听学员</text>
      <TrialPersonSearch
        v-if="!selectedTrialSubject || changingPerson"
        :students="trialStudents"
        :leads="leads"
        @select="selectPerson"
      />
      <view v-else class="selected-person"
        ><view
          ><text>{{ selectedTrialSubject.displayName }}</text
          ><text class="muted"
            >{{ trialSubjectOptions[trialSubjectIndex]
            }}{{
              selectedTrialSubject.guardian
                ? " · 监护人 " + selectedTrialSubject.guardian.displayName
                : selectedTrialSubject.phone
                  ? " · " + selectedTrialSubject.phone
                  : ""
            }}</text
          ></view
        ><button class="ghost" @tap="changingPerson = true">更换</button></view
      >
      <template v-if="selectedTrialSubject && !changingPerson">
        <view
          v-if="trialSubjectIndex === 2 && leads.length"
          class="consent-line"
          ><text>关联客户线索（选填）</text
          ><switch
            color="#17653d"
            :checked="trialLinkLead"
            @change="setTrialLinkLead"
        /></view>
        <picker
          v-if="trialSubjectIndex === 2 && trialLinkLead"
          :range="leads"
          range-key="displayName"
          :value="trialLeadIndex"
          @change="trialLeadIndex = Number(($event.detail as any).value)"
          ><view
            ><text class="field-label">关联线索（选填）</text
            ><view class="picker-value"
              >{{ leads[trialLeadIndex]?.displayName || "请选择线索" }} ›</view
            ></view
          ></picker
        >
        <picker
          v-if="sessionOptions.length"
          :range="sessionOptions"
          range-key="label"
          :value="Math.max(0, trialSessionIndex)"
          @change="changeTrialSession"
          ><view
            ><text class="field-label">2. 选择上课时间</text
            ><view class="picker-value"
              >{{
                selectedTrialSession
                  ? `${selectedTrialClass?.name || selectedTrialSession.class?.name} · ${shortDate(selectedTrialSession.startsAt)}`
                  : "请选择上课时间"
              }}
              ›</view
            ></view
          ></picker
        >
        <view v-if="setupGap && !loading" class="trial-context trial-prerequisite">
          <text class="setup-title">{{ setupGap.title }}</text>
          <text>{{ setupGap.detail }}</text>
          <button v-if="canFixGap" class="secondary" @tap="openSetup">{{ setupGap.label }}</button>
          <text v-else>请联系管理员补齐配置后，再继续预约。</text>
          <text v-if="canFixGap" class="muted">学员和已填内容会保留。</text>
        </view>
        <view v-else-if="selectedTrialSession" class="trial-context trial-session-context">
          <text>课程：{{ selectedTrialProduct?.name || "—" }}</text>
          <text>时段：{{ dateTimeRange(selectedTrialSession.startsAt, selectedTrialSession.endsAt) }}</text>
        </view>
        <view v-if="selectedTrialSession" class="form-grid">
          <picker v-if="canConfigureTraining && availableCoaches.length" :range="availableCoaches" range-key="displayName" :value="Math.max(0, coachIndex)" @change="emit('update:trialCoachId', availableCoaches[Number(($event.detail as any).value)]?.id || '')">
            <view><text class="field-label">试听教练</text><view class="picker-value">{{ coachDisplayName(trialCoachId, '请选择教练') }} ›</view></view>
          </picker>
          <view v-else
            ><text class="field-label">试听教练</text
            ><view class="picker-value readonly-value">{{
              coachDisplayName(trialCoachId)
            }}</view></view
          >
          <picker
            :range="trialSourceOptions"
            range-key="label"
            :value="trialSourceIndex"
            @change="trialSourceIndex = Number(($event.detail as any).value)"
            ><view
              ><text class="field-label">来源渠道</text
              ><view class="picker-value"
                >{{ trialSourceOptions[trialSourceIndex].label }} ›</view
              ></view
            ></picker
          >
        </view>
        <text v-if="selectedTrialSession && !trialCoachId" class="trial-error">{{ canConfigureTraining && availableCoaches.length ? '请选择负责本次试听的教练。' : '该班级尚未分配教练，请联系管理员后再预约。' }}</text>
        <button class="ghost" @tap="showNote = !showNote">
          {{ showNote ? "收起备注" : "添加备注（选填）" }}
        </button>
        <view v-if="showNote"
          ><text class="field-label">备注（选填）</text
          ><textarea
            v-model="trialReason"
            class="reason-input"
            maxlength="300"
            placeholder="如需补充学员情况，可在此填写"
          />
        </view>
      </template>
      <view class="trial-save"
        ><text
          v-if="selectedTrialSubject && selectedTrialSession && !changingPerson"
          class="trial-review"
          >{{ selectedTrialSubject.displayName }} ·
          {{ shortDate(selectedTrialSession.startsAt) }} ·
          {{ coachDisplayName(trialCoachId) }}</text
        ><text v-if="errorMessage" class="trial-error" role="alert">{{
          errorMessage
        }}</text>
        <text v-if="!selectedTrialSubject" class="trial-review">先搜索并选择学员，再选择上课时间。</text>
        <text v-else-if="!selectedTrialSession" class="trial-review">{{ setupGap ? setupGap.title : '请选择上课时间' }}</text>
        <button
          class="primary full-button"
          :loading="actionKey === 'create-trial'"
          :disabled="
            loading ||
            Boolean(actionKey) ||
            !selectedTrialSession ||
            !selectedTrialSubject ||
            !trialCoachId ||
            changingPerson
          "
          @tap="save"
        >
          预约试听
        </button></view
      >
    </view>
    <template v-if="!formOnly"
      ><view
        v-for="trial in trials"
        :id="opsDeepLinkDomId('coach-trial', trial.id)"
        :key="trial.id"
        class="card trial-card"
        :class="{
          'deep-link-target': focusedRecord === `coach-trial:${trial.id}`,
        }"
      >
        <view class="row"
          ><view
            ><text class="trial-title">{{
              trial.student?.displayName ||
              trial.member?.displayName ||
              trial.lead?.displayName ||
              trial.trialNo
            }}</text
            ><text class="muted"
              >{{ trial.trialNo }} · {{ trial.product?.name }} ·
              {{ shortDate(trial.scheduledStartsAt) }}</text
            ></view
          ><StatusBadge :value="trial.status"
        /></view>
        <view class="trial-context"
          ><text
            >教练：{{
              trial.coach?.displayName || coachDisplayName(trial.coachId)
            }}</text
          ><text>来源：{{ trialSourceLabel(trial.sourceChannel) }}</text
          ><text
            >监护人：{{ trial.guardian?.displayName || "不适用" }}</text
          ></view
        >
        <view v-if="trial.assessmentDimensions?.length" class="assessment-grid">
          <view
            v-for="dimension in trial.assessmentDimensions"
            :key="dimension.key"
            ><text>{{ dimension.label }}</text
            ><text class="score">{{ dimension.score }}/5</text></view
          >
          <text class="recommendation"
            >训练建议：{{ trial.recommendation }}</text
          >
        </view>
        <view class="trial-actions">
          <template v-if="trial.status === 'RESERVED' && canManageTrials">
            <button
              class="primary inline"
              @tap="transitionTrial(trial, 'check-in')"
            >
              签到
            </button>
            <button
              class="ghost inline"
              @tap="transitionTrial(trial, 'no-show')"
            >
              未到
            </button>
            <button
              class="danger inline"
              @tap="transitionTrial(trial, 'cancel')"
            >
              取消
            </button>
          </template>
          <button
            v-if="trial.status === 'CHECKED_IN' && canAssessTrials"
            class="primary inline"
            @tap="assessTrial(trial)"
          >
            提交测评
          </button>
          <template v-if="trial.status === 'ASSESSED' && canConvertTrials">
            <button class="primary inline" @tap="convertTrial(trial)">
              转正式课
            </button>
            <button class="danger inline" @tap="transitionTrial(trial, 'lost')">
              确认流失
            </button>
          </template>
          <template v-if="trial.status === 'NO_SHOW'">
            <button
              v-if="canConvertTrials"
              class="danger inline"
              @tap="transitionTrial(trial, 'lost')"
            >
              确认流失
            </button>
            <button
              v-if="canManageTrials"
              class="ghost inline"
              @tap="transitionTrial(trial, 'cancel')"
            >
              关闭预约
            </button>
          </template>
        </view>
        <text v-if="trial.transitions?.length" class="audit-hint"
          >状态证据 {{ trial.transitions.length }} 条 · 最近：{{
            trial.transitions[trial.transitions.length - 1].reason
          }}</text
        >
      </view>
      <view v-if="!loading && !trials.length" class="empty card"
        >暂无试听预约；前台可从已分配场地的课次创建预约。</view
      >
    </template>
  </view>
</template>

<style scoped src="../page.css"></style>

<style scoped>
.trial-prerequisite, .trial-session-context {
  display: flex;
  flex-direction: column;
  gap: 12rpx;
  padding: 24rpx;
  font-size: 14px;
  line-height: 1.6;
}
.trial-prerequisite button {
  width: 100%;
  margin: 4rpx 0;
  min-height: 48px;
  font-size: 15px;
}
.trial-form-page {
  padding-bottom: calc(170rpx + env(safe-area-inset-bottom));
}
.selected-person {
  display: flex;
  align-items: center;
  gap: 16rpx;
  padding: 20rpx 0;
  margin-bottom: 20rpx;
}
.selected-person > view {
  flex: 1;
  min-width: 0;
  font-size: 30rpx;
}
.selected-person .muted {
  display: block;
  margin-top: 8rpx;
}
.selected-person button {
  margin: 0;
  min-height: 44px;
}
.trial-save {
  position: fixed;
  z-index: 25;
  bottom: 0;
  left: 0;
  right: 0;
  background: var(--color-surface);
  padding: 20rpx 28rpx calc(20rpx + env(safe-area-inset-bottom));
  border-top: 1rpx solid var(--color-border);
}
.trial-save button {
  margin: 0;
  width: 100%;
  min-height: 48px;
}
.trial-review {
  display: block;
  color: var(--color-foreground);
  font-size: 26rpx;
  line-height: 1.5;
  margin-bottom: 12rpx;
}
.trial-error {
  display: block;
  color: var(--color-danger);
  font-size: 26rpx;
  line-height: 1.6;
  margin-bottom: 12rpx;
}
</style>
