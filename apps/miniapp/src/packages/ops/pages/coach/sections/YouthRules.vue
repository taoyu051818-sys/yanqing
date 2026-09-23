<script setup lang="ts">
import type {
  YouthTrainingRuleView,
  YouthTrainingRuleManagementView,
} from "../../../../../types/training-operations";
import { toRefs, computed, ref } from "vue";
import YouthRuleNotice from "./YouthRuleNotice.vue";
import { nextYouthRule, youthRuleState } from "../rule-status";
import StatusBadge from "../../../../../components/StatusBadge.vue";
import {
  money,
  shortDate,
  today as shanghaiDate,
} from "../../../../../utils/format";

const props = defineProps<{
  canConfigureTraining: boolean;
  activeYouthRule: YouthTrainingRuleView | null;
  canDraftYouthRule: boolean;
  ruleMaxSessions: string;
  ruleMaxValidityDays: string;
  ruleMaxAmountYuan: string;
  ruleWarningDays: string;
  ruleEffectiveImmediately: boolean;
  ruleEffectiveDate: string;
  ruleEffectiveTime: string;
  ruleHardBlock: boolean;
  setRuleHardBlock: (event: any) => void;
  ruleReason: string;
  actionKey: string;
  errorMessage: string;
  loading: boolean;
  createYouthRule: () => Promise<boolean | undefined>;
  youthRules: YouthTrainingRuleManagementView[];
  canReviewYouthRule: boolean;
  decideYouthRule: (rule: any, decision: "publish" | "reject") => void;
}>();
const emit = defineEmits<{
  (event: "update:ruleMaxSessions", value: string): void;
  (event: "update:ruleMaxValidityDays", value: string): void;
  (event: "update:ruleMaxAmountYuan", value: string): void;
  (event: "update:ruleWarningDays", value: string): void;
  (event: "update:ruleEffectiveImmediately", value: boolean): void;
  (event: "update:ruleEffectiveDate", value: string): void;
  (event: "update:ruleEffectiveTime", value: string): void;
  (event: "update:ruleReason", value: string): void;
}>();
const {
  canConfigureTraining,
  activeYouthRule,
  canDraftYouthRule,
  ruleHardBlock,
  setRuleHardBlock,
  actionKey,
  loading,
  createYouthRule,
  youthRules,
  canReviewYouthRule,
  decideYouthRule,
} = toRefs(props);
const ruleMaxSessions = computed({
  get: () => props.ruleMaxSessions,
  set: (value) => emit("update:ruleMaxSessions", value),
});
const ruleMaxValidityDays = computed({
  get: () => props.ruleMaxValidityDays,
  set: (value) => emit("update:ruleMaxValidityDays", value),
});
const ruleMaxAmountYuan = computed({
  get: () => props.ruleMaxAmountYuan,
  set: (value) => emit("update:ruleMaxAmountYuan", value),
});
const ruleWarningDays = computed({
  get: () => props.ruleWarningDays,
  set: (value) => emit("update:ruleWarningDays", value),
});
const ruleEffectiveDate = computed({
  get: () => props.ruleEffectiveDate,
  set: (value) => emit("update:ruleEffectiveDate", value),
});
const ruleEffectiveTime = computed({
  get: () => props.ruleEffectiveTime,
  set: (value) => emit("update:ruleEffectiveTime", value),
});
const ruleReason = computed({
  get: () => props.ruleReason,
  set: (value) => emit("update:ruleReason", value),
});

const showEditor = ref(false);
const showAdvanced = ref(false);
const showHistory = ref(false);
const scheduledRule = computed(() => nextYouthRule(props.youthRules));
const ruleEffectiveImmediately = computed({
  get: () => props.ruleEffectiveImmediately,
  set: (value) => emit("update:ruleEffectiveImmediately", value),
});
function editSettings() {
  const source =
    props.activeYouthRule ||
    scheduledRule.value ||
    props.youthRules.find((rule) => rule.status === "DRAFT");
  if (source) {
    ruleMaxSessions.value = String(source.maxTotalSessions);
    ruleMaxValidityDays.value = String(source.maxValidityDays);
    ruleMaxAmountYuan.value = String(source.maxContractAmountCents / 100);
    ruleWarningDays.value = String(source.warningThresholdDays);
    props.setRuleHardBlock({ detail: { value: source.hardBlock } });
  }
  ruleEffectiveImmediately.value = true;
  showEditor.value = true;
}
async function saveSettings() {
  if (await props.createYouthRule()) showEditor.value = false;
}
</script>

<template>
  <view :class="{ 'rule-editor-page': showEditor }">
    <template v-if="canConfigureTraining">
      <view class="section-title">青少年课包限制</view>
      <view v-if="!showEditor" class="card">
        <text class="muted"
          >统一管理课次、有效期和金额上限，青少年及“不限”课程共用。设置一次即可，不必逐门填写；修改不影响历史合同。</text
        >
      </view>
      <YouthRuleNotice
        :active-rule="activeYouthRule"
        :rules="youthRules"
        :show-action="false"
      />
      <button
        v-if="canDraftYouthRule && !showEditor"
        class="primary full-button"
        :disabled="loading || Boolean(actionKey)"
        @tap="editSettings"
      >
        {{
          activeYouthRule
            ? "修改课包限制"
            : scheduledRule
              ? "沿用已填配置"
              : "设置课包限制"
        }}
      </button>
      <view v-if="canDraftYouthRule && showEditor" class="card creation-form">
        <text class="guardrail"
          >填写球馆采用的课包上限，数值由管理员确定。</text
        >
        <view class="form-grid"
          ><view
            ><text class="field-label">单课包最多课次</text
            ><input
              v-model="ruleMaxSessions"
              class="form-input"
              type="number"
              placeholder="请输入上限" /></view
          ><view
            ><text class="field-label">最长有效期（天）</text
            ><input
              v-model="ruleMaxValidityDays"
              class="form-input"
              type="number"
              placeholder="请输入上限" /></view
        ></view>
        <view class="form-grid"
          ><view
            ><text class="field-label">最高金额（元）</text
            ><input
              v-model="ruleMaxAmountYuan"
              class="form-input"
              type="digit"
              placeholder="请输入上限" /></view
        ></view>
        <view class="form-grid">
          <button
            :class="ruleEffectiveImmediately ? 'primary' : 'secondary'"
            @tap="ruleEffectiveImmediately = true"
          >
            立即生效
          </button>
          <button
            :class="!ruleEffectiveImmediately ? 'primary' : 'secondary'"
            @tap="ruleEffectiveImmediately = false"
          >
            指定时间
          </button>
        </view>
        <text v-if="ruleEffectiveImmediately && scheduledRule" class="muted"
          >本次配置立即生效；已发布的预约配置仍会按原定时间接替。</text
        >
        <view v-if="!ruleEffectiveImmediately" class="form-grid"
          ><picker
            mode="date"
            :value="ruleEffectiveDate"
            :start="shanghaiDate()"
            @change="ruleEffectiveDate = ($event.detail as any).value"
            ><view
              ><text class="field-label">计划生效日期</text
              ><view class="picker-value">{{ ruleEffectiveDate }} ›</view></view
            ></picker
          ><picker
            mode="time"
            :value="ruleEffectiveTime"
            @change="ruleEffectiveTime = ($event.detail as any).value"
            ><view
              ><text class="field-label">计划生效时间</text
              ><view class="picker-value">{{ ruleEffectiveTime }} ›</view></view
            ></picker
          ></view
        >
        <button
          class="secondary full-button"
          @tap="showAdvanced = !showAdvanced"
        >
          {{ showAdvanced ? "收起更多设置" : "更多设置（选填）" }}
        </button>
        <view v-if="showAdvanced">
          <text class="field-label"
            >距有效期上限预警（天，0 表示仅到上限提醒）</text
          >
          <input v-model="ruleWarningDays" class="form-input" type="number" />
          <view class="consent-line"
            ><text>超出上限时阻止销售（关闭则只提醒）</text
            ><switch
              color="#17653d"
              :checked="ruleHardBlock"
              @change="setRuleHardBlock"
          /></view>
          <view
            ><text class="field-label">备注（选填）</text
            ><textarea
              v-model="ruleReason"
              class="reason-input"
              maxlength="300"
              placeholder="需要说明时再填写"
            />
          </view>
        </view>
        <text v-if="errorMessage" class="rule-error" role="alert">{{
          errorMessage
        }}</text>
        <view class="rule-save">
          <button
            class="secondary"
            :disabled="Boolean(actionKey)"
            @tap="showEditor = false"
          >
            取消
          </button>
          <button
            class="primary"
            :loading="actionKey === 'create-youth-rule'"
            :disabled="loading || Boolean(actionKey)"
            @tap="saveSettings"
          >
            {{ ruleEffectiveImmediately ? "保存并立即生效" : "保存并预约生效" }}
          </button>
        </view>
      </view>
      <button
        v-if="youthRules.length"
        class="secondary full-button"
        @tap="showHistory = !showHistory"
      >
        {{ showHistory ? "收起设置记录" : "查看设置记录" }}
      </button>
      <template v-if="showHistory">
        <view v-for="rule in youthRules" :key="rule.id" class="card rule-card">
          <view class="row"
            ><view
              ><text class="trial-title">{{ rule.version }}</text
              ><text class="muted"
                >申请人 {{ rule.requestedBy?.displayName || "系统记录" }} · 计划
                {{ shortDate(rule.effectiveFrom) }} 生效</text
              ></view
            ><text>{{ youthRuleState(rule) }}</text
            ><StatusBadge
              v-if="rule.status === 'DRAFT' || rule.status === 'REJECTED'"
              :value="rule.status"
          /></view>
          <view class="rule-values"
            ><text>总课时 {{ rule.maxTotalSessions }}</text
            ><text>有效期 {{ rule.maxValidityDays }} 天</text
            ><text>合同额 {{ money(rule.maxContractAmountCents) }}</text
            ><text
              >预警 {{ rule.warningThresholdDays }} 天 ·
              {{ rule.hardBlock ? "硬阻断" : "仅预警" }}</text
            ></view
          >
          <text class="audit-hint">发布依据：{{ rule.requestReason }}</text>
          <view
            v-if="rule.status === 'DRAFT' && canReviewYouthRule"
            class="trial-actions"
          >
            <button
              class="primary inline"
              :disabled="Boolean(actionKey)"
              @tap="decideYouthRule(rule, 'publish')"
            >
              确认发布
            </button>
            <button
              class="danger inline"
              :disabled="Boolean(actionKey)"
              @tap="decideYouthRule(rule, 'reject')"
            >
              驳回
            </button>
          </view>
        </view>
      </template>
    </template>
  </view>
</template>

<style scoped src="../page.css"></style>

<style scoped>
.rule-editor-page {
  padding-bottom: calc(150rpx + env(safe-area-inset-bottom));
}
.rule-save {
  position: fixed;
  z-index: 25;
  bottom: 0;
  left: 0;
  right: 0;
  display: flex;
  gap: 16rpx;
  background: var(--color-surface);
  padding: 20rpx 28rpx calc(20rpx + env(safe-area-inset-bottom));
  border-top: 1rpx solid var(--color-border);
}
.rule-save button {
  flex: 1;
  min-height: 48px;
  margin: 0;
}
.rule-save .primary {
  flex: 2;
}
.rule-error {
  display: block;
  color: #b42318;
  margin: 16rpx 0;
  line-height: 1.5;
}
</style>
