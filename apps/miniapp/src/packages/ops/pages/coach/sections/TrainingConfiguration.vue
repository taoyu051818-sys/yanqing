<script setup lang="ts">
import type { TrainingProductView } from "@yanqing/shared";

import { toRefs, computed } from "vue";

const props = defineProps<{
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
</script>

<template>
  <view>
    <template v-if="canConfigureTraining">
      <view class="section-title"
        >创建课程产品 <text class="section-note">仅管理员</text></view
      >
      <view class="card creation-form">
        <view class="form-grid">
          <view
            ><text class="field-label">产品编码</text
            ><input
              v-model="productCode"
              class="form-input"
              maxlength="40"
              placeholder="例如 ADULT-ADV-01"
          /></view>
          <view
            ><text class="field-label">产品名称</text
            ><input
              v-model="productName"
              class="form-input"
              maxlength="100"
              placeholder="例如 成人进阶课包"
          /></view>
        </view>
        <view class="form-grid">
          <picker
            :range="audienceOptions"
            range-key="label"
            :value="productAudienceIndex"
            @change="
              productAudienceIndex = Number(($event.detail as any).value)
            "
            ><view
              ><text class="field-label">适用人群</text
              ><view class="picker-value"
                >{{ audienceOptions[productAudienceIndex].label }} ›</view
              ></view
            ></picker
          >
          <view
            ><text class="field-label">总课次</text
            ><input
              v-model="productTotalSessions"
              class="form-input"
              type="number"
          /></view>
        </view>
        <view class="form-grid">
          <view
            ><text class="field-label">有效期（天）</text
            ><input
              v-model="productValidityDays"
              class="form-input"
              type="number"
          /></view>
          <view
            ><text class="field-label">售价（元）</text
            ><input v-model="productPriceYuan" class="form-input" type="digit"
          /></view>
        </view>
        <view
          ><text class="field-label">创建原因（必填）</text
          ><textarea
            v-model="productReason"
            class="reason-input"
            maxlength="300"
            placeholder="说明定价、课次与适用人群依据"
          />
        </view>
        <text class="guardrail"
          >退费规则固定为开课前全退、开课后按未消耗课次退款。提交会生成持久幂等键，网络失败后原命令重试不会重复创建。</text
        >
        <button
          class="primary full-button"
          :loading="actionKey === 'create-product'"
          :disabled="loading || Boolean(actionKey)"
          @tap="createProduct"
        >
          创建课程产品
        </button>
      </view>

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
        <view class="form-grid">
          <view
            ><text class="field-label">班级编码</text
            ><input
              v-model="classCode"
              class="form-input"
              maxlength="40"
              placeholder="例如 CLASS-WED-01"
          /></view>
          <view
            ><text class="field-label">班级名称</text
            ><input
              v-model="className"
              class="form-input"
              maxlength="100"
              placeholder="例如 周三晚进阶班"
          /></view>
        </view>
        <view class="form-grid three-columns">
          <picker
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
            mode="time"
            :value="classEndTime"
            @change="classEndTime = ($event.detail as any).value"
            ><view
              ><text class="field-label">结束</text
              ><view class="picker-value">{{ classEndTime }} ›</view></view
            ></picker
          >
        </view>
        <view class="form-grid">
          <view
            ><text class="field-label">容量（人）</text
            ><input v-model="classCapacity" class="form-input" type="number"
          /></view>
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
          <view
            ><text class="field-label">教练成本/课（元）</text
            ><input
              v-model="classCoachCostYuan"
              class="form-input"
              type="digit"
          /></view>
          <view
            ><text class="field-label">助教成本/课（元）</text
            ><input
              v-model="classAssistantCostYuan"
              class="form-input"
              type="digit"
          /></view>
          <view
            ><text class="field-label">物料成本/课（元）</text
            ><input
              v-model="classMaterialCostYuan"
              class="form-input"
              type="digit"
          /></view>
        </view>
        <view
          ><text class="field-label">创建原因（必填）</text
          ><textarea
            v-model="classReason"
            class="reason-input"
            maxlength="300"
            placeholder="说明开班、人员与成本依据"
          />
        </view>
        <button
          class="primary full-button"
          :loading="actionKey === 'create-class'"
          :disabled="loading || Boolean(actionKey) || !selectedClassProduct"
          @tap="createClass"
        >
          创建培训班级
        </button>
      </view>
    </template>
  </view>
</template>

<style scoped src="../page.css"></style>
