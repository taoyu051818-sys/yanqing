<script setup lang="ts">
import { computed, ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import { useVenueProfile } from '../../composables/use-venue-profile'
import AppIcon from '../../components/AppIcon.vue'
import {
  visibleOperationsCenters,
  workQueueRoute,
} from '../../config/operations'
import { isUrgentWorkItem } from '../../config/work-items'
import { endpoints, type WorkItem } from '../../services/api'
import { useSessionStore } from '../../stores/session'
import type { AppRole } from '../../types/domain'

const venue = useVenueProfile()
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
const availableCenters = computed(() => visibleOperationsCenters(session.roles))
const canViewAnalytics = computed(() =>
  session.roles.some((role) => ['FINANCE', 'ADMIN', 'SUPER_ADMIN'].includes(role)),
)
const isAdmin = computed(() => session.roles.some((role) => ['ADMIN', 'SUPER_ADMIN'].includes(role)))
const adminSettings = [
  { key: 'courts', icon: 'booking', title: '场地管理', description: '新增、编辑、删除场地与开放设置', route: '/packages/ops/pages/venue-settings/index?view=courts' },
  {
    key: 'training-products', icon: 'training', title: '课程班级',
    description: '新增、调价、设置有效期与上下架', route: '/packages/ops/pages/coach/index?view=products',
  },
  {
    key: 'coupon-campaigns', icon: 'ticket', title: '券活动',
    description: '新增券模板、发行上限与启停设置', route: '/packages/ops/pages/merchant/index?view=coupons',
  },
  {
    key: 'venue-pricing', icon: 'venue', title: '球馆信息',
    description: '球馆地址、营业时间、场地与价格', route: '/packages/ops/pages/venue-settings/index',
  },
]
const urgentCount = computed(() => workItems.value.filter(isUrgentWorkItem).length)
const menuItems = computed(() => {
  const items = availableCenters.value.map(center => ({ ...center, title: center.key === 'governance' && !isAdmin.value ? '风险审计' : ({ governance: '员工权限', members: '会员管理', inventory: '商品库存', venue:'场地维护', training:'培训管理', games:'球局管理', events:'赛事管理', alliance:'商户与券' } as Record<string, string>)[center.key] || center.title }))
  if (isAdmin.value) items.push(...adminSettings.map(item => ({ ...item, roles: [] })))
  if (canViewAnalytics.value) items.push(
    { key: 'analytics', icon: 'analytics', title: '经营分析', description: '经营数据', route: `${workQueueRoute}?view=analytics`, roles: [] },
    { key: 'pc-login', icon: 'scan', title: '电脑登录', description: '扫码登录后台', route: '/packages/ops/pages/pc-login/index', roles: [] },
  )
  if (session.roles.some(role => ['FRONT_DESK','ADMIN','SUPER_ADMIN'].includes(role))) items.unshift({ key:'booking', icon:'booking', title:'预订场地', description:'预约场次 代会员订场', route:'/pages/booking/index', roles:[] })
  return items
})

const menuGroups = computed(() => [
  { title: '日常营业', keys: ['booking', 'today', 'venue'] },
  { title: '客户与活动', keys: ['members', 'training', 'games', 'events', 'training-products', 'coupon-campaigns', 'alliance'] },
  { title: '财务与商品', keys: ['finance', 'inventory', 'analytics'] },
  { title: '门店管理', keys: ['venue-pricing', 'courts', 'governance', 'pc-login'] },
].map(group => ({ ...group, items: group.keys.flatMap(key => menuItems.value.filter(item => item.key === key && (!searchQuery.value.trim() || `${group.title} ${item.title} ${item.description}`.includes(searchQuery.value.trim())))) })).filter(group => group.items.length))

async function load() {
  if (loading.value) return
  void venue.refresh()
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

function openRoute(route: string) { if (route === '/pages/booking/index') uni.switchTab({ url: route }); else uni.navigateTo({ url: route }) }
function backToMember() { uni.switchTab({ url: '/pages/home/index' }) }
onShow(load)
</script>

<template>
  <view class="page workspace safe-bottom">
    <template v-if="isOperator">
      <view class="workspace-heading"><view><text class="title">{{ venue.profile.value?.name || '球馆经营台' }}</text><text class="operator">{{ roleLabels[session.user?.primaryRole || 'MEMBER'] }}</text></view><button class="back-button" @tap="backToMember">会员端 ›</button></view>
      <button class="summary" @tap="openRoute(workQueueRoute)"><view><text>待处理事项</text><text class="count">{{ loading ? '…' : loadError ? '—' : todoCount }}</text><text v-if="urgentCount" class="urgent">紧急 {{ urgentCount }}</text></view><text class="summary-action">处理 ›</text></button>
      <view class="search-box"><AppIcon name="search" :size="30" tone="muted" /><input v-model="searchQuery" placeholder="搜索功能" confirm-type="search" /><button v-if="searchQuery" class="clear" @tap="searchQuery = ''">清除</button></view>
      <view v-for="group in menuGroups" :key="group.title" class="menu-group"><text class="group-title">{{ group.title }}</text><view class="menu-grid">
        <button v-for="item in group.items" :key="item.key" class="menu-tile" hover-class="is-pressed" @tap="openRoute(item.route)"><AppIcon :name="item.icon" :size="48" /><text>{{ item.title }}</text></button>
      </view></view>
      <view v-if="!menuGroups.length" class="empty">没有匹配的功能</view>
      <view v-if="loadError" class="sync-error"><text>{{ loadError }}</text><button :disabled="loading" @tap="load">重试</button></view>
    </template>
    <view v-else class="card member-tip"><text class="title">经营台</text><text class="muted">当前账号没有经营角色，可继续使用会员服务。</text><button class="primary" @tap="backToMember">返回会员首页</button></view>
  </view>
</template>
<style scoped>
.workspace { padding:24rpx; background:#f5f6f8; }
.workspace-heading { display:flex; align-items:center; justify-content:space-between; gap:20rpx; margin-bottom:22rpx; }
.workspace-heading>view { flex:1; min-width:0; }
.title { display:block; font-size:34rpx; font-weight:650; color:#20252b; overflow-wrap:anywhere; }
.operator { display:block; margin-top:8rpx; font-size:24rpx; color:#727982; }
.back-button,.clear { background:transparent; font-size:26rpx; color:#17653d; margin:0; min-height:88rpx; display:flex; align-items:center; flex-shrink:0; }
.back-button::after,.clear::after,.menu-tile::after,.summary::after { border:0; }
.summary { display:flex; align-items:center; justify-content:space-between; width:100%; min-height:96rpx; margin:0 0 20rpx; padding:20rpx 24rpx; border-radius:16rpx; background:#fff; color:#20252b; font-size:28rpx; line-height:1.5; }
.summary>view { display:flex; align-items:center; gap:18rpx; }
.count { font-size:34rpx; font-weight:700; }
.urgent { color:#a04d19; font-size:24rpx; }
.summary-action { color:#17653d; font-size:26rpx; }
.search-box { display:flex; align-items:center; gap:12rpx; background:#fff; padding:0 24rpx; border-radius:16rpx; margin-bottom:24rpx; }
.search-box input { flex:1; min-width:0; height:88rpx; font-size:28rpx; }
.menu-group { padding:26rpx 16rpx 16rpx; background:#fff; border-radius:18rpx; margin-bottom:20rpx; }
.group-title { display:block; margin:0 12rpx 14rpx; font-size:30rpx; font-weight:700; color:#20252b; }
.menu-grid { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:8rpx; }
.menu-tile { display:flex; flex-direction:column; align-items:center; justify-content:center; gap:16rpx; width:100%; min-height:144rpx; margin:0; padding:16rpx 0; background:transparent; color:#4b535b; font-size:26rpx; line-height:1.5; white-space:normal; }
.is-pressed { background:#edf4ef; }
.sync-error { display:flex; align-items:center; gap:12rpx; margin-top:18rpx; color:#923c32; font-size:25rpx; }
.sync-error button { flex-shrink:0; font-size:26rpx; min-height:88rpx; }
.empty { padding:30rpx; text-align:center; color:#687079; }
.member-tip { display:grid; gap:24rpx; }
@media (max-width:350px) { .menu-tile { font-size:25rpx; } }
</style>
