<script setup lang="ts">
import type { ConsignmentSettlementUiAction } from "../page-types";
import { toRefs } from "vue";
import { money } from "../../../../../utils/format";
import { opsDeepLinkDomId } from "../../../../../utils/work-item-deep-link";

const props = defineProps<{
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
  loading: boolean;
  refresh: () => void;
  consignmentSettlements: any[];
  focusedRecord: string;
  consignmentSupplierName: (settlement: any) => any;
  consignmentSettlementPeriod: (settlement: any) => string;
  consignmentSettlementStatusLabel: (status?: string) => string;
  consignmentLatestTransition: (settlement: any) => string;
  actionKey: string;
  changeConsignmentSettlement: (
    settlement: any,
    action: ConsignmentSettlementUiAction,
  ) => void;
  acting: (key: string) => boolean;
}>();
const {
  loadErrors,
  loading,
  refresh,
  consignmentSettlements,
  focusedRecord,
  consignmentSupplierName,
  consignmentSettlementPeriod,
  consignmentSettlementStatusLabel,
  consignmentLatestTransition,
  actionKey,
  changeConsignmentSettlement,
  acting,
} = toRefs(props);
</script>

<template>
  <view>
    <view class="section-subtitle">供应商结算单</view>
    <view v-if="loadErrors.consignmentSettlements" class="notice error card">
      <text>{{ loadErrors.consignmentSettlements }}</text>
      <button class="ghost retry" :disabled="loading" @tap="refresh">
        重试
      </button>
    </view>
    <view v-if="loading && !consignmentSettlements.length" class="empty card"
      >正在同步供应商结算单…</view
    >
    <view
      v-for="statement in consignmentSettlements"
      :id="opsDeepLinkDomId('finance-consignment-settlement', statement.id)"
      :key="statement.id"
      class="card workflow-card settlement-card"
      :class="{
        'deep-link-target':
          focusedRecord === `finance-consignment-settlement:${statement.id}`,
      }"
    >
      <view class="workflow-head">
        <view class="workflow-main">
          <text class="order-title">{{
            consignmentSupplierName(statement)
          }}</text>
          <text class="muted"
            >{{ statement.statementNo }} ·
            {{ consignmentSettlementPeriod(statement) }}</text
          >
        </view>
        <text
          class="state-chip"
          :class="`state-${String(statement.status || '').toLowerCase()}`"
          >{{ consignmentSettlementStatusLabel(statement.status) }}</text
        >
      </view>
      <view class="settlement-numbers">
        <view
          ><text class="detail-label">应付/冲正明细</text
          ><text class="detail-value"
            >{{ statement.entryCount || 0 }} 条</text
          ></view
        >
        <view
          ><text class="detail-label">净数量</text
          ><text class="detail-value">{{
            statement.netQuantity || 0
          }}</text></view
        >
        <view
          ><text class="detail-label">版本</text
          ><text class="detail-value">V{{ statement.version || 1 }}</text></view
        >
        <view
          ><text class="detail-label">销售净额</text
          ><text class="detail-value">{{
            money(statement.grossSaleCents)
          }}</text></view
        >
        <view
          ><text class="detail-label">球馆佣金</text
          ><text class="detail-value">{{
            money(statement.commissionCents)
          }}</text></view
        >
        <view
          ><text class="detail-label">应付净额</text
          ><text class="detail-value money">{{
            money(statement.payableCents)
          }}</text></view
        >
      </view>
      <view class="state-guidance">
        <text
          >制单人：{{
            statement.createdBy?.displayName ||
            statement.createdById ||
            "历史数据待补录"
          }}</text
        >
        <text v-if="statement.paymentReference" class="muted workflow-note"
          >付款凭证：{{ statement.paymentReference }}</text
        >
        <text
          v-if="consignmentLatestTransition(statement)"
          class="muted workflow-note"
          >最近动作：{{ consignmentLatestTransition(statement) }}</text
        >
      </view>
      <view
        v-if="
          statement.isOwnCreator === true &&
          ['PENDING_CONFIRMATION', 'CONFIRMED'].includes(statement.status)
        "
        class="locked-note"
        >制单人不能复核、退回或付款自己的结算单，请切换另一名财务或管理员。</view
      >
      <view class="action-row">
        <button
          v-if="statement.status === 'DRAFT'"
          class="primary action-button"
          :disabled="loading || Boolean(actionKey)"
          @tap="changeConsignmentSettlement(statement, 'submit')"
        >
          {{
            acting(`consignment-submit:${statement.id}`)
              ? "提交中…"
              : "提交复核"
          }}
        </button>
        <button
          v-if="statement.status === 'DRAFT'"
          class="danger action-button"
          :disabled="loading || Boolean(actionKey)"
          @tap="changeConsignmentSettlement(statement, 'void')"
        >
          {{
            acting(`consignment-void:${statement.id}`) ? "作废中…" : "作废草稿"
          }}
        </button>
        <button
          v-if="
            statement.status === 'PENDING_CONFIRMATION' &&
            statement.isOwnCreator !== true
          "
          class="primary action-button"
          :disabled="loading || Boolean(actionKey)"
          @tap="changeConsignmentSettlement(statement, 'confirm')"
        >
          {{
            acting(`consignment-confirm:${statement.id}`)
              ? "确认中…"
              : "复核确认"
          }}
        </button>
        <button
          v-if="
            statement.status === 'PENDING_CONFIRMATION' &&
            statement.isOwnCreator !== true
          "
          class="danger action-button"
          :disabled="loading || Boolean(actionKey)"
          @tap="changeConsignmentSettlement(statement, 'dispute')"
        >
          {{
            acting(`consignment-dispute:${statement.id}`)
              ? "退回中…"
              : "记录争议"
          }}
        </button>
        <button
          v-if="
            statement.status === 'CONFIRMED' && statement.isOwnCreator !== true
          "
          class="primary action-button"
          :disabled="loading || Boolean(actionKey)"
          @tap="changeConsignmentSettlement(statement, 'settle')"
        >
          {{
            acting(`consignment-settle:${statement.id}`)
              ? "付款中…"
              : "确认付款"
          }}
        </button>
        <button
          v-if="
            statement.status === 'CONFIRMED' && statement.isOwnCreator !== true
          "
          class="danger action-button"
          :disabled="loading || Boolean(actionKey)"
          @tap="changeConsignmentSettlement(statement, 'return')"
        >
          {{
            acting(`consignment-return:${statement.id}`)
              ? "退回中…"
              : "退回草稿"
          }}
        </button>
      </view>
    </view>
    <view
      v-if="
        !loading &&
        !loadErrors.consignmentSettlements &&
        !consignmentSettlements.length
      "
      class="empty card"
      >当前没有寄售供应商结算单，可按供应商与账期生成草稿。</view
    >
  </view>
</template>

<style scoped src="../page.css"></style>
