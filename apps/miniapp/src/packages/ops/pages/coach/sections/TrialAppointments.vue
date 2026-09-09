<script setup lang="ts">
import { toRefs, computed } from "vue";
import StatusBadge from "../../../../../components/StatusBadge.vue";
import { shortDate } from "../../../../../utils/format";
import { opsDeepLinkDomId } from "../../../../../utils/work-item-deep-link";

const props = defineProps<{
  trials: any[];
  canManageTrials: boolean;
  trialSubjectOptions: string[];
  trialSubjectIndex: number;
  trialMembers: any[];
  trialMemberIndex: number;
  selectedTrialSubject: any;
  leads: any[];
  trialLeadIndex: number;
  trialStudents: any[];
  trialStudentIndex: number;
  trialLinkLead: boolean;
  setTrialLinkLead: (event: any) => void;
  schedulableTrialSessions: any[];
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
  createTrial: () => Promise<void>;
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
  (event: "update:trialSubjectIndex", value: number): void;
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
</script>

<template>
  <view>
    <view class="section-title"
      >试听预约与测评漏斗
      <text class="section-note"
        >{{ trials.length }} 条 · 状态动作留痕</text
      ></view
    >
    <view v-if="canManageTrials" class="card creation-form">
      <view class="form-grid">
        <picker
          :range="trialSubjectOptions"
          :value="trialSubjectIndex"
          @change="trialSubjectIndex = Number(($event.detail as any).value)"
          ><view
            ><text class="field-label">试听主体类型</text
            ><view class="picker-value"
              >{{ trialSubjectOptions[trialSubjectIndex] }} ›</view
            ></view
          ></picker
        >
        <picker
          v-if="trialSubjectIndex === 0"
          :range="trialMembers"
          range-key="displayName"
          :value="trialMemberIndex"
          @change="trialMemberIndex = Number(($event.detail as any).value)"
          ><view
            ><text class="field-label">会员</text
            ><view class="picker-value"
              >{{ selectedTrialSubject?.displayName || "暂无可选会员" }} ›</view
            ></view
          ></picker
        >
        <picker
          v-else-if="trialSubjectIndex === 1"
          :range="leads"
          range-key="displayName"
          :value="trialLeadIndex"
          @change="trialLeadIndex = Number(($event.detail as any).value)"
          ><view
            ><text class="field-label">客户线索</text
            ><view class="picker-value"
              >{{ selectedTrialSubject?.displayName || "暂无可用线索" }} ›</view
            ></view
          ></picker
        >
        <picker
          v-else
          :range="trialStudents"
          range-key="displayName"
          :value="trialStudentIndex"
          @change="trialStudentIndex = Number(($event.detail as any).value)"
          ><view
            ><text class="field-label">青少年学员</text
            ><view class="picker-value"
              >{{
                selectedTrialSubject?.displayName || "暂无已授权学员"
              }}
              ›</view
            ></view
          ></picker
        >
      </view>
      <view v-if="trialSubjectIndex === 2 && leads.length" class="consent-line"
        ><text>同时关联招生线索，后续签到/转课自动沉淀跟进证据</text
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
        :range="schedulableTrialSessions"
        :value="trialSessionIndex"
        @change="changeTrialSession"
        ><view
          ><text class="field-label">已有场地资源的待开课次</text
          ><view class="picker-value"
            >{{
              selectedTrialSession
                ? `${selectedTrialClass?.name || selectedTrialSession.class?.name} · ${shortDate(selectedTrialSession.startsAt)}`
                : "暂无可预约课次"
            }}
            ›</view
          ></view
        ></picker
      >
      <view class="trial-context">
        <text>产品：{{ selectedTrialProduct?.name || "—" }}</text>
        <text>班级：{{ selectedTrialClass?.name || "—" }}</text>
        <text
          >时段：{{
            selectedTrialSession
              ? `${shortDate(selectedTrialSession.startsAt)} 至 ${shortDate(selectedTrialSession.endsAt)}`
              : "—"
          }}</text
        >
      </view>
      <view class="form-grid">
        <view
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
      <view
        ><text class="field-label">预约事实与原因（必填）</text
        ><textarea
          v-model="trialReason"
          class="reason-input"
          maxlength="300"
          placeholder="例如：监护人电话确认周末到场试听"
        />
      </view>
      <text class="guardrail"
        >预约必须落在已有培训课次及场地占用内；同一教练或同一试听主体发生时段重叠会被服务端拒绝。</text
      >
      <button
        class="primary full-button"
        :loading="actionKey === 'create-trial'"
        :disabled="
          loading ||
          Boolean(actionKey) ||
          !selectedTrialSession ||
          !selectedTrialSubject ||
          !trialCoachId
        "
        @tap="createTrial"
      >
        预约试听
      </button>
    </view>
    <view
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
        <text class="recommendation">训练建议：{{ trial.recommendation }}</text>
      </view>
      <view class="trial-actions">
        <template v-if="trial.status === 'RESERVED' && canManageTrials">
          <button
            class="primary inline"
            @tap="transitionTrial(trial, 'check-in')"
          >
            签到
          </button>
          <button class="ghost inline" @tap="transitionTrial(trial, 'no-show')">
            未到
          </button>
          <button class="danger inline" @tap="transitionTrial(trial, 'cancel')">
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
  </view>
</template>

<style scoped src="../page.css"></style>
