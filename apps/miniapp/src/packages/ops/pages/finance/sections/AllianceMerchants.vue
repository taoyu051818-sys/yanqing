<script setup lang="ts">
import { toRefs } from "vue";

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
  merchants: any[];
  loading: boolean;
  actionKey: string;
  canFinanceAction: boolean;
  createSettlement: (merchant: any) => void;
  acting: (key: string) => boolean;
}>();
const {
  loadErrors,
  merchants,
  loading,
  actionKey,
  canFinanceAction,
  createSettlement,
  acting,
} = toRefs(props);
</script>

<template>
  <view>
    <view class="section-title">联盟结算草稿</view>
    <text class="section-description"
      >先选择商户生成周期草稿；草稿金额来自唯一券核销归因，不能用手工预估替代。</text
    >
    <view v-if="loadErrors.merchants" class="notice error card">{{
      loadErrors.merchants
    }}</view>
    <view
      v-for="merchant in merchants"
      :key="merchant.id"
      class="card merchant-row"
    >
      <view class="workflow-main">
        <text class="order-title">{{ merchant.name }}</text>
        <text class="muted"
          >{{ merchant.code || merchant.category || "联盟商户" }} ·
          仅统计已核销归因</text
        >
      </view>
      <button
        class="secondary inline"
        :disabled="loading || Boolean(actionKey) || !canFinanceAction"
        @tap="createSettlement(merchant)"
      >
        {{
          acting(`settlement-create:${merchant.id}`) ? "生成中…" : "生成草稿"
        }}
      </button>
    </view>
    <view v-if="loading && !merchants.length" class="empty card"
      >正在同步联盟商户…</view
    >
    <view
      v-if="!loading && !loadErrors.merchants && !merchants.length"
      class="empty card"
      >当前没有可结算联盟商户</view
    >
  </view>
</template>

<style scoped src="../page.css"></style>
