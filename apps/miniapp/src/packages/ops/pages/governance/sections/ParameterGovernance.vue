<script setup lang="ts">
import type { BusinessParameterDefinition } from "../../../config/governance";
import { toRefs } from "vue";
import SectionEmpty from "../../../../../components/SectionEmpty.vue";
import StatusBadge from "../../../../../components/StatusBadge.vue";
import {
  businessParameterCatalog,
  businessParameterLabel,
  businessPeriodOptions,
  formatBusinessParameterValue,
  type GovernanceTab,
} from "../../../config/governance";
import { shortDate } from "../../../../../utils/format";

const props = defineProps<{
  editing?: boolean;
  activeTab: GovernanceTab;
  canConfigure: boolean;
  changeParameterDefinition: (event: any) => void;
  selectedParameterDefinition: BusinessParameterDefinition;
  parameterForm: {
    key: string;
    scalar: string;
    earlyMinutes: string;
    lateMinutes: string;
    periods: string[];
    reason: string;
    effectiveDate: string;
    effectiveTime: string;
    locked: boolean;
  };
  toggleParameterPeriod: (period: string) => void;
  acting: string;
  createParameter: () => Promise<void>;
  parameters: any[];
}>();
const {
  activeTab,
  canConfigure,
  changeParameterDefinition,
  selectedParameterDefinition,
  parameterForm,
  toggleParameterPeriod,
  acting,
  createParameter,
  parameters,
} = toRefs(props);
function openRuleForm() { uni.navigateTo({ url:'/packages/ops/pages/governance/index?view=create-parameter' }); }
</script>

<template>
  <view>
    <template v-if="activeTab === 'parameters'">
      <button v-if="canConfigure && !editing" class="primary new-rule" @tap="openRuleForm">新增业务规则</button>
      <view v-if="canConfigure && editing" class="card editor rule-editor">
        <text class="section-title">发布业务规则新版本</text>
        <picker
          :range="businessParameterCatalog"
          range-key="label"
          @change="changeParameterDefinition"
          ><view class="field"
            >业务规则：{{ selectedParameterDefinition.label }} ›</view
          ></picker
        >
        <text class="muted small parameter-help">{{
          selectedParameterDefinition.description
        }}</text>
        <view
          v-if="selectedParameterDefinition.kind === 'WINDOW'"
          class="value-editor-grid"
        >
          <input
            v-model="parameterForm.earlyMinutes"
            class="field"
            type="number"
            placeholder="允许提前（分钟）"
          />
          <input
            v-model="parameterForm.lateMinutes"
            class="field"
            type="number"
            placeholder="允许延后（分钟）"
          />
        </view>
        <view
          v-else-if="selectedParameterDefinition.kind === 'PERIODS'"
          class="chips parameter-periods"
        >
          <text
            v-for="period in businessPeriodOptions"
            :key="period.value"
            class="chip"
            :class="{ on: parameterForm.periods.includes(period.value) }"
            @tap="toggleParameterPeriod(period.value)"
            >{{ period.label }}</text
          >
        </view>
        <input
          v-else
          v-model="parameterForm.scalar"
          class="field"
          type="digit"
          :placeholder="selectedParameterDefinition.placeholder || '输入规则值'"
        />
        <view class="value-editor-grid">
          <picker
            mode="date"
            :value="parameterForm.effectiveDate"
            @change="parameterForm.effectiveDate = $event.detail.value"
            ><view class="field"
              >生效日期：{{ parameterForm.effectiveDate }} ›</view
            ></picker
          >
          <picker
            mode="time"
            :value="parameterForm.effectiveTime"
            @change="parameterForm.effectiveTime = $event.detail.value"
            ><view class="field"
              >生效时间：{{ parameterForm.effectiveTime }} ›</view
            ></picker
          >
        </view>
        <input
          v-model="parameterForm.reason"
          class="field"
          maxlength="300"
          placeholder="变更原因（必填，将写入审计）"
        />
        <label class="check"
          ><checkbox
            :checked="parameterForm.locked"
            @tap="parameterForm.locked = !parameterForm.locked"
          />锁定版本（仅超级管理员可继续变更）</label
        >
        <button
          class="primary save-rule"
          :disabled="Boolean(acting)"
          :loading="acting === 'parameter'"
          @tap="createParameter"
        >
          发布业务规则版本
        </button>
      </view>
      <template v-if="!editing">
      <SectionEmpty
        v-if="!parameters.length"
        title="暂无生效业务规则"
        description="新版本发布后按生效时间自动接替旧版本，历史业务仍使用原快照。"
      />
      <view v-for="item in parameters" :key="item.id" class="card data-card"
        ><view class="row"
          ><text class="strong">{{
            businessParameterLabel(item.key, item.description)
          }}</text
          ><StatusBadge :value="item.locked ? 'LOCKED' : 'ACTIVE'" /></view
        ><text class="parameter-value">{{
          formatBusinessParameterValue(item.key, item.value)
        }}</text
        ><text class="muted small"
          >{{ item.description }} · 生效
          {{ shortDate(item.effectiveFrom) }}</text
        ></view
      >
      </template>
    </template>
  </view>
</template>

<style scoped src="../page.css"></style>

<style scoped>.new-rule { margin-bottom:24rpx; }.rule-editor { margin-bottom:calc(150rpx + env(safe-area-inset-bottom)); }.save-rule { position:fixed; left:28rpx; right:28rpx; bottom:calc(20rpx + env(safe-area-inset-bottom)); width:auto; z-index:20; box-shadow:0 0 0 28rpx #fff!important; }</style>
