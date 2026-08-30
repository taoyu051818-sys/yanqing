<script setup lang="ts">defineProps<{ label: string; value: string | number; note?: string }>()</script>
<template>
  <view class="metric">
    <text class="label">{{ label }}</text>
    <text class="value">{{ value }}</text>
    <text v-if="note" class="note">{{ note }}</text>
  </view>
</template>
<style scoped>
.metric { min-width: 0; padding: 24rpx; background: #fff; border-radius: 24rpx; border: 1rpx solid rgba(28,63,43,.08); }
.label,.note { display: block; color: #758079; font-size: 23rpx; }
.value { display: block; margin: 12rpx 0 6rpx; overflow: hidden; color: #173f2a; font-size: 38rpx; font-weight: 800; text-overflow: ellipsis; }
</style>
