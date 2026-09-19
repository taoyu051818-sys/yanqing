<script setup lang="ts">
defineProps<{ label: string; value?: string | number | null; link?: boolean }>()
defineEmits<{ select: [] }>()
</script>
<template>
  <view class="info-row" :class="{ 'is-link': link }" :role="link ? 'button' : undefined" :tabindex="link ? 0 : undefined" @tap="link && $emit('select')" @keyup.enter="link && $emit('select')">
    <text class="info-label">{{ label }}</text><view class="info-value"><slot>{{ value == null || value === '' ? '未填写' : value }}</slot></view><text v-if="link" class="info-arrow">›</text>
  </view>
</template>
<style scoped>
.info-row { display:flex; align-items:flex-start; gap:24rpx; min-height:104rpx; box-sizing:border-box; padding:30rpx 24rpx; font-size:29rpx; line-height:1.6; border-bottom:1rpx solid #edf0f2; }
.info-row:last-child { border-bottom:0; }
.info-label { flex:0 0 auto; max-width:40%; color:var(--ops-text,#20252b); }
.info-value { flex:1; min-width:0; text-align:right; overflow-wrap:anywhere; color:var(--ops-muted,#687079); }
.info-arrow { color:#939aa1; }
.is-link:active { background:#f5f7f7; }
</style>
