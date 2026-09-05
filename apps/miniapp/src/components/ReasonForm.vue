<script setup lang="ts">
import { computed, ref } from 'vue'
const props = withDefaults(defineProps<{
  title: string; description: string; reasons?: string[]; busy?: boolean; error?: string; confirmText?: string
}>(), { reasons: () => ['行程有变', '时间不合适', '其他原因'], confirmText: '确认提交', error: '' })
const emit = defineEmits<{ submit: [reason: string]; cancel: [] }>()
const selected = ref('')
const note = ref('')
const reason = computed(() => selected.value === '其他原因' ? note.value.trim() : selected.value)
</script>
<template>
  <view class="reason-form">
    <text class="reason-title">{{ title }}</text>
    <text class="reason-description">{{ description }}</text>
    <slot />
    <text class="reason-label">请选择原因</text>
    <view class="reason-options">
      <button v-for="item in reasons" :key="item" :class="{ selected: selected === item }" :aria-pressed="selected === item" :disabled="busy" @tap="selected = item">{{ item }}</button>
    </view>
    <view v-if="selected === '其他原因'">
      <text class="reason-label">原因说明（至少 2 个字）</text>
      <input v-model="note" class="input" aria-label="原因说明" placeholder="请简单说明，方便工作人员处理" maxlength="200" :disabled="busy" />
    </view>
    <text v-if="error" class="reason-error" role="alert">{{ error }}</text>
    <view class="reason-actions"><button class="secondary" :disabled="busy" @tap="emit('cancel')">暂不处理</button><button class="primary" :loading="busy" :disabled="busy || reason.length < 2" @tap="emit('submit', reason)">{{ confirmText }}</button></view>
  </view>
</template>
<style scoped>
.reason-form { display:grid; gap:20rpx; min-width:0; padding:24rpx; margin-top:22rpx; border:1rpx solid var(--color-border); border-radius:20rpx; background:var(--color-surface-subtle); }
.reason-title { font-size:30rpx; font-weight:750; }.reason-description { font-size:25rpx; line-height:1.65; color:var(--color-muted); }.reason-label { font-size:26rpx; }
.reason-options { display:flex; gap:16rpx; flex-wrap:wrap; }.reason-options button { flex:1 1 160rpx; margin:0; padding:16rpx; font-size:25rpx; background:#fff; border:1rpx solid var(--color-border); }.reason-options .selected { color:var(--color-primary); border-color:var(--color-primary); background:var(--color-primary-soft); }
.reason-form .input { box-sizing:border-box; width:100%; margin-top:14rpx; }.reason-error { color:var(--color-danger); font-size:25rpx; line-height:1.6; }.reason-actions { display:flex; flex-wrap:wrap; gap:16rpx; }.reason-actions button { flex:1 1 180rpx; margin:0; padding:18rpx 12rpx; font-size:26rpx; }
.reason-form text { overflow-wrap:anywhere; }
</style>
