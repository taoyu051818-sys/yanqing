<script setup lang="ts">
import AppIcon from './AppIcon.vue'

withDefaults(defineProps<{ title?: string; description?: string; icon?: string }>(), {
  title: '暂无数据',
  description: '新的内容会在这里出现',
  icon: 'sport',
})
</script>

<template>
  <view class="empty">
    <view class="empty-icon"><AppIcon :name="icon" :size="42" /></view>
    <text class="title">{{ title }}</text>
    <text class="muted">{{ description }}</text>
  </view>
</template>

<style scoped>
.empty { display: flex; flex-direction: column; align-items: center; padding: 72rpx 20rpx; }
.empty-icon { display: grid; place-items: center; width: 80rpx; height: 80rpx; margin-bottom: 18rpx; background: #e8f2eb; border-radius: 50%; }
.title { margin-bottom: 8rpx; font-weight: 700; }
.muted { max-width: 480rpx; text-align:center; overflow-wrap:anywhere; }
</style>
