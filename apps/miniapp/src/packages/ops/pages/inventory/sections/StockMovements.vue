<script setup lang="ts">
import { toRefs, computed } from "vue";
import { opsDeepLinkDomId } from "../../../../../utils/work-item-deep-link";
import type { Tab, MovementType } from "../page-types.js";

const props = defineProps<{
  errorMessage: string;
  tab: Tab;
  canOperate: boolean;
  openMovementForm: (type: MovementType) => void;
  showMovementForm: boolean;
  movementType: MovementType;
  activeItemNames: string[];
  selectMovementItem: (index: number) => void;
  activeItems: any[];
  movementForm: {
    itemId: string;
    sourceLocationId: string;
    targetLocationId: string;
    quantity: string;
    reason: string;
  };
  locationNames: string[];
  selectMovementSource: (index: number) => void;
  activeLocations: any[];
  movementTargetLocationNames: string[];
  selectMovementTarget: (index: number) => void;
  movementTargetLocations: any[];
  saving: boolean;
  submitMovement: () => Promise<null | undefined>;
  loading: boolean;
  operations: any[];
  focusedRecord: string;
  statusLabel: Record<string, string>;
  movementActionLabel: (document: any) => "" | "提交" | "审批" | "过账";
  movementAction: (document: any) => Promise<boolean | undefined>;
}>();
const emit = defineEmits<{
  (event: "update:showMovementForm", value: boolean): void;
}>();
const {
  errorMessage,
  tab,
  canOperate,
  openMovementForm,
  movementType,
  activeItemNames,
  selectMovementItem,
  activeItems,
  movementForm,
  locationNames,
  selectMovementSource,
  activeLocations,
  movementTargetLocationNames,
  selectMovementTarget,
  movementTargetLocations,
  saving,
  submitMovement,
  loading,
  operations,
  focusedRecord,
  statusLabel,
  movementActionLabel,
  movementAction,
} = toRefs(props);
const showMovementForm = computed({
  get: () => props.showMovementForm,
  set: (value) => emit("update:showMovementForm", value),
});
</script>

<template>
  <view>
    <template v-if="!errorMessage && tab === 'MOVEMENT'">
      <view v-if="canOperate" class="create-row"
        ><button
          class="secondary create-half"
          @tap="openMovementForm('TRANSFER')"
        >
          新建调拨</button
        ><button class="primary create-half" @tap="openMovementForm('LOSS')">
          新建报损
        </button></view
      >
      <view v-if="showMovementForm" class="card operation-form">
        <view class="form-heading">
          <view
            ><text class="title"
              >新建{{ movementType === "TRANSFER" ? "调拨" : "报损" }}单</text
            ><text class="muted"
              >商品与库位不自动带入，请核对后提交。</text
            ></view
          >
          <button class="link-button" @tap="showMovementForm = false">
            取消
          </button>
        </view>
        <text class="field-label">商品</text>
        <picker
          mode="selector"
          :range="activeItemNames"
          @change="selectMovementItem(Number(($event as any).detail.value))"
          ><view class="picker-field">{{
            activeItems.find((entry) => entry.id === movementForm.itemId)
              ?.name || "请选择商品"
          }}</view></picker
        >
        <text class="field-label">来源库位</text>
        <picker
          mode="selector"
          :range="locationNames"
          @change="selectMovementSource(Number(($event as any).detail.value))"
          ><view class="picker-field">{{
            activeLocations.find(
              (entry) => entry.id === movementForm.sourceLocationId,
            )?.name || "请选择来源库位"
          }}</view></picker
        >
        <template v-if="movementType === 'TRANSFER'">
          <text class="field-label">目标库位</text>
          <picker
            mode="selector"
            :range="movementTargetLocationNames"
            @change="selectMovementTarget(Number(($event as any).detail.value))"
            ><view class="picker-field">{{
              movementTargetLocations.find(
                (entry) => entry.id === movementForm.targetLocationId,
              )?.name ||
              (movementForm.sourceLocationId
                ? "请选择目标库位"
                : "请先选择来源库位")
            }}</view></picker
          >
        </template>
        <text class="field-label"
          >{{ movementType === "TRANSFER" ? "调拨" : "报损" }}数量</text
        >
        <input
          v-model="movementForm.quantity"
          class="field"
          type="number"
          placeholder="请输入正整数"
        />
        <text class="field-label"
          >{{ movementType === "TRANSFER" ? "调拨" : "报损" }}原因</text
        >
        <input
          v-model="movementForm.reason"
          class="field"
          :placeholder="
            movementType === 'TRANSFER' ? '例如：前台补货' : '例如：包装破损'
          "
        />
        <button
          class="primary form-submit"
          :loading="saving"
          :disabled="saving"
          @tap="submitMovement"
        >
          确认建立{{ movementType === "TRANSFER" ? "调拨" : "报损" }}单
        </button>
      </view>
      <view v-if="!loading && !operations.length" class="card empty"
        >暂无调拨或报损单。</view
      >
      <view
        v-for="document in operations"
        :id="opsDeepLinkDomId('inventory-movement', document.id)"
        :key="document.id"
        class="card document"
        :class="{
          'deep-link-target':
            focusedRecord === `inventory-movement:${document.id}`,
        }"
        ><view class="row"
          ><view
            ><text class="title"
              >{{ document.documentNo }} ·
              {{ document.type === "TRANSFER" ? "调拨" : "报损" }}</text
            ><text class="muted"
              >{{ document.item?.name }} × {{ document.quantity }} ·
              {{ document.sourceLocation?.name
              }}<template v-if="document.targetLocation">
                → {{ document.targetLocation.name }}</template
              ></text
            ></view
          ><text class="status">{{
            statusLabel[document.status] || document.status
          }}</text></view
        ><button
          v-if="canOperate && movementActionLabel(document)"
          class="primary action"
          @tap="movementAction(document)"
        >
          {{ movementActionLabel(document) }}
        </button></view
      >
    </template>
  </view>
</template>

<style scoped src="../page.css"></style>
