<script setup lang="ts">
import { computed, ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import AppIcon from '../../components/AppIcon.vue'
import {
  visibleOperationsCenters,
  workQueueRoute,
} from '../../config/operations'
import { isUrgentWorkItem } from '../../config/work-items'
import { endpoints, type WorkItem } from '../../services/api'
import { useSessionStore } from '../../stores/session'
import type { AppRole } from '../../types/domain'

const session = useSessionStore()
const loading = ref(false)
const loadError = ref('')
const searchQuery = ref('')
const todoCount = ref(0)
const workItems = ref<WorkItem[]>([])

const roleLabels: Record<AppRole, string> = {
  MEMBER: '会员', FRONT_DESK: '前台', COACH: '教练', HOST: '主理人', MERCHANT: '联盟商户',
  FINANCE: '财务', EVENT_MANAGER: '赛事管理员', ADMIN: '管理员', SUPER_ADMIN: '超级管理员',
}

const isOperator = computed(() => session.isOperator)
const displayRoles = computed(() => session.roles.map((role) => roleLabels[role] || role).join(' · '))
const availableCenters = computed(() => visibleOperationsCenters(session.roles))
const canViewAnalytics = computed(() =>
  session.roles.some((role) => ['FINANCE', 'ADMIN', 'SUPER_ADMIN'].includes(role)),
)
const isAdmin = computed(() => session.roles.some((role) => ['ADMIN', 'SUPER_ADMIN'].includes(role)))
const adminSettings = [
  {
    key: 'training-products', icon: 'training', title: '课程班级',
    description: '新增、调价、设置有效期与上下架', route: '/packages/ops/pages/coach/index?view=products',
  },
  {
    key: 'coupon-campaigns', icon: 'ticket', title: '券活动',
    description: '新增券模板、发行上限与启停设置', route: '/packages/ops/pages/merchant/index?view=coupons',
  },
  {
    key: 'venue-pricing', icon: 'venue', title: '球馆设置',
    description: '球馆地址、营业时间、场地与价格', route: '/packages/ops/pages/venue-settings/index',
  },
]
const urgentCount = computed(() => workItems.value.filter(isUrgentWorkItem).length)
const menuItems = computed(() => {
  const items = availableCenters.value.map(center => ({ ...center, title: center.key === 'governance' && !isAdmin.value ? '风险审计' : ({ governance: '组织权限', members: '客户会员', inventory: '商品库存' } as Record<string, string>)[center.key] || center.title }))
  if (isAdmin.value) items.push(...adminSettings.map(item => ({ ...item, roles: [] })))
  if (canViewAnalytics.value) items.push(
    { key: 'analytics', icon: 'analytics', title: '经营分析', description: '经营数据', route: `${workQueueRoute}?view=analytics`, roles: [] },
    { key: 'pc-login', icon: 'scan', title: '电脑登录', description: '扫码登录后台', route: '/packages/ops/pages/pc-login/index', roles: [] },
  )
  const query = searchQuery.value.trim()
  return items.filter(item => !query || `${item.title} ${item.description}`.includes(query))
})

async function load() {
  if (loading.value) return
  await session.hydrate()
  if (!session.isOperator) return
  loading.value = true
  loadError.value = ''
  workItems.value = []
  todoCount.value = 0
  const [workItemsResult] = await Promise.allSettled([endpoints.workItems(100)])
  if (workItemsResult.status === 'fulfilled') {
    const payload: any = workItemsResult.value
    const items = Array.isArray(payload) ? payload : Array.isArray(payload?.items) ? payload.items : []
    workItems.value = items
    todoCount.value = items.length
  }
  if (workItemsResult.status === 'rejected') loadError.value = '待办暂未同步，当前数字不代表真实为0。'
  loading.value = false
}

function openRoute(route: string) { uni.navigateTo({ url: route }) }
function backToMember() { uni.switchTab({ url: '/pages/home/index' }) }
onShow(load)
</script>

<template>
  <view class="page workspace safe-bottom">
    <template v-if="isOperator">
      <view class="workspace-heading"><view><text class="title">经营台</text><text class="operator">{{ displayRoles }}</text></view><button class="back-button" @tap="backToMember">会员端 ›</button></view>
      <button class="summary" @tap="openRoute(workQueueRoute)"><text>待办 <text class="count">{{ loading ? '…' : loadError ? '—' : todoCount }}</text></text><text v-if="urgentCount" class="urgent">紧急 {{ urgentCount }}</text><text class="summary-action">查看并处理 ›</text></button>
      <view class="search-box"><AppIcon name="search" :size="30" tone="muted" /><input v-model="searchQuery" placeholder="搜索功能" confirm-type="search" /><button v-if="searchQuery" class="clear" @tap="searchQuery = ''">清除</button></view>
      <view class="menu-grid">
        <button v-for="item in menuItems" :key="item.key" class="menu-tile" hover-class="is-pressed" @tap="openRoute(item.route)"><view class="tile-icon"><AppIcon :name="item.icon" :size="40" /></view><text>{{ item.title }}</text></button>
      </view>
      <view v-if="!menuItems.length" class="empty">没有匹配的功能</view>
      <view v-if="loadError" class="sync-error"><text>{{ loadError }}</text><button :disabled="loading" @tap="load">重试</button></view>
    </template>
    <view v-else class="card member-tip"><text class="title">经营台</text><text class="muted">当前账号没有经营角色，可继续使用会员服务。</text><button class="primary" @tap="backToMember">返回会员首页</button></view>
  </view>
</template>
<style scoped>
.workspace { padding:24rpx; }
.workspace-heading { display:flex; align-items:center; justify-content:space-between; gap:16rpx; margin-bottom:20rpx; }
.title { display:block; font-size:36rpx; font-weight:800; color:#173e29; }
.operator { display:block; margin-top:4rpx; font-size:22rpx; color:#66736a; }
.back-button,.clear { background:transparent; font-size:24rpx; color:#17653d; margin:0; min-height:88rpx; display:flex; align-items:center; }
.back-button::after,.clear::after,.menu-tile::after,.summary::after { border:0; }
.summary { display:flex; align-items:center; gap:20rpx; width:100%; min-height:92rpx; margin:0 0 18rpx; padding:16rpx 24rpx; border-radius:20rpx; background:#17653d; color:#fff; font-size:26rpx; line-height:1.5; }
.count { font-size:32rpx; font-weight:800; margin-left:8rpx; }
.urgent { color:#ffe5a3; font-size:24rpx; }
.summary-action { margin-left:auto; font-size:23rpx; }
.search-box { display:flex; align-items:center; gap:12rpx; background:#fff; padding:0 20rpx; border-radius:18rpx; margin-bottom:18rpx; }
.search-box input { flex:1; min-width:0; height:88rpx; font-size:26rpx; }
.menu-grid { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:12rpx; }
.menu-tile { display:flex; flex-direction:column; align-items:center; justify-content:center; gap:12rpx; width:100%; min-height:142rpx; margin:0; padding:16rpx 4rpx; border-radius:20rpx; background:#fff; color:#233d2e; font-size:24rpx; line-height:1.4; white-space:normal; }
.tile-icon { display:grid; place-items:center; width:60rpx; height:60rpx; border-radius:18rpx; background:#eaf4ec; }
.is-pressed { background:#dceee1; }
.sync-error { display:flex; align-items:center; gap:12rpx; margin-top:18rpx; color:#923c32; font-size:23rpx; }
.sync-error button { flex-shrink:0; font-size:24rpx; min-height:88rpx; }
.empty { padding:30rpx; text-align:center; color:#66736a; }
.member-tip { display:grid; gap:24rpx; }
@media (max-width:350px) { .menu-grid { gap:8rpx; } .menu-tile { font-size:23rpx; } }
</style>
