<script setup lang="ts">
import { toRefs, computed } from "vue";
import StatusBadge from "../../../../../components/StatusBadge.vue";
import { money } from "../../../../../utils/format";

const props = defineProps<{
  activeProducts: any[];
  activeClasses: any[];
  products: any[];
  coachDisplayName: (coachId?: string, fallback?: string) => any;
  canConfigureTraining: boolean;
  actionKey: string;
  beginProductEdit: (product: any) => void;
  updateProduct: (product: any, enabled?: boolean) => Promise<void>;
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
const {
  activeProducts,
  activeClasses,
  products,
  coachDisplayName,
  canConfigureTraining,
  actionKey,
  beginProductEdit,
  updateProduct,
  editingProductId,
  cancelProductEdit,
  loading,
} = toRefs(props);
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
    <scroll-view v-if="products.length" scroll-x class="product-scroll">
      <view class="product-row">
        <view
          v-for="product in products"
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
            >{{ product.audience === "YOUTH" ? "青少年" : "成人" }} ·
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
          <view
            v-if="canConfigureTraining && editingProductId === product.id"
            class="product-edit"
            @tap.stop
          >
            <view
              ><text class="field-label">产品名称</text
              ><input
                v-model="editProductName"
                class="form-input"
                maxlength="100"
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
            <view
              ><text class="field-label">变更原因（必填）</text
              ><textarea
                v-model="editProductReason"
                class="reason-input"
                maxlength="300"
                placeholder="说明调价、课次或有效期变更依据"
              />
            </view>
            <view class="product-actions"
              ><button
                class="secondary inline"
                :disabled="Boolean(actionKey)"
                @tap="cancelProductEdit"
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
            >
          </view>
        </view>
      </view>
    </scroll-view>
    <view v-else-if="!loading" class="empty card"
      >暂无课程产品，管理员可在下方创建首个产品。</view
    >
  </view>
</template>

<style scoped src="../page.css"></style>
