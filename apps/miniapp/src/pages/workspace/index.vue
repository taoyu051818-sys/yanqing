<script setup lang="ts">
import { computed, ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import MetricCard from '../../components/MetricCard.vue'
import { endpoints } from '../../services/api'
import { useSessionStore } from '../../stores/session'
import type { AppRole } from '../../types/domain'

type Module = { key: string; title: string; description: string; route: string; roles: AppRole[] }

const session = useSessionStore()
const loading = ref(false)
const orderCount = ref(0)
const trainingCount = ref(0)
const lowStockCount = ref(0)

const roleLabels: Record<AppRole, string> = {
  MEMBER: '会员', FRONT_DESK: '前台', COACH: '教练', HOST: '主理人', MERCHANT: '联盟商户',
  FINANCE: '财务', EVENT_MANAGER: '赛事管理员', ADMIN: '管理员', SUPER_ADMIN: '超级管理员',
}

const modules: Module[] = [
  { key: 'today', title: '今日营业', description: '值班、现场队列、异常与交接', route: '/packages/ops/pages/frontdesk/index', roles: ['FRONT_DESK', 'ADMIN', 'SUPER_ADMIN'] },
  { key: 'transactions', title: '交易中心', description: '订单、收款、退款申请与审核', route: '/packages/ops/pages/finance/index', roles: ['FINANCE', 'ADMIN', 'SUPER_ADMIN'] },
  { key: 'venue', title: '场馆资源', description: '封场维护日历、资源占用与可售状态', route: '/packages/ops/pages/venue/index', roles: ['FRONT_DESK', 'ADMIN', 'SUPER_ADMIN'] },
  { key: 'members', title: '会员服务', description: '会员查询、权益、账户与服务记录', route: '/packages/ops/pages/members/index', roles: ['FRONT_DESK', 'COACH', 'FINANCE', 'ADMIN', 'SUPER_ADMIN'] },
  { key: 'training', title: '培训运营', description: '课表、学员签到、消课与反馈', route: '/packages/ops/pages/coach/index', roles: ['COACH', 'FRONT_DESK', 'ADMIN', 'SUPER_ADMIN'] },
  { key: 'games', title: '球局运营', description: '报名名单、现场签到与激励结算', route: '/packages/ops/pages/host/index', roles: ['HOST', 'ADMIN', 'SUPER_ADMIN'] },
  { key: 'events', title: '赛事运营', description: '队伍、比分、排名、奖品出库与签收', route: '/packages/ops/pages/event/index', roles: ['EVENT_MANAGER', 'FRONT_DESK', 'ADMIN', 'SUPER_ADMIN'] },
  { key: 'alliance', title: '联盟商户', description: '券码核销、消费归因与周期结算', route: '/packages/ops/pages/merchant/index', roles: ['MERCHANT', 'FRONT_DESK', 'FINANCE', 'ADMIN', 'SUPER_ADMIN'] },
  { key: 'inventory', title: '商品库存', description: '库存台账、低库存与出入库', route: '/packages/ops/pages/inventory/index', roles: ['FRONT_DESK', 'ADMIN', 'SUPER_ADMIN'] },
  { key: 'finance', title: '财务结算', description: '经营收入、培训分成、对账与导出', route: '/packages/ops/pages/finance/index', roles: ['FINANCE', 'ADMIN', 'SUPER_ADMIN'] },
]

const isOperator = computed(() => session.isOperator)
const visibleModules = computed(() => modules.filter((module) => module.roles.some((role) => session.roles.includes(role))))
const displayRoles = computed(() => session.roles.map((role) => roleLabels[role] || role).join(' · '))
const todayMetrics = computed(() => [
  ['待处理订单', String(orderCount.value)],
  ['今日课程', String(trainingCount.value)],
  ['低库存项', String(lowStockCount.value)],
  ['营业状态', '营业中'],
])

async function load() {
  await session.hydrate()
  if (!session.isOperator) return
  loading.value = true
  const [orders, sessions, lowStock] = await Promise.allSettled([
    endpoints.adminOrders(), endpoints.trainingSessions(), endpoints.lowStock(),
  ])
  if (orders.status === 'fulfilled') orderCount.value = orders.value?.items?.length || 0
  if (sessions.status === 'fulfilled') trainingCount.value = sessions.value?.filter((item: any) => item.status !== 'COMPLETED').length || 0
  if (lowStock.status === 'fulfilled') lowStockCount.value = lowStock.value?.length || 0
  loading.value = false
}

function openModule(module: Module) { uni.navigateTo({ url: module.route }) }
function backToMember() { uni.switchTab({ url: '/pages/home/index' }) }
onShow(load)
</script>

<template>
  <view class="page safe-bottom">
    <view v-if="isOperator" class="workspace-header">
      <text class="eyebrow">BUSINESS OPERATIONS</text>
      <text class="title">今日营业</text>
      <text class="operator">{{ displayRoles }} · 延庆金羽主馆</text>
      <text class="copy">以营业日期、场馆和职责范围组织工作，不把会员端页面当作员工后台。</text>
    </view>
    <view v-if="isOperator" class="metric-grid">
      <MetricCard v-for="item in todayMetrics" :key="item[0]" :label="item[0]" :value="item[1]" />
    </view>
    <view v-if="isOperator" class="section-title">经营中心</view>
    <view v-if="isOperator" class="module-list">
      <view v-for="module in visibleModules" :key="module.key" class="module card" @tap="openModule(module)">
        <view class="module-copy"><text class="module-title">{{ module.title }}</text><text class="muted">{{ module.description }}</text></view>
        <text class="module-arrow">›</text>
      </view>
    </view>
    <view v-if="isOperator" class="scope card">
      <view class="row"><text class="scope-title">当前操作范围</text><text class="scope-value">主馆 · {{ loading ? '同步中' : '已同步' }}</text></view>
      <text class="muted">生产环境由账号权限、场馆范围、营业班次和审批规则共同约束；演示环境只用于验收流程。</text>
    </view>
    <view v-else class="member-tip card">
      <text class="scope-title">这里是员工经营入口</text>
      <text class="muted">当前账号没有经营角色，请从会员首页继续使用订场、活动和会员服务。</text>
      <button class="primary" @tap="backToMember">返回会员首页</button>
    </view>
  </view>
</template>

<style scoped>
.workspace-header { padding: 36rpx 32rpx; color: #fff; background: linear-gradient(145deg,#153d29,#237249); border-radius: 30rpx; }.eyebrow { display: block; opacity: .64; font-size: 19rpx; letter-spacing: 3rpx; }.title { display: block; margin: 18rpx 0 10rpx; font-size: 45rpx; font-weight: 800; }.operator { display: block; color: #e8d28a; font-size: 22rpx; }.copy { display: block; margin-top: 18rpx; color: rgba(255,255,255,.76); font-size: 24rpx; line-height: 1.6; }.metric-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 14rpx; margin-top: 20rpx; }.module-list { display: grid; gap: 14rpx; }.module { display: flex; align-items: center; justify-content: space-between; margin: 0; }.module-copy { min-width: 0; }.module-title { display: block; margin-bottom: 8rpx; font-size: 30rpx; font-weight: 800; }.module-arrow { color: #17653d; font-size: 40rpx; }.scope,.member-tip { margin-top: 22rpx; }.scope-title { font-size: 29rpx; font-weight: 800; }.scope-value { color: #17653d; font-size: 23rpx; }.scope .muted,.member-tip .muted { display: block; margin-top: 12rpx; line-height: 1.6; }.member-tip button { margin-top: 24rpx; }
</style>
