<script setup lang="ts">
import { computed, ref } from 'vue';
const props = defineProps<{ from: string; to: string; disabled?: boolean }>();
const emit = defineEmits<{ (event:'update:from', value:string):void; (event:'update:to', value:string):void }>();
const lastEnd = ref('');
const longTerm = computed(() => !props.to || props.to === '2099-01-01');
function toggle(value: boolean) {
  if (value) { if (!longTerm.value) lastEnd.value = props.to; emit('update:to', '2099-01-01'); }
  else emit('update:to', lastEnd.value || props.from);
}
</script>
<template>
  <view class="sales-dates">
    <text class="caption">开始销售日期</text>
    <picker mode="date" :value="from" :disabled="disabled" @change="emit('update:from', ($event.detail as any).value)"><view class="date-choice">{{ from }}<text>选择 ›</text></view></picker>
    <view class="long-term"><text>长期销售</text><switch :checked="longTerm" :disabled="disabled" color="#17653d" @change="toggle(($event as any).detail.value)" /></view>
    <template v-if="!longTerm"><text class="caption">停止销售日期（当天起停止）</text><picker mode="date" :value="to" :start="from" :disabled="disabled" @change="emit('update:to', ($event.detail as any).value)"><view class="date-choice">{{ to }}<text>选择 ›</text></view></picker></template>
  </view>
</template>
<style scoped>
.sales-dates { display:flex; flex-direction:column; gap:12rpx; margin:24rpx 0; font-size:15px; }
.caption { font-weight:600; }
.date-choice, .long-term { display:flex; align-items:center; justify-content:space-between; gap:16rpx; min-height:48px; }
.date-choice { padding:0 20rpx; background:#f5f7f5; border-radius:12rpx; }
.date-choice > text { color:#17653d; }
</style>
