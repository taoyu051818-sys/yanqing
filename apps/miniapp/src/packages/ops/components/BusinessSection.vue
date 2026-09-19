<script setup lang="ts">
defineProps<{ title: string; action?: string; disabled?: boolean }>()
defineEmits<{ action: [] }>()
</script>
<template>
  <view class="business-section">
    <view class="group-heading"><text>{{ title }}</text><button v-if="action" :disabled="disabled" @tap="$emit('action')">{{ action }}</button></view>
    <view class="group-body"><slot /></view>
  </view>
</template>
<style scoped>
.business-section { margin-bottom:28rpx; }
.group-heading { display:flex; align-items:center; justify-content:space-between; gap:20rpx; min-height:88rpx; padding:0 20rpx; color:var(--ops-muted,#727982); font-size:26rpx; }
.group-heading button { margin:0; padding:0 4rpx; min-height:88rpx; display:flex; align-items:center; background:transparent; color:var(--ops-accent,#17653d); font-size:26rpx; line-height:1.4; }
.group-heading button::after { border:0; }
.group-body { background:#fff; border-radius:18rpx; overflow:hidden; }
</style>
