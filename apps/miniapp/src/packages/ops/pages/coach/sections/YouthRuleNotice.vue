<script setup lang="ts">
import { computed } from "vue";
import type {
  YouthTrainingRuleView,
  YouthTrainingRuleManagementView,
} from "../../../../../types/training-operations";
import { nextYouthRule } from "../rule-status";
import { money, shortDate } from "../../../../../utils/format";
const props = withDefaults(
  defineProps<{
    activeRule: YouthTrainingRuleView | null;
    rules: YouthTrainingRuleManagementView[];
    showAction?: boolean;
  }>(),
  { showAction: true },
);
defineEmits<{ (event: "settings"): void }>();
const scheduled = computed(() => nextYouthRule(props.rules));
const displayed = computed(() => props.activeRule || scheduled.value);
</script>
<template>
  <view class="card" :class="activeRule ? 'active-rule' : 'rule-blocked'">
    <text class="trial-title">{{
      activeRule
        ? "课包限制 · 使用中"
        : scheduled
          ? "课包限制 · 已发布，待生效"
          : "青少年及不限课程需要先设置课包限制"
    }}</text>
    <text v-if="scheduled" class="muted"
      >预约配置将于北京时间
      {{ shortDate(scheduled.effectiveFrom) }} 生效。</text
    >
    <text v-if="!activeRule && scheduled" class="muted"
      >现在需要使用，可沿用已填配置，选择“立即生效”。</text
    >
    <view v-if="displayed" class="rule-values">
      <text>最多 {{ displayed.maxTotalSessions }} 次</text>
      <text>最长 {{ displayed.maxValidityDays }} 天</text>
      <text>最高 {{ money(displayed.maxContractAmountCents) }}</text>
      <text>{{ displayed.hardBlock ? "超限阻止销售" : "超限仅提醒" }}</text>
    </view>
    <button
      v-if="showAction"
      class="secondary full-button"
      @tap="$emit('settings')"
    >
      查看课包限制
    </button>
  </view>
</template>
<style scoped src="../page.css"></style>
