<script setup lang="ts">
import type { TrainingProductView } from "@yanqing/shared";

import { toRefs, computed, watch, ref } from "vue";
import { useUnsavedForm } from "../../../composables/use-unsaved-form";

const showNote = ref(false);
const props = defineProps<{
  product?: TrainingProductView;
  errorMessage: string;
  actionKey: string;
  updateProduct: (
    product: TrainingProductView,
    enabled?: boolean,
  ) => Promise<void>;
  editingProductId: string;
  editProductName: string;
  editProductTotalSessions: string;
  editProductValidityDays: string;
  editProductPriceYuan: string;
  editProductReason: string;
  cancelProductEdit: () => void;
  loading: boolean;
}>();
const emit = defineEmits<{
  (event: "update:editProductName", value: string): void;
  (event: "update:editProductTotalSessions", value: string): void;
  (event: "update:editProductValidityDays", value: string): void;
  (event: "update:editProductPriceYuan", value: string): void;
  (event: "update:editProductReason", value: string): void;
}>();
const { actionKey, updateProduct } = toRefs(props);
const editProductName = computed({
  get: () => props.editProductName,
  set: (value) => emit("update:editProductName", value),
});
const editProductTotalSessions = computed({
  get: () => props.editProductTotalSessions,
  set: (value) => emit("update:editProductTotalSessions", value),
});
const editProductValidityDays = computed({
  get: () => props.editProductValidityDays,
  set: (value) => emit("update:editProductValidityDays", value),
});
const editProductPriceYuan = computed({
  get: () => props.editProductPriceYuan,
  set: (value) => emit("update:editProductPriceYuan", value),
});
const editProductReason = computed({
  get: () => props.editProductReason,
  set: (value) => emit("update:editProductReason", value),
});

const { dirty, markSaved } = useUnsavedForm(() => [
  props.editProductName,
  props.editProductTotalSessions,
  props.editProductValidityDays,
  props.editProductPriceYuan,
  props.editProductReason,
]);
watch(
  () => props.product?.id,
  () => markSaved(),
  { flush: "post" },
);
watch(
  () => props.editingProductId,
  (id, previous) => {
    if (previous && !id) {
      markSaved();
      uni.navigateBack();
    }
  },
);
async function cancel() {
  if (
    dirty.value &&
    !(
      await uni.showModal({
        title: "放弃修改？",
        content: "未保存的课程设置将丢失。",
        confirmText: "放弃修改",
      })
    ).confirm
  )
    return;
  markSaved();
  props.cancelProductEdit();
}
</script>
<template>
  <view class="editor-page"
    ><view class="card"
      ><text class="editor-title">{{ product?.name || "正在加载课程" }}</text
      ><text class="muted">修改仅影响后续购买，已购课包按原合同执行。</text>
      <view v-if="product" class="product-edit" @tap.stop>
        <view
          ><text class="field-label">产品名称</text
          ><input v-model="editProductName" class="form-input" maxlength="100"
        /></view>
        <view class="form-grid"
          ><view
            ><text class="field-label">总课次</text
            ><input
              v-model="editProductTotalSessions"
              class="form-input"
              type="number" /></view
          ><view
            ><text class="field-label">有效期（天）</text
            ><input
              v-model="editProductValidityDays"
              class="form-input"
              type="number" /></view
        ></view>
        <view
          ><text class="field-label">售价（元）</text
          ><input
            v-model="editProductPriceYuan"
            class="form-input"
            type="digit"
        /></view>
        <button class="note-toggle" @tap="showNote = !showNote">
          {{ showNote ? "收起备注" : "添加备注（选填）" }}
        </button>
        <view v-if="showNote"
          ><text class="field-label">备注（选填）</text
          ><textarea
            v-model="editProductReason"
            class="reason-input"
            maxlength="300"
            placeholder="说明调价、课次或有效期变更依据"
          />
        </view>
        <view class="product-save"
          ><button
            class="secondary inline"
            :disabled="Boolean(actionKey)"
            @tap="cancel"
          >
            取消</button
          ><button
            class="primary inline"
            :loading="actionKey === `product-update:${product.id}`"
            :disabled="Boolean(actionKey)"
            @tap="updateProduct(product, product.enabled !== false)"
          >
            保存设置
          </button></view
        > </view
      ><text v-if="errorMessage" class="form-error" role="alert">{{
        errorMessage
      }}</text></view
    ></view
  >
</template>
<style scoped src="../page.css"></style>
<style scoped>
.editor-title {
  display: block;
  font-size: 30rpx;
  font-weight: 700;
  margin-bottom: 12rpx;
}
.editor-page .muted {
  display: block;
}
.note-toggle {
  min-height: 44px;
  width: 100%;
  margin-top: 20rpx;
  font-size: 26rpx;
  color: var(--color-primary);
  background: transparent;
}

.editor-page {
  padding-bottom: calc(150rpx + env(safe-area-inset-bottom));
}
.product-save {
  position: fixed;
  z-index: 25;
  bottom: 0;
  left: 0;
  right: 0;
  display: flex;
  gap: 16rpx;
  background: var(--color-surface);
  padding: 20rpx 28rpx calc(20rpx + env(safe-area-inset-bottom));
  border-top: 1rpx solid var(--color-border);
}
.product-save button {
  flex: 1;
  min-height: 48px;
  margin: 0;
}
.form-error {
  display: block;
  color: var(--color-danger);
  margin-top: 20rpx;
}
</style>
