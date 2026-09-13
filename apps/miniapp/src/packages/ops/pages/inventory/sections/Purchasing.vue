<script setup lang="ts">
import { toRefs, computed } from "vue";
import { opsDeepLinkDomId } from "../../../../../utils/work-item-deep-link";
import type { Tab } from "../page-types.js";

const props = defineProps<{
  errorMessage: string;
  tab: Tab;
  canOperate: boolean;
  syncPurchaseBatch: () => void;
  openPurchaseForm: () => void;
  showPurchaseForm: boolean;
  supplierNames: string[];
  selectPurchaseSupplier: (index: number) => void;
  activeSuppliers: any[];
  purchaseForm: {
    batchCode: string;
    expiresAt: string;
    supplierId: string;
    itemId: string;
    locationId: string;
    quantity: string;
  };
  purchaseItemNames: string[];
  selectPurchaseItem: (index: number) => void;
  purchaseItems: any[];
  locationNames: string[];
  selectPurchaseLocation: (index: number) => void;
  activeLocations: any[];
  saving: boolean;
  submitPurchaseOrder: () => Promise<null | undefined>;
  loading: boolean;
  purchaseOrders: any[];
  focusedRecord: string;
  statusLabel: Record<string, string>;
  purchaseActionLabel: (order: any) => "" | "提交" | "审批" | "收货";
  purchaseAction: (order: any) => void;
}>();
const emit = defineEmits<{
  (event: "update:showPurchaseForm", value: boolean): void;
}>();
const {
  errorMessage,
  tab,
  canOperate,
  syncPurchaseBatch,
  openPurchaseForm,
  supplierNames,
  selectPurchaseSupplier,
  activeSuppliers,
  purchaseForm,
  purchaseItemNames,
  selectPurchaseItem,
  purchaseItems,
  locationNames,
  selectPurchaseLocation,
  activeLocations,
  saving,
  submitPurchaseOrder,
  loading,
  purchaseOrders,
  focusedRecord,
  statusLabel,
  purchaseActionLabel,
  purchaseAction,
} = toRefs(props);
const showPurchaseForm = computed({
  get: () => props.showPurchaseForm,
  set: (value) => emit("update:showPurchaseForm", value),
});
</script>

<template>
  <view>
    <template v-if="!errorMessage && tab === 'PURCHASE'">
      <button v-if="canOperate" class="primary create" @tap="openPurchaseForm">
        新建采购单
      </button>
      <view v-if="showPurchaseForm" class="card operation-form">
        <view class="form-heading">
          <view
            ><text class="title">新建采购单</text
            ><text class="muted"
              >供应商、商品和收货库位均不预选，请由经办人逐项确认。</text
            ></view
          >
          <button class="link-button" @tap="showPurchaseForm = false">
            取消
          </button>
        </view>
        <text class="field-label">供应商</text>
        <picker
          mode="selector"
          :range="supplierNames"
          @change="selectPurchaseSupplier(Number(($event as any).detail.value))"
          ><view class="picker-field">{{
            activeSuppliers.find(
              (entry) => entry.id === purchaseForm.supplierId,
            )?.name || "请选择供应商"
          }}</view></picker
        >
        <text class="field-label">采购商品</text>
        <picker
          mode="selector"
          :range="purchaseItemNames"
          @change="selectPurchaseItem(Number(($event as any).detail.value))"
          ><view class="picker-field">{{
            purchaseItems.find((entry) => entry.id === purchaseForm.itemId)
              ?.name ||
            (purchaseForm.supplierId ? "请选择采购商品" : "请先选择供应商")
          }}</view></picker
        >
        <text class="field-label">收货库位</text>
        <picker
          mode="selector"
          :range="locationNames"
          @change="selectPurchaseLocation(Number(($event as any).detail.value))"
          ><view class="picker-field">{{
            activeLocations.find(
              (entry) => entry.id === purchaseForm.locationId,
            )?.name || "请选择收货库位"
          }}</view></picker
        >
        <text class="field-label">本批采购批次</text><input v-model="purchaseForm.batchCode" @blur="syncPurchaseBatch" class="field" maxlength="80" placeholder="核对实物批次" />
        <text class="field-label">本批有效期（无效期可留空）</text><input v-model="purchaseForm.expiresAt" class="field" maxlength="10" placeholder="YYYY-MM-DD" />
        <text class="muted">批次与效期会随采购收货入库，请以本批实物为准。</text>
        <text class="field-label">采购数量</text>
        <input
          v-model="purchaseForm.quantity"
          class="field"
          type="number"
          placeholder="请输入正整数"
        />
        <button
          class="primary form-submit"
          :loading="saving"
          :disabled="saving"
          @tap="submitPurchaseOrder"
        >
          确认建立采购单
        </button>
      </view>
      <view v-if="!loading && !purchaseOrders.length" class="card empty"
        >暂无采购单。</view
      >
      <view
        v-for="order in purchaseOrders"
        :id="opsDeepLinkDomId('inventory-purchase', order.id)"
        :key="order.id"
        class="card document"
        :class="{
          'deep-link-target':
            focusedRecord === `inventory-purchase:${order.id}`,
        }"
        ><view class="row"
          ><view
            ><text class="title">{{ order.orderNo }}</text
            ><text class="muted"
              >{{ order.supplier?.name }} · {{ order.lines.length }} 项</text
            ></view
          ><text class="status">{{
            statusLabel[order.status] || order.status
          }}</text></view
        ><view v-for="line in order.lines" :key="line.id" class="line"
          ><text>{{ line.item?.name }}</text
          ><text
            >{{ line.receivedQuantity }}/{{ line.orderedQuantity }}</text
          ></view
        ><button
          v-if="canOperate && purchaseActionLabel(order)"
          class="primary action"
          @tap="purchaseAction(order)"
        >
          {{ purchaseActionLabel(order) }}
        </button></view
      >
    </template>
  </view>
</template>

<style scoped src="../page.css"></style>
