<script setup lang="ts">
import { today } from '../../../utils/format';
defineProps<{ modelValue?: string; disabled?: boolean }>();
const emit = defineEmits<{ (event: 'update:modelValue', value: string): void }>();
</script>
<template>
  <view class="optional-date">
    <picker mode="date" :value="modelValue || today()" :disabled="disabled" @change="emit('update:modelValue', ($event.detail as any).value)">
      <view class="date-choice">{{ modelValue || '无有效期' }}<text>选择日期 ›</text></view>
    </picker>
    <button v-if="modelValue" :disabled="disabled" aria-label="清除有效期" @tap="emit('update:modelValue', '')">清除</button>
  </view>
</template>
<style scoped>
.optional-date { display:flex; align-items:center; gap:12rpx; margin-bottom:16rpx; }
.optional-date picker { flex:1; min-width:0; }
.date-choice { display:flex; align-items:center; justify-content:space-between; gap:16rpx; min-height:48px; box-sizing:border-box; padding:0 20rpx; border:1px solid #dce2dd; border-radius:12rpx; font-size:15px; }
.date-choice text { color:#17653d; font-size:14px; }
.optional-date button { padding:0 16rpx; margin:0; min-height:44px; font-size:14px; color:#17653d; background:transparent; }
</style>
