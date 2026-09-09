<script setup lang="ts">
import { toRefs } from "vue";
import { money } from "../../../../../utils/format";
import { opsDeepLinkDomId } from "../../../../../utils/work-item-deep-link";

const props = defineProps<{
  loading: boolean;
  trainingSettlements: any[];
  trainingPeriodStartDate: string;
  onTrainingPeriodStartChange: (event: any) => void;
  trainingPeriodEndDate: string;
  onTrainingPeriodEndChange: (event: any) => void;
  trainingSettlementStatusOptions: { value: string; label: string }[];
  trainingSettlementStatusIndex: number;
  onTrainingSettlementStatusChange: (event: any) => void;
  actionKey: string;
  createTrainingSettlementDraft: () => void;
  acting: (key: string) => boolean;
  loadErrors: {
    dashboard: string;
    refunds: string;
    training: string;
    trainingSettlements: string;
    merchants: string;
    settlements: string;
    consignmentSuppliers: string;
    consignmentPayables: string;
    consignmentSettlements: string;
    reconciliation: string;
    adjustments: string;
    shifts: string;
  };
  refresh: () => void;
  focusedRecord: string;
  trainingSettlementPeriod: (settlement: any) => string;
  trainingSettlementStatusLabel: (status?: string) => string;
  trainingSettlementLatestNote: (settlement: any) => string;
  isOwnTrainingSettlement: (settlement: any) => boolean;
  changeTrainingSettlement: (
    settlement: any,
    action: "submit" | "confirm" | "settle" | "return" | "void",
  ) => void;
}>();
const {
  loading,
  trainingSettlements,
  trainingPeriodStartDate,
  onTrainingPeriodStartChange,
  trainingPeriodEndDate,
  onTrainingPeriodEndChange,
  trainingSettlementStatusOptions,
  trainingSettlementStatusIndex,
  onTrainingSettlementStatusChange,
  actionKey,
  createTrainingSettlementDraft,
  acting,
  loadErrors,
  refresh,
  focusedRecord,
  trainingSettlementPeriod,
  trainingSettlementStatusLabel,
  trainingSettlementLatestNote,
  isOwnTrainingSettlement,
  changeTrainingSettlement,
} = toRefs(props);
</script>

<template>
  <view>
    <view class="section-title">
      培训结算
      <text class="section-note">{{
        loading ? "同步中" : `${trainingSettlements.length} 张`
      }}</text>
    </view>
    <text class="section-description"
      >财务制单、另一账号复核、确认后入账；营业日关账锁定源流水，不锁死之后的周/月结算。</text
    >
    <view class="card training-settlement-tools">
      <view class="period-picker-row">
        <picker
          mode="date"
          :value="trainingPeriodStartDate"
          @change="onTrainingPeriodStartChange"
        >
          <view class="picker-field"
            ><text class="detail-label">账期开始</text
            ><text class="detail-value">{{
              trainingPeriodStartDate
            }}</text></view
          >
        </picker>
        <picker
          mode="date"
          :value="trainingPeriodEndDate"
          @change="onTrainingPeriodEndChange"
        >
          <view class="picker-field"
            ><text class="detail-label">账期结束（不含）</text
            ><text class="detail-value">{{ trainingPeriodEndDate }}</text></view
          >
        </picker>
      </view>
      <view class="training-tool-actions">
        <picker
          :range="trainingSettlementStatusOptions"
          range-key="label"
          :value="trainingSettlementStatusIndex"
          @change="onTrainingSettlementStatusChange"
        >
          <view class="secondary filter-button"
            >筛选：{{
              trainingSettlementStatusOptions[trainingSettlementStatusIndex]
                .label
            }}</view
          >
        </picker>
        <button
          class="primary inline training-create"
          :disabled="loading || Boolean(actionKey)"
          @tap="createTrainingSettlementDraft"
        >
          {{
            acting(
              `training-settlement-create:${trainingPeriodStartDate}:${trainingPeriodEndDate}`,
            )
              ? "生成中…"
              : "生成账期草稿"
          }}
        </button>
      </view>
    </view>
    <view v-if="loadErrors.trainingSettlements" class="notice error card">
      <text>{{ loadErrors.trainingSettlements }}</text>
      <button class="ghost retry" :disabled="loading" @tap="refresh">
        重试
      </button>
    </view>
    <view v-if="loading && !trainingSettlements.length" class="empty card"
      >正在同步培训结算账本…</view
    >
    <view
      v-for="statement in trainingSettlements"
      :id="opsDeepLinkDomId('finance-training-settlement', statement.id)"
      :key="statement.id"
      class="card workflow-card settlement-card"
      :class="{
        'deep-link-target':
          focusedRecord === `finance-training-settlement:${statement.id}`,
      }"
    >
      <view class="workflow-head">
        <view class="workflow-main">
          <text class="order-title">培训合同流水结算</text>
          <text class="muted">{{ trainingSettlementPeriod(statement) }}</text>
        </view>
        <text
          class="state-chip"
          :class="`state-${String(statement.status || '').toLowerCase()}`"
          >{{ trainingSettlementStatusLabel(statement.status) }}</text
        >
      </view>
      <view class="settlement-numbers">
        <view
          ><text class="detail-label">有效消课收入</text
          ><text class="detail-value money">{{
            money(statement.effectiveRevenueCents)
          }}</text></view
        >
        <view
          ><text class="detail-label">场馆合同分成</text
          ><text class="detail-value money">{{
            money(statement.venueContributionCents)
          }}</text></view
        >
        <view
          ><text class="detail-label">现金贡献毛利</text
          ><text class="detail-value">{{
            money(statement.cashContributionMarginCents)
          }}</text></view
        >
        <view
          ><text class="detail-label">教练 / 助教成本</text
          ><text class="detail-value"
            >{{ money(statement.coachCostCents) }} /
            {{ money(statement.assistantCostCents) }}</text
          ></view
        >
        <view
          ><text class="detail-label">物料成本</text
          ><text class="detail-value">{{
            money(statement.materialCostCents)
          }}</text></view
        >
        <view
          ><text class="detail-label">获客 / 营销成本</text
          ><text class="detail-value"
            >{{ money(statement.acquisitionCostCents) }} /
            {{ money(statement.marketingCostCents) }}</text
          ></view
        >
      </view>
      <view class="state-guidance">
        <text
          >制单人：{{
            statement.createdBy?.displayName || "历史数据待补录"
          }}</text
        >
        <text
          v-if="trainingSettlementLatestNote(statement)"
          class="muted workflow-note"
          >最近动作：{{ trainingSettlementLatestNote(statement) }}</text
        >
      </view>
      <view
        v-if="
          isOwnTrainingSettlement(statement) &&
          ['PENDING_CONFIRMATION', 'CONFIRMED'].includes(statement.status)
        "
        class="locked-note"
        >制单人与复核/入账人不能是同一账号，请切换另一名财务或管理员。</view
      >
      <view class="action-row">
        <button
          v-if="statement.status === 'DRAFT'"
          class="primary action-button"
          :disabled="loading || Boolean(actionKey)"
          @tap="changeTrainingSettlement(statement, 'submit')"
        >
          {{
            acting(`training-settlement-submit:${statement.id}`)
              ? "提交中…"
              : "提交复核"
          }}
        </button>
        <button
          v-if="statement.status === 'DRAFT'"
          class="danger action-button"
          :disabled="loading || Boolean(actionKey)"
          @tap="changeTrainingSettlement(statement, 'void')"
        >
          {{
            acting(`training-settlement-void:${statement.id}`)
              ? "作废中…"
              : "作废草稿"
          }}
        </button>
        <button
          v-if="
            statement.status === 'PENDING_CONFIRMATION' &&
            !isOwnTrainingSettlement(statement)
          "
          class="primary action-button"
          :disabled="loading || Boolean(actionKey)"
          @tap="changeTrainingSettlement(statement, 'confirm')"
        >
          {{
            acting(`training-settlement-confirm:${statement.id}`)
              ? "确认中…"
              : "复核确认"
          }}
        </button>
        <button
          v-if="
            statement.status === 'PENDING_CONFIRMATION' &&
            !isOwnTrainingSettlement(statement)
          "
          class="danger action-button"
          :disabled="loading || Boolean(actionKey)"
          @tap="changeTrainingSettlement(statement, 'return')"
        >
          {{
            acting(`training-settlement-return:${statement.id}`)
              ? "退回中…"
              : "退回草稿"
          }}
        </button>
        <button
          v-if="
            statement.status === 'CONFIRMED' &&
            !isOwnTrainingSettlement(statement)
          "
          class="primary action-button"
          :disabled="loading || Boolean(actionKey)"
          @tap="changeTrainingSettlement(statement, 'settle')"
        >
          {{
            acting(`training-settlement-settle:${statement.id}`)
              ? "入账中…"
              : "确认结算入账"
          }}
        </button>
      </view>
    </view>
    <view
      v-if="
        !loading &&
        !loadErrors.trainingSettlements &&
        !trainingSettlements.length
      "
      class="empty card"
      >当前筛选条件下没有培训结算单</view
    >
  </view>
</template>

<style scoped src="../page.css"></style>
