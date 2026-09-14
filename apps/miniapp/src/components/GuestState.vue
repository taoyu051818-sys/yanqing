<script setup lang="ts">
defineProps<{ title: string; description: string; actionText?: string }>()
defineEmits<{ login: [] }>()
</script>
<template>
  <view class="card guest-state">
    <text class="guest-label">游客浏览</text>
    <text class="guest-title">{{ title }}</text>
    <text class="muted">{{ description }}</text>
    <button class="secondary" @tap="$emit('login')">{{ actionText || '登录查看我的记录' }}</button>
  </view>
</template>
<style scoped>
.guest-state { display:grid; gap:18rpx; }
.guest-label { color:var(--color-muted); font-size:24rpx; }
.guest-title { color:var(--color-primary-strong); font-size:32rpx; font-weight:750; }
.guest-state button { width:100%; margin:0; }
</style>
