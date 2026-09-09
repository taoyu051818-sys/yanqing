<script setup lang="ts">
import { toRefs, computed } from "vue";
import { money } from "../../../../../utils/format";
import { opsDeepLinkDomId } from "../../../../../utils/work-item-deep-link";
import type { Tab, UsageType } from "../page-types.js";

const props = defineProps<{
  errorMessage: string;
  tab: Tab;
  showUsageForm: boolean;
  usageForm: {
    type: UsageType;
    itemId: string;
    referenceId: string;
    quantity: string;
  };
  activeItems: any[];
  usageReferenceNames: string[];
  selectUsageReference: (index: number) => void;
  eligibleUsageReferences: any[];
  usageReferenceLabel: (type: UsageType, entry: any) => string;
  saving: boolean;
  submitUsage: () => Promise<any>;
  loading: boolean;
  items: any[];
  isAdmin: boolean;
  focusedRecord: string;
  stockItemContext: (item: any) => string;
  canUseForTraining: boolean;
  canUseForEvent: boolean;
  openUsageForm: (item: any, type: UsageType) => void;
}>();
const emit = defineEmits<{
  (event: "update:showUsageForm", value: boolean): void;
}>();
const {
  errorMessage,
  tab,
  usageForm,
  activeItems,
  usageReferenceNames,
  selectUsageReference,
  eligibleUsageReferences,
  usageReferenceLabel,
  saving,
  submitUsage,
  loading,
  items,
  isAdmin,
  focusedRecord,
  stockItemContext,
  canUseForTraining,
  canUseForEvent,
  openUsageForm,
} = toRefs(props);
const showUsageForm = computed({
  get: () => props.showUsageForm,
  set: (value) => emit("update:showUsageForm", value),
});
</script>

<template>
  <view>
    <template v-if="!errorMessage && tab === 'STOCK'">
      <view v-if="showUsageForm" class="card operation-form">
        <view class="form-heading">
          <view>
            <text class="title">{{
              usageForm.type === "TRAINING_USAGE" ? "培训领用" : "赛事领用"
            }}</text>
            <text class="muted"
              >商品由经办人从库存卡片发起，关联业务与数量必须逐项确认。</text
            >
          </view>
          <button class="link-button" @tap="showUsageForm = false">取消</button>
        </view>
        <text class="field-label">领用商品</text>
        <view class="picker-field readonly-field">{{
          activeItems.find((entry) => entry.id === usageForm.itemId)?.name ||
          "请选择要领用的商品"
        }}</view>
        <text class="field-label"
          >关联{{ usageForm.type === "TRAINING_USAGE" ? "课次" : "赛事" }}</text
        >
        <picker
          mode="selector"
          :range="usageReferenceNames"
          @change="selectUsageReference(Number(($event as any).detail.value))"
          ><view class="picker-field">{{
            eligibleUsageReferences.find(
              (entry: any) => entry.id === usageForm.referenceId,
            )
              ? usageReferenceLabel(
                  usageForm.type,
                  eligibleUsageReferences.find(
                    (entry: any) => entry.id === usageForm.referenceId,
                  ),
                )
              : `请选择关联${usageForm.type === "TRAINING_USAGE" ? "课次" : "赛事"}`
          }}</view></picker
        >
        <text v-if="!eligibleUsageReferences.length" class="form-warning"
          >暂无可关联{{
            usageForm.type === "TRAINING_USAGE" ? "课次" : "赛事"
          }}，请先建立业务排期。</text
        >
        <text class="field-label">领用数量</text>
        <input
          v-model="usageForm.quantity"
          class="field"
          type="number"
          placeholder="请输入正整数"
        />
        <button
          class="primary form-submit"
          :loading="saving"
          :disabled="saving"
          @tap="submitUsage"
        >
          确认领用并过账
        </button>
      </view>
      <view v-if="!loading && !items.length" class="card empty">{{
        isAdmin ? "暂无库存 SKU，请先维护基础资料。" : "当前没有低库存预警。"
      }}</view>
      <view
        v-for="item in items"
        :id="opsDeepLinkDomId('inventory-item', item.id)"
        :key="item.id"
        class="card document"
        :class="{
          'deep-link-target': focusedRecord === `inventory-item:${item.id}`,
        }"
        ><view class="row"
          ><view
            ><text class="title">{{ item.name }}</text
            ><text class="muted">{{ stockItemContext(item) }}</text></view
          ><text
            class="quantity"
            :class="{ warning: item.stock <= item.safeStock }"
            >{{ item.stock }}</text
          ></view
        ><text v-if="isAdmin" class="muted"
          >售价 {{ money(item.salePriceCents) }}</text
        ><view
          v-if="item.enabled !== false && (canUseForTraining || canUseForEvent)"
          class="usage-row"
          ><button
            v-if="canUseForTraining"
            class="secondary usage-action"
            @tap="openUsageForm(item, 'TRAINING_USAGE')"
          >
            培训领用</button
          ><button
            v-if="canUseForEvent"
            class="secondary usage-action"
            @tap="openUsageForm(item, 'EVENT_USAGE')"
          >
            赛事领用
          </button></view
        ></view
      >
    </template>
  </view>
</template>

<style scoped src="../page.css"></style>
