<script setup lang="ts">
import { computed, ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import MetricCard from '../../components/MetricCard.vue'
import {
  hasOperationsAccess,
  preferredOperationsCenter,
  visibleOperationsCenters,
  workQueueRoute,
} from '../../config/operations'
import { endpoints } from '../../services/api'
import { useSessionStore } from '../../stores/session'
import type { AppRole } from '../../types/domain'

const session = useSessionStore()
const loading = ref(false)
const loadError = ref('')
const searchQuery = ref('')
const todoCount = ref(0)
const trainingCount = ref(0)
const lowStockCount = ref(0)

const roleLabels: Record<AppRole, string> = {
  MEMBER: '会员', FRONT_DESK: '前台', COACH: '教练', HOST: '主理人', MERCHANT: '联盟商户',
  FINANCE: '财务', EVENT_MANAGER: '赛事管理员', ADMIN: '管理员', SUPER_ADMIN: '超级管理员',
}

const isOperator = computed(() => session.isOperator)
const displayRoles = computed(() => session.roles.map((role) => roleLabels[role] || role).join(' · '))
const availableCenters = computed(() => visibleOperationsCenters(session.roles))
const preferredCenter = computed(() => preferredOperationsCenter(session.roles))
const canViewAnalytics = computed(() =>
  session.roles.some((role) => ['FINANCE', 'ADMIN', 'SUPER_ADMIN'].includes(role)),
)
const canViewInventory = computed(() => hasOperationsAccess(session.roles, 'inventory'))
const canViewTraining = computed(() => hasOperationsAccess(session.roles, 'training'))
const filteredCenters = computed(() => {
  const query = searchQuery.value.trim().toLowerCase()
  if (!query) return availableCenters.value
  return availableCenters.value.filter((center) =>
    `${center.title} ${center.description}`.toLowerCase().includes(query),
  )
})
const quickActions = computed(() => [
  {
    key: 'work',
    title: '统一待办',
    description: todoCount.value ? `${todoCount.value} 项待处理，按责任岗位分组` : '查看待办、异常和跨岗位交接',
    route: workQueueRoute,
  },
  ...(preferredCenter.value
    ? [{
        key: `role-${preferredCenter.value.key}`,
        title: `进入${preferredCenter.value.title}`,
        description: preferredCenter.value.description,
        route: preferredCenter.value.route,
      }]
    : []),
  ...(canViewAnalytics.value
    ? [{
        key: 'analytics',
        title: '经营分析',
        description: '查看出租率、收入、复购、培训和联盟指标',
        route: `${workQueueRoute}?view=analytics`,
      }]
    : []),
])
const todayMetrics = computed(() => [
  ['统一待办', String(todoCount.value)],
  ...(canViewTraining.value ? [['今日课程', String(trainingCount.value)]] : []),
  ...(canViewInventory.value ? [['低库存项', String(lowStockCount.value)]] : []),
  ['可用中心', String(availableCenters.value.length)],
])

async function load() {
  if (loading.value) return
  await session.hydrate()
  if (!session.isOperator) return
  loading.value = true
  loadError.value = ''
  const [workItems, sessions, lowStock] = await Promise.allSettled([
    endpoints.workItems(100),
    canViewTraining.value ? endpoints.trainingSessions() : Promise.resolve([]),
    canViewInventory.value ? endpoints.lowStock() : Promise.resolve([]),
  ])
  if (workItems.status === 'fulfilled') {
    const payload: any = workItems.value
    todoCount.value = Array.isArray(payload) ? payload.length : payload?.items?.length || 0
  }
  if (sessions.status === 'fulfilled') {
    trainingCount.value = sessions.value.filter((item: any) => item.status !== 'COMPLETED').length
  }
  if (lowStock.status === 'fulfilled') lowStockCount.value = lowStock.value.length
  const failedSources = [
    workItems.status === 'rejected' ? '统一待办' : '',
    canViewTraining.value && sessions.status === 'rejected' ? '培训课表' : '',
    canViewInventory.value && lowStock.status === 'rejected' ? '库存预警' : '',
  ].filter(Boolean)
  if (failedSources.length) loadError.value = `${failedSources.join('、')}暂未同步，当前数字不代表真实为 0。`
  loading.value = false
}

function openRoute(route: string) { uni.navigateTo({ url: route }) }
function backToMember() { uni.switchTab({ url: '/pages/home/index' }) }
onShow(load)
</script>

<template>
  <view class="page safe-bottom">
    <view v-if="isOperator" class="workspace-header">
      <view class="header-topline"><text class="eyebrow">BUSINESS WORKSPACE</text><text class="live-status">经营在线</text></view>
      <text class="title">经营工作台</text>
      <text class="operator">{{ displayRoles }} · 延庆金羽主馆</text>
      <text class="copy">先处理当前岗位待办，再进入业务中心；经营分析与业务操作保持分离。</text>
    </view>

    <view v-if="isOperator" class="metric-grid">
      <MetricCard v-for="item in todayMetrics" :key="item[0]" :label="item[0]" :value="item[1]" />
    </view>

    <view v-if="isOperator && loadError" class="sync-error card">
      <view><text class="sync-error-title">部分经营数据同步失败</text><text class="muted">{{ loadError }}</text></view>
      <button class="secondary sync-retry" :disabled="loading" @tap="load">重新同步</button>
    </view>

    <template v-if="isOperator">
      <view class="section-heading"><text class="section-title">我的工作</text><text class="section-note">按优先级处理</text></view>
      <view class="quick-list">
        <view v-for="(action, index) in quickActions" :key="action.key" class="quick-card" role="button" tabindex="0" :aria-label="`${action.title}，${action.description}`" hover-class="is-pressed" @tap="openRoute(action.route)" @keyup.enter="openRoute(action.route)">
          <text class="quick-priority">{{ index === 0 ? '优先' : '常用' }}</text>
          <view><text class="quick-title">{{ action.title }}</text><text class="quick-note">{{ action.description }}</text></view>
          <text class="module-arrow" aria-hidden="true">›</text>
        </view>
      </view>

      <view class="section-heading"><text class="section-title">业务中心</text><text class="section-note">{{ filteredCenters.length }} 个可用</text></view>
      <view class="search-box">
        <input v-model="searchQuery" confirm-type="search" placeholder="搜索业务中心" />
      </view>
      <view v-if="filteredCenters.length" class="module-list">
        <view v-for="center in filteredCenters" :key="center.key" class="module card" role="button" tabindex="0" :aria-label="`${center.title}，${center.description}`" hover-class="is-pressed" @tap="openRoute(center.route)" @keyup.enter="openRoute(center.route)">
          <view class="module-copy"><text class="module-title">{{ center.title }}</text><text class="muted">{{ center.description }}</text></view>
          <text class="module-arrow">›</text>
        </view>
      </view>
      <view v-else class="empty card">没有匹配的业务中心</view>

      <view class="scope card">
        <view class="row"><text class="scope-title">当前操作范围</text><text class="scope-value">主馆 · {{ loading ? '同步中' : loadError ? '部分未同步' : '已同步' }}</text></view>
        <text class="muted">生产权限由账号角色、场馆范围、营业班次和审批规则共同约束；演示身份仅用于流程验收。</text>
        <button class="secondary member-button" @tap="backToMember">返回会员端</button>
      </view>
    </template>

    <view v-else class="member-tip card">
      <text class="scope-title">这里是员工经营入口</text>
      <text class="muted">当前账号没有经营角色，请从会员首页继续使用订场、活动和会员服务。</text>
      <button class="primary" @tap="backToMember">返回会员首页</button>
    </view>
  </view>
</template>

<style scoped>
.workspace-header { position: relative; overflow: hidden; padding: 36rpx 32rpx; color: #fff; background: linear-gradient(145deg,#103b27,#17653d 72%,#6f6b2a 140%); border: 1rpx solid rgba(255,255,255,.12); border-radius: 30rpx; box-shadow: 0 18rpx 44rpx rgba(22,61,41,.16); }
.workspace-header::after { position:absolute; right:-90rpx; bottom:-130rpx; width:290rpx; height:290rpx; border:40rpx solid rgba(255,255,255,.045); border-radius:50%; content:''; }
.header-topline { position: relative; z-index: 1; display:flex; align-items:center; justify-content:space-between; gap:16rpx; }
.eyebrow { display: block; opacity: .64; font-size: 19rpx; letter-spacing: 3rpx; }
.live-status { flex:0 0 auto; padding:6rpx 13rpx; color:#fff3c8; background:rgba(255,255,255,.1); border:1rpx solid rgba(255,243,200,.2); border-radius:999rpx; font-size:20rpx; }
.title { display: block; margin: 18rpx 0 10rpx; font-size: 45rpx; font-weight: 800; }
.operator { display: block; color: #e8d28a; font-size: 22rpx; }
.copy { display: block; margin-top: 18rpx; color: rgba(255,255,255,.76); font-size: 24rpx; line-height: 1.6; }
.metric-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14rpx; margin-top: 20rpx; }
.section-heading { display:flex; align-items:baseline; justify-content:space-between; gap:18rpx; margin:38rpx 0 18rpx; }
.section-heading .section-title { margin:0; }
.section-note { color:#6a776e; font-size:22rpx; }
.quick-list,.module-list { display: grid; gap: 14rpx; }
.quick-card { position:relative; display: flex; align-items: center; justify-content: space-between; gap: 18rpx; min-height:92rpx; padding: 30rpx 28rpx 26rpx; color: #fff; background: linear-gradient(135deg,#17653d,#205f40); border:1rpx solid rgba(255,255,255,.1); border-radius: 24rpx; box-shadow:0 10rpx 28rpx rgba(23,101,61,.12); }
.quick-card > view { flex: 1; min-width: 0; }
.quick-priority { position:absolute; top:0; left:28rpx; padding:3rpx 12rpx; color:#fff3c8; background:rgba(255,255,255,.13); border-radius:0 0 10rpx 10rpx; font-size:18rpx; letter-spacing:1rpx; }
.quick-title { display: block; font-size: 30rpx; font-weight: 800; }
.quick-note { display: block; margin-top: 8rpx; color: rgba(255,255,255,.72); font-size: 22rpx; line-height: 1.5; overflow-wrap: anywhere; }
.quick-card .module-arrow { color: #e8d28a; }
.search-box { padding: 0 22rpx; margin-bottom: 16rpx; background: #fff; border: 1rpx solid rgba(28,63,43,.1); border-radius: 20rpx; box-shadow:0 5rpx 16rpx rgba(26,56,38,.035); }
.search-box input { height: 82rpx; font-size: 25rpx; }
.module { display: flex; align-items: center; justify-content: space-between; min-height:82rpx; margin: 0; }
.module-copy { min-width: 0; }
.module-title { display: block; margin-bottom: 8rpx; font-size: 30rpx; font-weight: 800; }
.module-arrow { flex: 0 0 auto; color: #17653d; font-size: 40rpx; }
.scope,.member-tip { margin-top: 22rpx; }
.sync-error { display:flex; align-items:flex-start; justify-content:space-between; gap:16rpx; margin-top:20rpx; color:#8a3636; background:#fff4f2; }
.sync-error > view { flex:1; min-width:0; }
.sync-error-title { display:block; margin-bottom:8rpx; font-size:26rpx; font-weight:800; }
.sync-error .muted { display:block; line-height:1.55; overflow-wrap:anywhere; }
.sync-retry { flex:0 0 auto; width:auto; margin:0; padding:0 18rpx; font-size:22rpx; }
.scope-title { font-size: 29rpx; font-weight: 800; }
.scope-value { color: #17653d; font-size: 23rpx; }
.scope .muted,.member-tip .muted { display: block; margin-top: 12rpx; line-height: 1.6; }
.member-button,.member-tip button { width: 100%; margin-top: 22rpx; }
.empty { color: #758079; text-align: center; }
.is-pressed { opacity:.84; }

@media screen and (max-width: 420px) {
  .workspace-header { padding:30rpx 26rpx; }
  .sync-error { flex-direction:column; }
  .sync-retry { width:100%; }
  .scope .row { align-items:flex-start; flex-wrap:wrap; }
  .scope-value { width:100%; }
}
</style>
