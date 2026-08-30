<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  title: string
  eyebrow: string
  description: string
  role: string
  venue?: string
  shift?: string
}>()

const businessDate = computed(() => {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
})
</script>

<template>
  <view class="ops-page safe-bottom">
    <view class="ops-header">
      <text class="eyebrow">{{ props.eyebrow }}</text>
      <view class="header-row">
        <view>
          <text class="title">{{ props.title }}</text>
          <text class="description">{{ props.description }}</text>
        </view>
        <text class="role-chip">{{ props.role }}</text>
      </view>
      <view class="context-bar">
        <text>{{ props.venue || '延庆金羽主馆' }}</text>
        <text>{{ businessDate }} · {{ props.shift || '全日营业' }}</text>
      </view>
    </view>
    <slot />
  </view>
</template>

<style scoped>
.ops-page { min-height: 100vh; padding: 24rpx 28rpx 56rpx; box-sizing: border-box; background: #f3f6f2; }
.ops-header { padding: 32rpx; color: #fff; background: linear-gradient(145deg,#153d29,#237249); border-radius: 28rpx; box-shadow: 0 12rpx 28rpx rgba(22,61,41,.14); }
.eyebrow { display: block; opacity: .62; font-size: 19rpx; letter-spacing: 3rpx; }
.header-row { display: flex; align-items: flex-start; justify-content: space-between; gap: 16rpx; margin-top: 14rpx; }
.title { display: block; font-size: 40rpx; font-weight: 800; }
.description { display: block; max-width: 580rpx; margin-top: 12rpx; color: rgba(255,255,255,.74); font-size: 23rpx; line-height: 1.55; }
.role-chip { flex: 0 0 auto; padding: 9rpx 14rpx; color: #e8d28a; border: 1rpx solid rgba(232,210,138,.52); border-radius: 999rpx; font-size: 20rpx; }
.context-bar { display: flex; justify-content: space-between; gap: 16rpx; margin-top: 24rpx; padding-top: 18rpx; color: rgba(255,255,255,.72); border-top: 1rpx solid rgba(255,255,255,.16); font-size: 21rpx; }
</style>
