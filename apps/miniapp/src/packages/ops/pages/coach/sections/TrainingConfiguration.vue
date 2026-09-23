<script setup lang="ts">
import type { TrainingProductView } from "@yanqing/shared";

import { toRefs, computed, watch, ref, nextTick } from "vue";
import { useUnsavedForm } from "../../../composables/use-unsaved-form";

const showProductNote = ref(false);
const showClassAdvanced = ref(false);
const focusField = ref('');
const props = defineProps<{
  formType: "product" | "class";
  errorMessage?: string;
  errorField?: string;
  canConfigureTraining: boolean;
  productCode: string;
  productName: string;
  audienceOptions: { label: string; value: string }[];
  productAudienceIndex: number;
  productTotalSessions: string;
  productValidityDays: string;
  productPriceYuan: string;
  productReason: string;
  actionKey: string;
  loading: boolean;
  createProduct: () => Promise<void>;
  activeProducts: TrainingProductView[];
  classProductIndex: number;
  selectedClassProduct: any;
  classCode: string;
  className: string;
  weekdayOptions: string[];
  classWeekdayIndex: number;
  classStartTime: string;
  classEndTime: string;
  classCapacity: string;
  coachOptions: any[];
  changeClassCoach: (event: any) => void;
  coachDisplayName: (coachId?: string, fallback?: string) => any;
  classCoachId: string;
  changeClassAssistant: (event: any) => void;
  classAssistantId: string;
  classCoachCostYuan: string;
  classAssistantCostYuan: string;
  classMaterialCostYuan: string;
  classReason: string;
  createClass: () => Promise<void>;
}>();
const emit = defineEmits<{
  (event: "clear-error"): void;
  (event: "update:productCode", value: string): void;
  (event: "update:productName", value: string): void;
  (event: "update:productAudienceIndex", value: number): void;
  (event: "update:productTotalSessions", value: string): void;
  (event: "update:productValidityDays", value: string): void;
  (event: "update:productPriceYuan", value: string): void;
  (event: "update:productReason", value: string): void;
  (event: "update:classProductIndex", value: number): void;
  (event: "update:classCode", value: string): void;
  (event: "update:className", value: string): void;
  (event: "update:classWeekdayIndex", value: number): void;
  (event: "update:classStartTime", value: string): void;
  (event: "update:classEndTime", value: string): void;
  (event: "update:classCapacity", value: string): void;
  (event: "update:classCoachCostYuan", value: string): void;
  (event: "update:classAssistantCostYuan", value: string): void;
  (event: "update:classMaterialCostYuan", value: string): void;
  (event: "update:classReason", value: string): void;
}>();
const {
  canConfigureTraining,
  audienceOptions,
  actionKey,
  loading,
  createProduct,
  activeProducts,
  selectedClassProduct,
  weekdayOptions,
  coachOptions,
  changeClassCoach,
  coachDisplayName,
  classCoachId,
  changeClassAssistant,
  classAssistantId,
  createClass,
} = toRefs(props);
const productCode = computed({
  get: () => props.productCode,
  set: (value) => emit("update:productCode", value),
});
const productName = computed({
  get: () => props.productName,
  set: (value) => emit("update:productName", value),
});
const productAudienceIndex = computed({
  get: () => props.productAudienceIndex,
  set: (value) => emit("update:productAudienceIndex", value),
});
const productTotalSessions = computed({
  get: () => props.productTotalSessions,
  set: (value) => emit("update:productTotalSessions", value),
});
const productValidityDays = computed({
  get: () => props.productValidityDays,
  set: (value) => emit("update:productValidityDays", value),
});
const productPriceYuan = computed({
  get: () => props.productPriceYuan,
  set: (value) => emit("update:productPriceYuan", value),
});
const productReason = computed({
  get: () => props.productReason,
  set: (value) => emit("update:productReason", value),
});
const classProductIndex = computed({
  get: () => props.classProductIndex,
  set: (value) => emit("update:classProductIndex", value),
});
const classCode = computed({
  get: () => props.classCode,
  set: (value) => emit("update:classCode", value),
});
const className = computed({
  get: () => props.className,
  set: (value) => emit("update:className", value),
});
const classWeekdayIndex = computed({
  get: () => props.classWeekdayIndex,
  set: (value) => emit("update:classWeekdayIndex", value),
});
const classStartTime = computed({
  get: () => props.classStartTime,
  set: (value) => emit("update:classStartTime", value),
});
const classEndTime = computed({
  get: () => props.classEndTime,
  set: (value) => emit("update:classEndTime", value),
});
const classCapacity = computed({
  get: () => props.classCapacity,
  set: (value) => emit("update:classCapacity", value),
});
const classCoachCostYuan = computed({
  get: () => props.classCoachCostYuan,
  set: (value) => emit("update:classCoachCostYuan", value),
});
const classAssistantCostYuan = computed({
  get: () => props.classAssistantCostYuan,
  set: (value) => emit("update:classAssistantCostYuan", value),
});
const classMaterialCostYuan = computed({
  get: () => props.classMaterialCostYuan,
  set: (value) => emit("update:classMaterialCostYuan", value),
});
const classReason = computed({
  get: () => props.classReason,
  set: (value) => emit("update:classReason", value),
});
const { markSaved } = useUnsavedForm(() =>
  props.formType === "product"
    ? [
        props.productCode,
        props.productName,
        props.productTotalSessions,
        props.productValidityDays,
        props.productPriceYuan,
        props.productReason,
        props.productAudienceIndex,
      ]
    : [
        props.classCode,
        props.className,
        props.classProductIndex,
        props.classWeekdayIndex,
        props.classStartTime,
        props.classEndTime,
        props.classCapacity,
        props.classCoachId,
        props.classAssistantId,
        props.classCoachCostYuan,
        props.classAssistantCostYuan,
        props.classMaterialCostYuan,
        props.classReason,
      ],
);
watch(
  () => props.actionKey,
  (key, previous) => {
    if (previous === `create-${props.formType}` && !key && !props.errorMessage)
      markSaved();
  },
);
watch(() => props.errorField, async field => {
  if (!field) return;
  if (field === 'productReason') showProductNote.value = true;
  if (['classAssistantCostYuan', 'classCoachCostYuan', 'classMaterialCostYuan', 'classReason'].includes(field)) showClassAdvanced.value = true;
  focusField.value = '';
  await nextTick();
  focusField.value = field;
  uni.pageScrollTo({ selector: '#training-' + field, duration: 200 });
});
function changed() { emit('clear-error'); }
</script>

<template>
  <view class="configuration-page">
    <template v-if="canConfigureTraining">
      <template v-if="formType === 'product'">
        <view class="section-title"
          >创建课程产品 <text class="section-note">仅管理员</text></view
        >
        <view class="card creation-form">
          <view
            ><text class="field-label">课程名称</text
            ><input id="training-productName" :focus="focusField === 'productName'" :aria-invalid="errorField === 'productName'" @input="changed" @blur="focusField = ''"
              v-model="productName"
              class="form-input"
              maxlength="100"
              placeholder="例如 成人进阶课包"
          /><text v-if="errorField === 'productName'" class="field-error" role="alert">{{ errorMessage }}</text></view>
          <view
            ><text class="field-label">适用人群</text
            ><view class="audience-options"
              ><button
                v-for="(option, index) in audienceOptions"
                :key="option.value"
                :class="{ selected: productAudienceIndex === index }"
                :aria-pressed="productAudienceIndex === index"
                @tap="productAudienceIndex = index"
              >
                {{ option.label }}
              </button></view
            ></view
          >
          <view class="form-grid">
            <view
              ><text class="field-label">总课次</text
              ><input id="training-productTotalSessions" :focus="focusField === 'productTotalSessions'" :aria-invalid="errorField === 'productTotalSessions'" @input="changed" @blur="focusField = ''"
                v-model="productTotalSessions"
                class="form-input"
                type="number"
            /><text v-if="errorField === 'productTotalSessions'" class="field-error" role="alert">{{ errorMessage }}</text></view>
            <view
              ><text class="field-label">有效期（天）</text
              ><input id="training-productValidityDays" :focus="focusField === 'productValidityDays'" :aria-invalid="errorField === 'productValidityDays'" @input="changed" @blur="focusField = ''"
                v-model="productValidityDays"
                class="form-input"
                type="number"
            /><text v-if="errorField === 'productValidityDays'" class="field-error" role="alert">{{ errorMessage }}</text></view>
          </view>
          <view>
            <view
              ><text class="field-label">售价（元）</text
              ><input id="training-productPriceYuan" :focus="focusField === 'productPriceYuan'" :aria-invalid="errorField === 'productPriceYuan'" @input="changed" @blur="focusField = ''"
                v-model="productPriceYuan"
                class="form-input"
                type="digit"
            /><text v-if="errorField === 'productPriceYuan'" class="field-error" role="alert">{{ errorMessage }}</text></view>
          </view>
          <button class="note-toggle" @tap="showProductNote = !showProductNote">
            {{ showProductNote ? "收起备注" : "添加备注（选填）" }}
          </button>
          <view v-if="showProductNote"
            ><text class="field-label">备注（选填）</text
            ><textarea id="training-productReason" :focus="focusField === 'productReason'" :aria-invalid="errorField === 'productReason'" @input="changed" @blur="focusField = ''"
              v-model="productReason"
              class="reason-input"
              maxlength="300"
              placeholder="如需补充课程说明，可在此填写"
            /><text v-if="errorField === 'productReason'" class="field-error" role="alert">{{ errorMessage }}</text>
          </view>
          <text class="guardrail"
            >课程编码自动生成。退费规则：开课前全退，开课后按未消耗课次退款。</text
          >
          <view class="save-bar"
            ><text v-if="errorMessage && !errorField" class="field-error" role="alert">{{
              errorMessage
            }}</text
            ><button
              class="primary full-button"
              :loading="actionKey === 'create-product'"
              :disabled="loading || Boolean(actionKey)"
              @tap="createProduct"
            >
              创建并上架
            </button></view
          >
        </view>
      </template>
      <template v-else>
        <view class="section-title"
          >创建培训班级 <text class="section-note">仅管理员</text></view
        >
        <view class="card creation-form">
          <picker
            :range="activeProducts"
            range-key="name"
            :value="classProductIndex"
            @change="classProductIndex = Number(($event.detail as any).value)"
            ><view
              ><text class="field-label">所属产品</text
              ><view class="picker-value"
                >{{ selectedClassProduct?.name || "请先创建产品" }} ›</view
              ></view
            ></picker
          >
          <view>
            <view
              ><text class="field-label">班级名称</text
              ><input id="training-className" :focus="focusField === 'className'" :aria-invalid="errorField === 'className'" @input="changed" @blur="focusField = ''"
                v-model="className"
                class="form-input"
                maxlength="100"
                placeholder="例如 周三晚进阶班"
            /><text v-if="errorField === 'className'" class="field-error" role="alert">{{ errorMessage }}</text></view>
          </view>
          <view class="form-grid three-columns">
            <picker class="form-grid-lead"
              :range="weekdayOptions"
              :value="classWeekdayIndex"
              @change="classWeekdayIndex = Number(($event.detail as any).value)"
              ><view
                ><text class="field-label">常规星期</text
                ><view class="picker-value"
                  >{{ weekdayOptions[classWeekdayIndex] }} ›</view
                ></view
              ></picker
            >
            <picker
              mode="time"
              :value="classStartTime"
              @change="classStartTime = ($event.detail as any).value"
              ><view
                ><text class="field-label">开始</text
                ><view class="picker-value">{{ classStartTime }} ›</view></view
              ></picker
            >
            <picker
              id="training-classEndTime"
              mode="time"
              :value="classEndTime"
              @change="classEndTime = ($event.detail as any).value; changed()"
              ><view
                ><text class="field-label">结束</text
                ><view class="picker-value">{{ classEndTime }} ›</view><text v-if="errorField === 'classEndTime'" class="field-error" role="alert">{{ errorMessage }}</text></view
              ></picker
            >
          </view>
          <view class="form-grid">
            <view
              ><text class="field-label">容量（人）</text
              ><input id="training-classCapacity" :focus="focusField === 'classCapacity'" :aria-invalid="errorField === 'classCapacity'" @input="changed" @blur="focusField = ''" v-model="classCapacity" class="form-input" type="number"
            /><text v-if="errorField === 'classCapacity'" class="field-error" role="alert">{{ errorMessage }}</text></view>
            <picker
              :range="coachOptions"
              range-key="displayName"
              @change="changeClassCoach"
              ><view
                ><text class="field-label">主教练（选填）</text
                ><view class="picker-value"
                  >{{ coachDisplayName(classCoachId, "暂不指定") }} ›</view
                ></view
              ></picker
            >
          </view>
          <button class="note-toggle" :aria-expanded="showClassAdvanced" @tap="showClassAdvanced = !showClassAdvanced">{{ showClassAdvanced ? '收起成本与其他设置' : '成本与其他设置' }} ›</button>
          <text v-if="!showClassAdvanced" class="guardrail">每课成本：教练 {{ classCoachCostYuan }} 元 · 助教 {{ classAssistantCostYuan }} 元 · 物料 {{ classMaterialCostYuan }} 元</text>
          <view v-if="showClassAdvanced">
          <picker
            :range="coachOptions"
            range-key="displayName"
            @change="changeClassAssistant"
            ><view
              ><text class="field-label">助教（选填）</text
              ><view class="picker-value"
                >{{ coachDisplayName(classAssistantId, "暂不指定") }} ›</view
              ></view
            ></picker
          >
          <view class="form-grid three-columns">
            <view class="form-grid-lead"
              ><text class="field-label">教练成本/课（元）</text
              ><input id="training-classCoachCostYuan" :focus="focusField === 'classCoachCostYuan'" :aria-invalid="errorField === 'classCoachCostYuan'" @input="changed" @blur="focusField = ''"
                v-model="classCoachCostYuan"
                class="form-input"
                type="digit"
            /><text v-if="errorField === 'classCoachCostYuan'" class="field-error" role="alert">{{ errorMessage }}</text></view>
            <view
              ><text class="field-label">助教成本/课（元）</text
              ><input id="training-classAssistantCostYuan" :focus="focusField === 'classAssistantCostYuan'" :aria-invalid="errorField === 'classAssistantCostYuan'" @input="changed" @blur="focusField = ''"
                v-model="classAssistantCostYuan"
                class="form-input"
                type="digit"
            /><text v-if="errorField === 'classAssistantCostYuan'" class="field-error" role="alert">{{ errorMessage }}</text></view>
            <view
              ><text class="field-label">物料成本/课（元）</text
              ><input id="training-classMaterialCostYuan" :focus="focusField === 'classMaterialCostYuan'" :aria-invalid="errorField === 'classMaterialCostYuan'" @input="changed" @blur="focusField = ''"
                v-model="classMaterialCostYuan"
                class="form-input"
                type="digit"
            /><text v-if="errorField === 'classMaterialCostYuan'" class="field-error" role="alert">{{ errorMessage }}</text></view>
          </view>
          <view
            ><text class="field-label">备注（选填）</text
            ><textarea id="training-classReason" :focus="focusField === 'classReason'" :aria-invalid="errorField === 'classReason'" @input="changed" @blur="focusField = ''"
              v-model="classReason"
              class="reason-input"
              maxlength="300"
              placeholder="如需补充开班说明，可在此填写"
            /><text v-if="errorField === 'classReason'" class="field-error" role="alert">{{ errorMessage }}</text>
          </view>
          </view>
          <text class="guardrail">班级编码自动生成。</text>
          <view class="save-bar"
            ><text v-if="errorMessage && !errorField" class="field-error" role="alert">{{
              errorMessage
            }}</text
            ><button
              class="primary full-button"
              :loading="actionKey === 'create-class'"
              :disabled="loading || Boolean(actionKey) || !selectedClassProduct"
              @tap="createClass"
            >
              创建培训班级
            </button></view
          >
        </view>
      </template>
    </template>
  </view>
</template>

<style scoped src="../page.css"></style>

<style scoped>
.audience-options {
  display: flex;
  gap: 12rpx;
  margin-bottom: 20rpx;
}
.audience-options button {
  flex: 1;
  min-width: 0;
  min-height: 48px;
  margin: 0;
  font-size: 28rpx;
  background: var(--color-surface-subtle);
  color: var(--color-muted);
  padding: 16rpx 8rpx;
  line-height: 1.6;
}
.audience-options .selected {
  background: var(--color-primary);
  color: #fff;
}
.note-toggle {
  background: transparent;
  color: var(--color-primary);
  text-align: left;
  margin: 12rpx 0;
  font-size: 26rpx;
  min-height: 44px;
  padding: 0;
}

.configuration-page {
  padding-bottom: calc(190rpx + env(safe-area-inset-bottom));
}
.save-bar {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  z-index: 25;
  padding: 20rpx 28rpx calc(20rpx + env(safe-area-inset-bottom));
  background: #fff;
  border-top: 1rpx solid #e2e7e3;
}
.save-bar button {
  width: 100%;
  margin: 0;
}
.field-error {
  display: block;
  color: #a52626;
  font-size: 26rpx;
  margin-bottom: 12rpx;
}
</style>

<style scoped>
.creation-form .form-grid.three-columns { grid-template-columns:repeat(2, minmax(0, 1fr)); }
.creation-form .form-grid.three-columns > .form-grid-lead { grid-column:1 / -1; }
.creation-form .form-input, .creation-form .picker-value, .creation-form .field-label { font-size:15px; font-size:max(28rpx, 15px); }
.creation-form .field-error { display:block; margin:8rpx 0 16rpx; color:#a52626; font-size:14px; }
</style>
