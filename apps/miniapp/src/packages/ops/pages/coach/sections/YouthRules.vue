<script setup lang="ts">
import { toRefs, computed } from "vue";
import StatusBadge from "../../../../../components/StatusBadge.vue";
import {
  money,
  shortDate,
  today as shanghaiDate,
} from "../../../../../utils/format";

const props = defineProps<{
  canConfigureTraining: boolean;
  activeYouthRule: any;
  canDraftYouthRule: boolean;
  ruleMaxSessions: string;
  ruleMaxValidityDays: string;
  ruleMaxAmountYuan: string;
  ruleWarningDays: string;
  ruleEffectiveDate: string;
  ruleEffectiveTime: string;
  ruleHardBlock: boolean;
  setRuleHardBlock: (event: any) => void;
  ruleReason: string;
  actionKey: string;
  loading: boolean;
  createYouthRule: () => Promise<void>;
  youthRules: any[];
  canReviewYouthRule: boolean;
  decideYouthRule: (rule: any, decision: "publish" | "reject") => void;
}>();
const emit = defineEmits<{
  (event: "update:ruleMaxSessions", value: string): void;
  (event: "update:ruleMaxValidityDays", value: string): void;
  (event: "update:ruleMaxAmountYuan", value: string): void;
  (event: "update:ruleWarningDays", value: string): void;
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
</script>

<template>
  <view>
    <template v-if="canConfigureTraining">
      <view class="section-title"
        >青少年培训监管规则
        <text class="section-note"
          >管理员配置 · 异人复核 · 按生效时间版本化</text
        ></view
      >
      <view v-if="activeYouthRule" class="card active-rule">
        <view class="row"
          ><view
            ><text class="trial-title"
              >当前生效 {{ activeYouthRule.version }}</text
            ><text class="muted"
              >生效于 {{ shortDate(activeYouthRule.effectiveFrom) }}</text
            ></view
          ><StatusBadge value="PUBLISHED"
        /></view>
        <view class="rule-values"
          ><text>总课时上限 {{ activeYouthRule.maxTotalSessions }}</text
          ><text>有效期限上限 {{ activeYouthRule.maxValidityDays }} 天</text
          ><text
            >单合同上限
            {{ money(activeYouthRule.maxContractAmountCents) }}</text
          ><text
            >到期预警 {{ activeYouthRule.warningThresholdDays }} 天</text
          ></view
        >
      </view>
      <view v-else class="card rule-blocked"
        ><text class="trial-title">当前无生效规则</text
        ><text
          >青少年培训产品启用、变更与正式购买均会明确阻断；请由管理员制单、另一名超级管理员复核，并等待生效时间。</text
        ></view
      >
      <view v-if="canDraftYouthRule" class="card creation-form">
        <text class="guardrail"
          >下列字段全部由管理员依据当期合规要求填写。系统不预置、不暗示任何法定数值。</text
        >
        <view class="form-grid"
          ><view
            ><text class="field-label">最大总课时</text
            ><input
              v-model="ruleMaxSessions"
              class="form-input"
              type="number"
              placeholder="请按现行要求填写" /></view
          ><view
            ><text class="field-label">最大有效期限（天）</text
            ><input
              v-model="ruleMaxValidityDays"
              class="form-input"
              type="number"
              placeholder="请按现行要求填写" /></view
        ></view>
        <view class="form-grid"
          ><view
            ><text class="field-label">单合同金额上限（元）</text
            ><input
              v-model="ruleMaxAmountYuan"
              class="form-input"
              type="digit"
              placeholder="请按现行要求填写" /></view
          ><view
            ><text class="field-label">到期预警阈值（天）</text
            ><input
              v-model="ruleWarningDays"
              class="form-input"
              type="number"
              placeholder="由管理员配置" /></view
        ></view>
        <view class="form-grid"
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
        <view class="consent-line"
          ><text>超限时硬阻断（关闭后仍会产生显著预警并固化快照）</text
          ><switch
            color="#17653d"
            :checked="ruleHardBlock"
            @change="setRuleHardBlock"
        /></view>
        <view
          ><text class="field-label">制单依据（必填）</text
          ><textarea
            v-model="ruleReason"
            class="reason-input"
            maxlength="300"
            placeholder="填写规则来源、核对日期与业务依据"
          />
        </view>
        <button
          class="primary full-button"
          :loading="actionKey === 'create-youth-rule'"
          :disabled="loading || Boolean(actionKey)"
          @tap="createYouthRule"
        >
          提交规则草案
        </button>
      </view>
      <view v-for="rule in youthRules" :key="rule.id" class="card rule-card">
        <view class="row"
          ><view
            ><text class="trial-title">{{ rule.version }}</text
            ><text class="muted"
              >申请人 {{ rule.requestedBy?.displayName || "系统记录" }} · 计划
              {{ shortDate(rule.effectiveFrom) }} 生效</text
            ></view
          ><StatusBadge :value="rule.status"
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
        <text class="audit-hint">制单依据：{{ rule.requestReason }}</text>
        <view
          v-if="rule.status === 'DRAFT' && canReviewYouthRule"
          class="trial-actions"
        >
          <button
            class="primary inline"
            :disabled="rule.isOwnRequester === true"
            @tap="decideYouthRule(rule, 'publish')"
          >
            复核发布
          </button>
          <button
            class="danger inline"
            :disabled="rule.isOwnRequester === true"
            @tap="decideYouthRule(rule, 'reject')"
          >
            驳回
          </button>
          <text v-if="rule.isOwnRequester === true" class="pending-text"
            >本人制单，必须由另一账号复核</text
          >
        </view>
      </view>
    </template>
  </view>
</template>

<style scoped src="../page.css"></style>
