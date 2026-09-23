<script setup lang="ts">
import { trainingAudienceLabel } from "@yanqing/shared";
import type { TrainingProductView } from "@yanqing/shared";

import { toRefs, computed, ref } from "vue";
import StatusBadge from "../../../../../components/StatusBadge.vue";
import { money } from "../../../../../utils/format";

const props = defineProps<{
  activeProducts: TrainingProductView[];
  activeClasses: any[];
  products: TrainingProductView[];
  coachDisplayName: (coachId?: string | null, fallback?: string) => any;
  canConfigureTraining: boolean;
  actionKey: string;
  beginProductEdit: (product: TrainingProductView) => void;
  updateProduct: (
    product: TrainingProductView,
    enabled?: boolean,
  ) => Promise<void>;
  loading: boolean;
}>();
const {
  activeProducts,
  activeClasses,
  products,
  coachDisplayName,
  canConfigureTraining,
  actionKey,
  beginProductEdit,
  updateProduct,
  loading,
} = toRefs(props);
const keyword = ref("");
const status = ref("ACTIVE");
const shownProducts = computed(() =>
  props.products.filter(
    (product) =>
      (status.value === "ALL" ||
        (product.enabled !== false) === (status.value === "ACTIVE")) &&
      product.name.toLowerCase().includes(keyword.value.trim().toLowerCase()),
  ),
);
</script>

<template>
  <view>
    <view id="training-product-management" class="section-title"
      >课程产品与班级
      <text class="section-note"
        >{{ activeProducts.length }} 个在售 ·
        {{ activeClasses.length }} 个有效班</text
      ></view
    >
    <input
      v-model="keyword"
      class="form-input"
      placeholder="搜索课程名称"
      aria-label="搜索课程"
    />
    <view class="status-filters"
      ><button
        v-for="option in [
          { value: 'ACTIVE', label: '在售' },
          { value: 'DISABLED', label: '已停用' },
          { value: 'ALL', label: '全部' },
        ]"
        :key="option.value"
        :class="{ selected: status === option.value }"
        :aria-pressed="status === option.value"
        @tap="status = option.value"
      >
        {{ option.label }}
      </button></view
    >
    <view v-if="shownProducts.length">
      <view class="product-row">
        <view
          v-for="product in shownProducts"
          :key="product.id"
          class="card product-card"
          :class="{ 'product-disabled': product.enabled === false }"
        >
          <view class="row"
            ><text class="product-name">{{ product.name }}</text
            ><StatusBadge
              :value="product.enabled === false ? 'DISABLED' : 'ACTIVE'"
          /></view>
          <text class="muted"
            >{{ trainingAudienceLabel(product.audience) }} ·
            {{ product.totalSessions }} 课次 · 有效
            {{ product.validityDays }} 天</text
          >
          <text class="product-price">{{ money(product.priceCents) }}</text>
          <view v-if="product.classes?.length" class="class-summary">
            <view
              v-for="trainingClass in product.classes"
              :key="trainingClass.id"
              class="class-summary-row"
            >
              <view
                ><text class="class-name">{{ trainingClass.name }}</text
                ><text class="muted"
                  >容量 {{ trainingClass.capacity }} 人 ·
                  {{
                    coachDisplayName(trainingClass.coachId, "待分配教练")
                  }}</text
                ></view
              >
              <StatusBadge
                :value="trainingClass.active === false ? 'DISABLED' : 'ACTIVE'"
              />
            </view>
          </view>
          <text v-else class="muted class-empty">尚未创建班级</text>
          <view v-if="canConfigureTraining" class="product-actions">
            <button
              class="secondary inline"
              :disabled="Boolean(actionKey)"
              @tap="beginProductEdit(product)"
            >
              编辑设置
            </button>
            <button
              :class="
                product.enabled === false ? 'secondary inline' : 'danger inline'
              "
              :disabled="Boolean(actionKey)"
              @tap="updateProduct(product, product.enabled === false)"
            >
              {{ product.enabled === false ? "重新启用" : "停止销售" }}
            </button>
          </view>
        </view>
      </view>
    </view>
    <view v-else-if="!loading" class="empty card"
      >没有符合条件的课程，可调整搜索或新增课程。</view
    >
  </view>
</template>

<style scoped src="../page.css"></style>

<style scoped>
.product-row {
  display: flex;
  flex-direction: column;
  gap: 20rpx;
}
.product-card {
  flex: 0 0 auto;
  width: 100%;
  min-width: 0;
  box-sizing: border-box;
  margin: 0;
}
.status-filters {
  display: flex;
  gap: 12rpx;
  margin: 16rpx 0 24rpx;
}
.status-filters button {
  flex: 1;
  min-height: 44px;
  font-size: 28rpx;
  margin: 0;
  background: var(--color-surface);
}
.status-filters .selected {
  background: var(--color-primary);
  color: #fff;
}
</style>
