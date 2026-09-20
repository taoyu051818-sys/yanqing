<script setup lang="ts">
import { computed } from 'vue'
import {
  hasOperationsAccess,
  type OperationsAccessScope,
} from '../../../config/operations'
import { useSessionStore } from '../../../stores/session'
import AppIcon from '../../../components/AppIcon.vue'

const props = defineProps<{
  compact?: boolean
  title: string
  eyebrow: string
  description: string
  role: string
  access: OperationsAccessScope
  venue?: string
  shift?: string
  icon?: string
}>()

const session = useSessionStore()
const canAccess = computed(() => hasOperationsAccess(session.roles, props.access))

function backToMember() {
  uni.switchTab({ url: '/pages/home/index' })
}
</script>

<template>
  <view class="ops-page safe-bottom plain-page">
    <slot v-if="canAccess" />
    <view v-else class="access-denied">
      <AppIcon name="warning" :size="44" tone="danger" />
      <text class="access-title">无经营权限</text>
      <text class="access-copy">当前账号不具备此经营中心的访问权限，可返回会员端继续使用订场、活动和会员服务。</text>
      <button class="primary" @tap="backToMember">返回会员端</button>
    </view>
  </view>
</template>
<style scoped>
.ops-page { --ops-text:#20252b; --ops-muted:#626d66; --ops-accent:#17653d; min-height:calc(100vh - var(--window-top, 0px) - var(--window-bottom, 0px)); box-sizing:border-box; padding:24rpx 28rpx calc(48rpx + env(safe-area-inset-bottom)); background:#f5f6f8; color:#20252b; overflow-x:clip; }
.ops-page :deep(.card) { box-shadow:none; border-radius:24rpx; }
.ops-page :deep(button) { font-weight:500; box-shadow:none; min-height:44px; }
.ops-page :deep(.primary),.ops-page :deep(.secondary) { font-size:28rpx; }
.ops-page :deep(.metric) { box-shadow:none; border:0; }.ops-page :deep(.metric::before) { display:none; }.ops-page :deep(.metric .value) { font-weight:600; }
.ops-page :deep(.section-title),.ops-page :deep(.panel-title),.ops-page :deep(.strong) { font-weight:600; }
.ops-page :deep(.muted) { color:#626d66; font-size:26rpx; }
.ops-page :deep(.business-list) { background:#fff; border-radius:24rpx; overflow:hidden; }
.ops-page :deep(.business-list .card) { margin:0; border:0; border-bottom:1rpx solid #edf0f2; border-radius:0; padding:28rpx 24rpx; }
.ops-page :deep(.business-list .card:last-child) { border-bottom:0; }
.ops-page :deep(.business-list .member-name),.ops-page :deep(.business-list .strong) { font-size:30rpx; color:#20252b; }
.ops-page :deep(.business-list .muted) { font-size:25rpx; margin-top:8rpx; }
.access-denied { display:grid; gap:24rpx; padding:32rpx; background:#fff; border-radius:24rpx; }.access-title { font-size:34rpx; font-weight:600; }.access-copy { font-size:28rpx; color:#626d66; }
</style>
