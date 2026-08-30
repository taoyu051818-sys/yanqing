<script setup lang="ts">
withDefaults(defineProps<{ title?: string; description?: string }>(), {
  title: '暂无数据',
  description: '新的内容会在这里出现',
})
</script>

<template>
  <view class="empty">
    <view class="ball">羽</view>
    <text class="title">{{ title }}</text>
    <text class="muted">{{ description }}</text>
  </view>
</template>

<style scoped>
.empty { display: flex; flex-direction: column; align-items: center; padding: 72rpx 20rpx; }
.ball { display: grid; place-items: center; width: 80rpx; height: 80rpx; margin-bottom: 18rpx; color: #17653d; background: #e8f2eb; border-radius: 50%; font-weight: 800; }
.title { margin-bottom: 8rpx; font-weight: 700; }
</style>
