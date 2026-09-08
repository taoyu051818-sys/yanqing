<script setup lang="ts">
import { computed, ref } from 'vue'
import ActionDialog from './ActionDialog.vue'
const props = withDefaults(defineProps<{
  title: string; description: string; reasons?: string[]; busy?: boolean; error?: string; confirmText?: string
}>(), { reasons: () => ['行程有变', '时间不合适', '其他原因'], confirmText: '确认提交', error: '' })
const emit = defineEmits<{ submit: [reason: string]; cancel: [] }>()
const selected = ref('')
const note = ref('')
const reason = computed(() => selected.value === '其他原因' ? note.value.trim() : selected.value)
</script>
<template>
  <ActionDialog :title="title" :busy="busy" @close="emit('cancel')"><view class="reason-form">
    <text class="reason-description">{{ description }}</text>
    <slot />
    <text class="reason-label">请选择原因</text>
    <view class="reason-options">
      <button v-for="item in reasons" :key="item" :class="{ selected: selected === item }" :aria-pressed="selected === item" :disabled="busy" @tap="selected = item">{{ item }}</button>
    </view>
    <view v-if="selected === '其他原因'">
      <text class="reason-label">原因说明（至少 2 个字）</text>
      <input v-model="note" class="input" aria-label="原因说明" placeholder="请简单说明，方便工作人员处理" maxlength="200" :disabled="busy" :adjust-position="false" />
    </view>
    <text v-if="error" class="reason-error" role="alert">{{ error }}</text>
  </view>
  <template #footer>
    <view class="reason-actions"><button class="secondary" :disabled="busy" @tap="emit('cancel')">暂不处理</button><button class="primary" :loading="busy" :disabled="busy || reason.length < 2" @tap="emit('submit', reason)">{{ confirmText }}</button></view>
  </template></ActionDialog>
</template>
<style scoped>
.reason-form { display:grid; gap:24rpx; min-width:0; }
.reason-description { color:var(--color-muted,#5f6f65); font-size:26rpx; line-height:1.65; }
.reason-label { color:var(--color-foreground); font-size:28rpx; font-weight:700; }
.reason-options { display:flex; gap:16rpx; flex-wrap:wrap; }
.reason-options button { min-height:44px; flex:1 1 160rpx; margin:0; padding:18rpx 16rpx; color:var(--color-muted); font-size:26rpx; border-radius:var(--radius-sm,16rpx); background:var(--color-surface-subtle,#f7f9f6); border:1rpx solid var(--color-border); }
.reason-options .selected { color:var(--color-primary-strong); border-color:var(--color-primary); background:var(--color-primary-soft); }
.reason-form .input { box-sizing:border-box; width:100%; margin-top:14rpx; padding:20rpx 22rpx; color:var(--color-foreground); background:var(--color-surface-subtle); border:1rpx solid var(--color-border); border-radius:18rpx; font-size:28rpx; }
.reason-error { color:var(--color-danger); font-size:25rpx; line-height:1.65; }
.reason-actions { display:flex; flex-wrap:wrap; gap:16rpx; }
.reason-actions button { flex:1 1 40%; min-height:48px; margin:0; padding:18rpx 16rpx; border-radius:22rpx; font-size:28rpx; }
.reason-actions .primary { flex-grow:1.2; }
.reason-actions .primary[disabled] { opacity:1; color:var(--color-muted); background:var(--color-background); box-shadow:none; }
.reason-form text { overflow-wrap:anywhere; }
@media (max-width:350px) { .reason-actions button { flex-basis:100%; } }
</style>
