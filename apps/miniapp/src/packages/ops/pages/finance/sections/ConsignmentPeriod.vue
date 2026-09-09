<script setup lang="ts">
import { toRefs } from "vue";

const props = defineProps<{
  loading: boolean;
  consignmentPayables: any[];
  consignmentSettlements: any[];
  consignmentPeriodStartDate: string;
  onConsignmentPeriodStartChange: (event: any) => void;
  consignmentPeriodEndDate: string;
  onConsignmentPeriodEndChange: (event: any) => void;
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
  activeConsignmentSuppliers: any[];
  consignmentSupplierRule: (supplier: any) => string;
  actionKey: string;
  createConsignmentSettlementDraft: (supplier: any) => void;
  acting: (key: string) => boolean;
}>();
const {
  loading,
  consignmentPayables,
  consignmentSettlements,
  consignmentPeriodStartDate,
  onConsignmentPeriodStartChange,
  consignmentPeriodEndDate,
  onConsignmentPeriodEndChange,
  loadErrors,
  activeConsignmentSuppliers,
  consignmentSupplierRule,
  actionKey,
  createConsignmentSettlementDraft,
  acting,
} = toRefs(props);
</script>

<template>
  <view>
    <view class="section-title">
      寄售应付与供应商结算
      <text class="section-note">{{
        loading
          ? "同步中"
          : `${consignmentPayables.length} 条明细 · ${consignmentSettlements.length} 张结算单`
      }}</text>
    </view>
    <text class="section-description"
      >寄售商品完成销售履约后生成供应商应付，整单退款追加负数冲正；自营采购库存不进入该账本。未制单明细和未完成周期结算持续预警但不阻断每日关账；源流水锁定后仍可按周/月对账付款。</text
    >
    <view class="card training-settlement-tools">
      <view class="period-picker-row">
        <picker
          mode="date"
          :value="consignmentPeriodStartDate"
          @change="onConsignmentPeriodStartChange"
        >
          <view class="picker-field"
            ><text class="detail-label">账期开始</text
            ><text class="detail-value">{{
              consignmentPeriodStartDate
            }}</text></view
          >
        </picker>
        <picker
          mode="date"
          :value="consignmentPeriodEndDate"
          @change="onConsignmentPeriodEndChange"
        >
          <view class="picker-field"
            ><text class="detail-label">账期结束（不含）</text
            ><text class="detail-value">{{
              consignmentPeriodEndDate
            }}</text></view
          >
        </picker>
      </view>
      <view v-if="loadErrors.consignmentSuppliers" class="inline-error">{{
        loadErrors.consignmentSuppliers
      }}</view>
      <view
        v-for="supplier in activeConsignmentSuppliers"
        :key="supplier.id"
        class="supplier-create-row"
      >
        <view class="workflow-main">
          <text class="order-title">{{ supplier.name }}</text>
          <text class="muted"
            >{{ supplier.code || "寄售供应商" }} ·
            {{ consignmentSupplierRule(supplier) }}</text
          >
        </view>
        <button
          class="secondary inline"
          :disabled="loading || Boolean(actionKey)"
          @tap="createConsignmentSettlementDraft(supplier)"
        >
          {{
            acting(`consignment-create:${supplier.id}`)
              ? "生成中…"
              : "按账期制单"
          }}
        </button>
      </view>
      <view
        v-if="
          !loading &&
          !loadErrors.consignmentSuppliers &&
          !activeConsignmentSuppliers.length
        "
        class="embedded-empty"
        >当前没有启用的寄售供应商，请先在库存管理完成主数据配置。</view
      >
    </view>
  </view>
</template>

<style scoped src="../page.css"></style>
