<script setup lang="ts">
defineProps<{ modelValue: string; items: { key: string; title: string; count?: number }[]; label?: string }>()
const emit = defineEmits<{ 'update:modelValue': [value: string] }>()
</script>
<template>
  <view class="operations-tabs" :aria-label="label || '业务分类'">
    <button v-for="item in items" :key="item.key" :class="{ selected: modelValue === item.key }" :aria-pressed="modelValue === item.key" @tap="emit('update:modelValue', item.key)">
      <text>{{ item.title }}</text><text v-if="item.count" class="count">{{ item.count }}</text>
    </button>
  </view>
</template>
<style scoped>
.operations-tabs { display:flex; flex-wrap:wrap; gap:8rpx; padding:8rpx; margin:0 0 24rpx; background:#e9edea; border-radius:20rpx; }
.operations-tabs button { flex:1 1 88rpx; min-width:44px; min-height:44px; margin:0; padding:16rpx 8rpx; gap:8rpx; background:transparent; border-radius:14rpx; color:#59645d; font-size:28rpx; font-weight:500; }
.operations-tabs button::after { border:0; }.operations-tabs .selected { background:#fff; color:#17653d; box-shadow:0 2rpx 6rpx rgba(25,45,32,.04); }
.count { font-size:24rpx; font-variant-numeric:tabular-nums; }
</style>
