<script setup lang="ts">
import { toRefs } from "vue";
import { money, shortDate } from "../../../../../utils/format";

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
  consignmentPayables: any[];
  payableAssignment: (entry: any) => string;
}>();
const { loadErrors, loading, refresh, consignmentPayables, payableAssignment } =
  toRefs(props);
</script>

<template>
  <view>
    <view class="section-subtitle">应付流水</view>
    <view v-if="loadErrors.consignmentPayables" class="notice error card">
      <text>{{ loadErrors.consignmentPayables }}</text>
      <button class="ghost retry" :disabled="loading" @tap="refresh">
        重试
      </button>
    </view>
    <view v-if="loading && !consignmentPayables.length" class="empty card"
      >正在同步寄售应付流水…</view
    >
    <view
      v-for="entry in consignmentPayables"
      :key="entry.id"
      class="card workflow-card"
    >
      <view class="workflow-head">
        <view class="workflow-main">
          <text class="order-title"
            >{{ entry.supplier?.name || "寄售供应商" }} ·
            {{ entry.item?.name || entry.item?.sku || "商品" }}</text
          >
          <text class="muted"
            >{{ entry.order?.orderNo || "历史订单"
            }}<template v-if="entry.refund?.refundNo">
              · {{ entry.refund.refundNo }}</template
            >
            · {{ shortDate(entry.occurredAt) }}</text
          >
        </view>
        <text
          class="state-chip"
          :class="
            entry.type === 'REFUND_REVERSAL' ? 'state-void' : 'state-settled'
          "
          >{{
            entry.type === "REFUND_REVERSAL" ? "退款冲正" : "销售应付"
          }}</text
        >
      </view>
      <view class="settlement-numbers">
        <view
          ><text class="detail-label">数量</text
          ><text class="detail-value">{{ entry.quantity || 0 }}</text></view
        >
        <view
          ><text class="detail-label">销售额</text
          ><text class="detail-value">{{
            money(entry.grossSaleCents)
          }}</text></view
        >
        <view
          ><text class="detail-label">球馆佣金</text
          ><text class="detail-value">{{
            money(entry.commissionCents)
          }}</text></view
        >
        <view
          ><text class="detail-label">供应商应付</text
          ><text class="detail-value money">{{
            money(entry.payableCents)
          }}</text></view
        >
        <view
          ><text class="detail-label">佣金比例</text
          ><text class="detail-value"
            >{{ Number(entry.commissionRateBps || 0) / 100 }}%</text
          ></view
        >
        <view
          ><text class="detail-label">结算归属</text
          ><text class="detail-value">{{
            payableAssignment(entry)
          }}</text></view
        >
      </view>
    </view>
    <view
      v-if="
        !loading &&
        !loadErrors.consignmentPayables &&
        !consignmentPayables.length
      "
      class="empty card"
      >当前没有寄售应付明细</view
    >
  </view>
</template>

<style scoped src="../page.css"></style>
