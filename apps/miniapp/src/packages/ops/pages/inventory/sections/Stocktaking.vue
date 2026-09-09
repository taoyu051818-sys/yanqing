<script setup lang="ts">
import { toRefs, computed } from "vue";
import { opsDeepLinkDomId } from "../../../../../utils/work-item-deep-link";
import type { Tab } from "../page-types.js";

const props = defineProps<{
  errorMessage: string;
  tab: Tab;
  canOperate: boolean;
  openStocktakeForm: () => void;
  showStocktakeForm: boolean;
  locationNames: string[];
  selectStocktakeLocation: (index: number) => void;
  activeLocations: any[];
  stocktakeForm: { locationId: string; reason: string };
  saving: boolean;
  submitStocktake: () => Promise<null | undefined>;
  loading: boolean;
  stocktakes: any[];
  focusedRecord: string;
  statusLabel: Record<string, string>;
  isAdmin: boolean;
  stocktakeAction: (document: any) => void;
}>();
const emit = defineEmits<{
  (event: "update:showStocktakeForm", value: boolean): void;
}>();
const {
  errorMessage,
  tab,
  canOperate,
  openStocktakeForm,
  locationNames,
  selectStocktakeLocation,
  activeLocations,
  stocktakeForm,
  saving,
  submitStocktake,
  loading,
  stocktakes,
  focusedRecord,
  statusLabel,
  isAdmin,
  stocktakeAction,
} = toRefs(props);
const showStocktakeForm = computed({
  get: () => props.showStocktakeForm,
  set: (value) => emit("update:showStocktakeForm", value),
});
</script>

<template>
  <view>
    <template v-if="!errorMessage && tab === 'STOCKTAKE'">
      <button v-if="canOperate" class="primary create" @tap="openStocktakeForm">
        新建盘点单
      </button>
      <view v-if="showStocktakeForm" class="card operation-form">
        <view class="form-heading">
          <view
            ><text class="title">新建盘点单</text
            ><text class="muted"
              >盘点库位不自动带入，避免误盘其他仓位。</text
            ></view
          >
          <button class="link-button" @tap="showStocktakeForm = false">
            取消
          </button>
        </view>
        <text class="field-label">盘点库位</text>
        <picker
          mode="selector"
          :range="locationNames"
          @change="
            selectStocktakeLocation(Number(($event as any).detail.value))
          "
          ><view class="picker-field">{{
            activeLocations.find(
              (entry) => entry.id === stocktakeForm.locationId,
            )?.name || "请选择盘点库位"
          }}</view></picker
        >
        <text class="field-label">盘点原因</text>
        <input
          v-model="stocktakeForm.reason"
          class="field"
          placeholder="例如：月末例行盘点"
        />
        <button
          class="primary form-submit"
          :loading="saving"
          :disabled="saving"
          @tap="submitStocktake"
        >
          确认建立盘点单
        </button>
      </view>
      <view v-if="!loading && !stocktakes.length" class="card empty"
        >暂无盘点单。</view
      >
      <view
        v-for="document in stocktakes"
        :id="opsDeepLinkDomId('inventory-stocktake', document.id)"
        :key="document.id"
        class="card document"
        :class="{
          'deep-link-target':
            focusedRecord === `inventory-stocktake:${document.id}`,
        }"
        ><view class="row"
          ><view
            ><text class="title">{{ document.stocktakeNo }}</text
            ><text class="muted"
              >{{ document.location?.name }} · {{ document.reason }}</text
            ></view
          ><text class="status">{{
            statusLabel[document.status] || document.status
          }}</text></view
        ><text v-if="document.status === 'COUNTING'" class="muted"
          >已录
          {{
            document.lines.filter((line: any) => line.countedQuantity !== null)
              .length
          }}/{{ document.lines.length }} 项</text
        ><button
          v-if="
            canOperate &&
            (document.status !== 'REVIEW' || isAdmin) &&
            !['POSTED', 'CANCELLED'].includes(document.status)
          "
          class="primary action"
          @tap="stocktakeAction(document)"
        >
          {{
            document.status === "DRAFT"
              ? "开始"
              : document.status === "COUNTING"
                ? document.lines.some(
                    (line: any) => line.countedQuantity === null,
                  )
                  ? "录入下一项"
                  : "提交复核"
                : "复核过账"
          }}
        </button></view
      >
    </template>
  </view>
</template>

<style scoped src="../page.css"></style>
