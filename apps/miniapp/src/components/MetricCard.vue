<script setup lang="ts">
import AppIcon from './AppIcon.vue'

defineProps<{ label: string; value: string | number; note?: string; icon?: string }>()
</script>
<template>
  <view class="metric">
    <view class="metric-heading">
      <view v-if="icon" class="metric-icon"><AppIcon :name="icon" :size="30" /></view>
      <text class="label">{{ label }}</text>
    </view>
    <text class="value">{{ value }}</text>
    <text v-if="note" class="note">{{ note }}</text>
  </view>
</template>
<style scoped>
.metric { position:relative; min-width: 0; padding: 26rpx 24rpx 24rpx; overflow:hidden; background: #fff; border: 1rpx solid rgba(28,63,43,.09); border-radius: 24rpx; box-shadow:0 6rpx 20rpx rgba(26,56,38,.04); }
.metric::before { position:absolute; top:0; right:0; left:0; height:5rpx; background:linear-gradient(90deg,#17653d,#b68b22); content:''; }
.metric-heading { display:flex; align-items:center; min-width:0; gap:10rpx; }
.metric-icon { display:grid; flex:0 0 auto; place-items:center; width:46rpx; height:46rpx; background:#e7f4eb; border-radius:14rpx; }
.label,.note { display: block; color: #5f6f65; font-size: 23rpx; line-height:1.45; }
.label { min-width:0; overflow-wrap:anywhere; }
.value { display: block; margin: 13rpx 0 6rpx; overflow: hidden; color: #173f2a; font-size: 38rpx; font-weight: 850; line-height:1.25; text-overflow: ellipsis; }
</style>
