<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { onLoad, onShow } from '@dcloudio/uni-app'
import OperationsFrame from '../../../../components/OperationsFrame.vue'
import SectionEmpty from '../../../../components/SectionEmpty.vue'
import StatusBadge from '../../../../components/StatusBadge.vue'
import { endpoints } from '../../../../services/api'
import { isMockMode } from '../../../../services/http'
import { useSessionStore } from '../../../../stores/session'
import type { AppRole } from '../../../../types/domain'
import { shortDate } from '../../../../utils/format'
import { withPendingCreationKey } from '../../../../utils/pending-creation-key'

type GovernanceTab = 'users' | 'parameters' | 'risks' | 'privacy' | 'audit' | 'exports'

const session = useSessionStore()
const loading = ref(false)
const acting = ref('')
const error = ref('')
const activeTab = ref<GovernanceTab>('users')
const users = ref<any[]>([])
const parameters = ref<any[]>([])
const risks = ref<any[]>([])
const auditLogs = ref<any[]>([])
const erasureRequests = ref<any[]>([])
const erasureBlockers = reactive<Record<string, any[]>>({})
const erasureReasons = reactive<Record<string, string>>({})
const userKeyword = ref('')
const selectedUserId = ref('')
const selectedRoles = ref<AppRole[]>([])
const primaryRole = ref<AppRole>('MEMBER')
const merchantId = ref('')
const roleReason = ref('')
const auditObjectType = ref('')
const riskReasons = reactive<Record<string, string>>({})

const parameterForm = reactive({
  key: '',
  value: '',
  type: 'STRING',
  description: '',
  effectiveFrom: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
  locked: false,
})

const roleOptions: Array<{ value: AppRole; label: string }> = [
  { value: 'MEMBER', label: '会员' },
  { value: 'FRONT_DESK', label: '前台' },
  { value: 'COACH', label: '教练' },
  { value: 'HOST', label: '主理人' },
  { value: 'EVENT_MANAGER', label: '赛事管理员' },
  { value: 'MERCHANT', label: '联盟商户' },
  { value: 'FINANCE', label: '财务' },
  { value: 'ADMIN', label: '管理员' },
  { value: 'SUPER_ADMIN', label: '超级管理员' },
]

const allTabs: Array<{ key: GovernanceTab; label: string; roles: AppRole[] }> = [
  { key: 'users', label: '组织权限', roles: ['ADMIN', 'SUPER_ADMIN'] },
  { key: 'parameters', label: '参数版本', roles: ['FINANCE', 'ADMIN', 'SUPER_ADMIN'] },
  { key: 'risks', label: '风险事件', roles: ['FINANCE', 'ADMIN', 'SUPER_ADMIN'] },
  { key: 'privacy', label: '注销复核', roles: ['ADMIN', 'SUPER_ADMIN'] },
  { key: 'audit', label: '审计日志', roles: ['FINANCE', 'ADMIN', 'SUPER_ADMIN'] },
  { key: 'exports', label: '数据导出', roles: ['FINANCE', 'ADMIN', 'SUPER_ADMIN'] },
]

const exportScopes = [
  ['orders', '订单与支付'],
  ['members', '会员与五账户'],
  ['training', '培训运营'],
  ['events', '赛事经营'],
  ['alliance', '联盟商户'],
  ['inventory', '商品库存'],
  ['finance', '财务结算'],
  ['audit', '审计与关账'],
  ['all', '全量审计包'],
] as const

const visibleTabs = computed(() =>
  allTabs.filter((tab) => tab.roles.some((role) => session.roles.includes(role))),
)
const canSuperviseUsers = computed(() => session.roles.includes('SUPER_ADMIN'))
const canConfigure = computed(() => session.roles.some((role) => ['ADMIN', 'SUPER_ADMIN'].includes(role)))
const canResolveRisk = computed(() => session.roles.some((role) => ['ADMIN', 'SUPER_ADMIN'].includes(role)))
const canCompleteErasure = computed(() => session.roles.includes('SUPER_ADMIN'))
const selectedUser = computed(() => users.value.find((item) => item.id === selectedUserId.value))
const availablePrimaryRoles = computed(() => roleOptions.filter((item) => selectedRoles.value.includes(item.value)))

function unwrapItems(value: any) {
  if (Array.isArray(value)) return value
  return Array.isArray(value?.items) ? value.items : []
}

function roleLabel(role: string) {
  return roleOptions.find((item) => item.value === role)?.label || role
}

function selectUser(user: any) {
  selectedUserId.value = user.id
  selectedRoles.value = [...new Set([user.primaryRole, ...(user.roles || []).map((item: any) => item.role)])] as AppRole[]
  primaryRole.value = user.primaryRole
  merchantId.value = user.roles?.find((item: any) => item.role === 'MERCHANT')?.merchantId || ''
  roleReason.value = ''
}

function toggleRole(role: AppRole) {
  if (!canSuperviseUsers.value) return
  if (selectedRoles.value.includes(role)) {
    if (selectedRoles.value.length === 1 || role === primaryRole.value) {
      uni.showToast({ title: role === primaryRole.value ? '请先切换主角色' : '至少保留一个角色', icon: 'none' })
      return
    }
    selectedRoles.value = selectedRoles.value.filter((item) => item !== role)
  } else {
    selectedRoles.value = [...selectedRoles.value, role]
  }
}

function onPrimaryRoleChange(event: any) {
  const option = availablePrimaryRoles.value[Number(event.detail.value)]
  if (option) primaryRole.value = option.value
}

function parseParameterValue() {
  const raw = parameterForm.value.trim()
  if (parameterForm.type === 'STRING') return raw
  if (parameterForm.type === 'INTEGER') {
    const value = Number(raw)
    if (!Number.isInteger(value)) throw new Error('整数参数必须填写整数')
    return value
  }
  if (parameterForm.type === 'DECIMAL') {
    const value = Number(raw)
    if (!Number.isFinite(value)) throw new Error('小数参数格式不正确')
    return value
  }
  if (parameterForm.type === 'BOOLEAN') {
    if (!['true', 'false'].includes(raw.toLowerCase())) throw new Error('布尔参数只能填写 true 或 false')
    return raw.toLowerCase() === 'true'
  }
  return JSON.parse(raw)
}

async function loadCurrentTab() {
  loading.value = true
  error.value = ''
  try {
    if (activeTab.value === 'users') {
      users.value = unwrapItems(await endpoints.governanceUsers({ page: 1, pageSize: 100, keyword: userKeyword.value || undefined }))
      if (!users.value.some((item) => item.id === selectedUserId.value) && users.value[0]) selectUser(users.value[0])
    } else if (activeTab.value === 'parameters') {
      parameters.value = unwrapItems(await endpoints.parameters())
    } else if (activeTab.value === 'risks') {
      risks.value = unwrapItems(await endpoints.riskEvents({ page: 1, pageSize: 100 }))
    } else if (activeTab.value === 'audit') {
      auditLogs.value = unwrapItems(await endpoints.auditLogs({ page: 1, pageSize: 100, objectType: auditObjectType.value || undefined }))
    } else if (activeTab.value === 'privacy') {
      erasureRequests.value = unwrapItems(await endpoints.dataErasureRequests({ page: 1, pageSize: 100 }))
    }
  } catch (cause: any) {
    error.value = cause?.message || '治理数据加载失败'
  } finally {
    loading.value = false
  }
}

async function switchTab(tab: GovernanceTab) {
  activeTab.value = tab
  await loadCurrentTab()
}

async function saveRoles() {
  if (!selectedUser.value || !canSuperviseUsers.value) return
  if (roleReason.value.trim().length < 2) {
    uni.showToast({ title: '请填写角色变更原因', icon: 'none' })
    return
  }
  if (selectedRoles.value.includes('MERCHANT') && !merchantId.value.trim()) {
    uni.showToast({ title: '商户角色必须填写商户 ID', icon: 'none' })
    return
  }
  const confirm = await uni.showModal({ title: '确认角色变更', content: `将 ${selectedUser.value.displayName} 的主角色设为${roleLabel(primaryRole.value)}，操作将写入审计。` })
  if (!confirm.confirm) return
  acting.value = `roles:${selectedUser.value.id}`
  try {
    const command = {
      roles: selectedRoles.value,
      primaryRole: primaryRole.value,
      merchantId: selectedRoles.value.includes('MERCHANT') ? merchantId.value.trim() : undefined,
      reason: roleReason.value.trim(),
    }
    await withPendingCreationKey(`governance.user.roles.${selectedUser.value.id}`, command, (idempotencyKey) =>
      endpoints.setGovernanceUserRoles(selectedUser.value.id, { ...command, idempotencyKey }),
    )
    uni.showToast({ title: '角色已更新', icon: 'success' })
    await loadCurrentTab()
  } catch (cause: any) {
    uni.showToast({ title: cause?.message || '角色更新失败', icon: 'none' })
  } finally {
    acting.value = ''
  }
}

async function changeUserStatus(status: 'ACTIVE' | 'DISABLED') {
  if (!selectedUser.value || !canSuperviseUsers.value) return
  if (roleReason.value.trim().length < 2) {
    uni.showToast({ title: '请填写状态变更原因', icon: 'none' })
    return
  }
  const confirm = await uni.showModal({ title: status === 'ACTIVE' ? '确认启用' : '确认停用', content: `${selectedUser.value.displayName} ${status === 'ACTIVE' ? '将恢复登录' : '将立即失去登录能力'}。` })
  if (!confirm.confirm) return
  acting.value = `status:${selectedUser.value.id}`
  try {
    const command = { status, reason: roleReason.value.trim() }
    await withPendingCreationKey(`governance.user.status.${selectedUser.value.id}`, command, (idempotencyKey) =>
      endpoints.setGovernanceUserStatus(selectedUser.value.id, { ...command, idempotencyKey }),
    )
    uni.showToast({ title: status === 'ACTIVE' ? '已启用' : '已停用', icon: 'success' })
    await loadCurrentTab()
  } catch (cause: any) {
    uni.showToast({ title: cause?.message || '状态更新失败', icon: 'none' })
  } finally {
    acting.value = ''
  }
}

async function createParameter() {
  if (!canConfigure.value) return
  if (!parameterForm.key.trim() || !parameterForm.description.trim() || !parameterForm.effectiveFrom.trim()) {
    uni.showToast({ title: '请完整填写参数版本', icon: 'none' })
    return
  }
  let value: unknown
  try { value = parseParameterValue() }
  catch (cause: any) {
    uni.showToast({ title: cause?.message || '参数值格式错误', icon: 'none' })
    return
  }
  const confirm = await uni.showModal({ title: '发布参数版本', content: '新版本将按生效时间接替旧版本，历史订单仍使用原快照。' })
  if (!confirm.confirm) return
  acting.value = 'parameter'
  try {
    await endpoints.createParameter({ ...parameterForm, key: parameterForm.key.trim(), description: parameterForm.description.trim(), reason: parameterForm.description.trim(), value })
    parameterForm.key = ''
    parameterForm.value = ''
    parameterForm.description = ''
    uni.showToast({ title: '参数版本已创建', icon: 'success' })
    await loadCurrentTab()
  } catch (cause: any) {
    uni.showToast({ title: cause?.message || '参数创建失败', icon: 'none' })
  } finally {
    acting.value = ''
  }
}

async function actRisk(risk: any, action: 'review' | 'resolve' | 'dismiss') {
  const reason = (riskReasons[risk.id] || '').trim()
  if (reason.length < 2) {
    uni.showToast({ title: '请填写处理原因', icon: 'none' })
    return
  }
  const confirm = await uni.showModal({ title: '确认风险处理', content: `${risk.summary}\n操作：${action}` })
  if (!confirm.confirm) return
  acting.value = `risk:${risk.id}`
  try {
    const command = { riskId: risk.id, action, reason }
    await withPendingCreationKey(`governance.risk.${risk.id}.${action}`, command, (idempotencyKey) =>
      endpoints.transitionRiskEvent(risk.id, action, { reason, idempotencyKey }),
    )
    uni.showToast({ title: '风险状态已更新', icon: 'success' })
    await loadCurrentTab()
  } catch (cause: any) {
    uni.showToast({ title: cause?.message || '风险处理失败', icon: 'none' })
  } finally {
    acting.value = ''
  }
}

async function inspectErasure(request: any) {
  acting.value = `erasure:blockers:${request.id}`
  try {
    erasureBlockers[request.id] = await endpoints.dataErasureBlockers(request.id)
    if (!erasureBlockers[request.id].length) uni.showToast({ title: '业务已结清，可进入复核', icon: 'success' })
  } catch (cause: any) {
    uni.showToast({ title: cause?.message || '注销阻断项检查失败', icon: 'none' })
  } finally {
    acting.value = ''
  }
}

async function decideErasure(request: any, action: 'reject' | 'complete') {
  if (!canCompleteErasure.value || request.status !== 'REQUESTED') return
  const reason = (erasureReasons[request.id] || '').trim()
  if (reason.length < 2) {
    uni.showToast({ title: '请填写至少2个字的复核原因', icon: 'none' })
    return
  }
  if (action === 'complete') {
    await inspectErasure(request)
    if ((erasureBlockers[request.id] || []).length) {
      uni.showToast({ title: '仍有业务未结清，不能匿名化', icon: 'none' })
      return
    }
  }
  const confirm = await uni.showModal({
    title: action === 'complete' ? '不可逆匿名化确认' : '驳回注销申请',
    content: action === 'complete'
      ? '将永久移除微信标识、手机号、头像、姓名与监护学员身份信息；财务和审计历史只保留内部编号。此操作不可撤销。'
      : `将驳回 ${request.user?.displayName || request.userId} 的申请。`,
  })
  if (!confirm.confirm) return
  acting.value = `erasure:${action}:${request.id}`
  try {
    const command = { requestId: request.id, action, reason }
    await withPendingCreationKey(`privacy.erasure.${action}.${request.id}`, command, (idempotencyKey) =>
      endpoints.decideDataErasureRequest(request.id, action, { reason, idempotencyKey }),
    )
    uni.showToast({ title: action === 'complete' ? '匿名化已完成' : '申请已驳回', icon: 'success' })
    delete erasureBlockers[request.id]
    await loadCurrentTab()
  } catch (cause: any) {
    const blockers = cause?.data?.blockers || cause?.blockers
    if (Array.isArray(blockers)) erasureBlockers[request.id] = blockers
    uni.showToast({ title: cause?.message || '注销复核失败', icon: 'none' })
  } finally {
    acting.value = ''
  }
}

async function exportReport(scope: string) {
  if (isMockMode) {
    uni.showModal({ title: '需要远端模式', content: 'mock 模式不伪造 Excel。切换 remote 并登录财务/管理员后，导出会由服务端生成并写审计。', showCancel: false })
    return
  }
  acting.value = `export:${scope}`
  try {
    const file = await endpoints.downloadReport(scope)
    await uni.openDocument({ filePath: file.tempFilePath, showMenu: true })
  } catch (cause: any) {
    uni.showToast({ title: cause?.message || '导出失败', icon: 'none' })
  } finally {
    acting.value = ''
  }
}

onLoad((options) => {
  if (options?.focus === 'privacy' && visibleTabs.value.some((tab) => tab.key === 'privacy')) {
    activeTab.value = 'privacy'
  }
})

onShow(async () => {
  if (!visibleTabs.value.some((tab) => tab.key === activeTab.value)) activeTab.value = visibleTabs.value[0]?.key || 'risks'
  await loadCurrentTab()
})
</script>

<template>
  <OperationsFrame title="治理与审计" eyebrow="GOVERNANCE & CONTROL" role="管理员 / 财务" description="参数按生效时间版本化；员工微信身份、角色、风险、导出和审计均从这里闭环。">
    <scroll-view scroll-x class="tabs">
      <view class="tab-row">
        <button v-for="tab in visibleTabs" :key="tab.key" class="tab" :class="{ active: activeTab === tab.key }" @tap="switchTab(tab.key)">{{ tab.label }}</button>
      </view>
    </scroll-view>

    <view v-if="error" class="error card"><text>{{ error }}</text><button size="mini" @tap="loadCurrentTab">重试</button></view>
    <view v-if="loading" class="card muted">正在同步治理数据…</view>

    <template v-else-if="activeTab === 'users'">
      <view class="card toolbar"><input v-model="userKeyword" placeholder="姓名或手机号" /><button size="mini" @tap="loadCurrentTab">查询</button></view>
      <SectionEmpty v-if="!users.length" title="没有组织用户" description="首次微信登录后会生成会员账户，超级管理员可在此授予岗位角色。" />
      <view v-else class="split">
        <view class="list">
          <view v-for="user in users" :key="user.id" class="card row-card" :class="{ selected: user.id === selectedUserId }" @tap="selectUser(user)">
            <view><text class="strong">{{ user.displayName }}</text><text class="muted small">{{ user.phone || '未登记手机号' }} · {{ roleLabel(user.primaryRole) }}</text></view>
            <view class="right"><StatusBadge :status="user.status" /><text class="wechat" :class="{ bound: user.wechatBound }">{{ user.wechatBound ? '微信已绑定' : '微信未绑定' }}</text></view>
          </view>
        </view>
        <view v-if="selectedUser" class="card editor">
          <text class="section-title">{{ selectedUser.displayName }} · 岗位配置</text>
          <text class="muted small">真实员工先用微信首次登录生成账户，再由超级管理员在此授权；无需直接改数据库或复制 OpenID。</text>
          <view class="chips"><text v-for="option in roleOptions" :key="option.value" class="chip" :class="{ on: selectedRoles.includes(option.value) }" @tap="toggleRole(option.value)">{{ option.label }}</text></view>
          <picker :range="availablePrimaryRoles" range-key="label" @change="onPrimaryRoleChange"><view class="field">主角色：{{ roleLabel(primaryRole) }} ›</view></picker>
          <input v-if="selectedRoles.includes('MERCHANT')" v-model="merchantId" class="field" placeholder="关联商户 ID（必填）" />
          <textarea v-model="roleReason" class="textarea" maxlength="200" placeholder="角色或状态变更原因（必填）" />
          <view v-if="canSuperviseUsers" class="actions"><button class="primary" :loading="acting === `roles:${selectedUser.id}`" @tap="saveRoles">保存角色</button><button v-if="selectedUser.status === 'ACTIVE'" class="danger" @tap="changeUserStatus('DISABLED')">停用</button><button v-else @tap="changeUserStatus('ACTIVE')">启用</button></view>
          <text v-else class="notice">管理员可查看；只有超级管理员可变更角色和状态。</text>
        </view>
      </view>
    </template>

    <template v-else-if="activeTab === 'parameters'">
      <view v-if="canConfigure" class="card editor">
        <text class="section-title">创建生效版本</text>
        <input v-model="parameterForm.key" class="field" placeholder="参数键，如 booking.hold_minutes" />
        <picker :range="['STRING','INTEGER','DECIMAL','BOOLEAN','JSON']" @change="parameterForm.type = ['STRING','INTEGER','DECIMAL','BOOLEAN','JSON'][Number($event.detail.value)]"><view class="field">类型：{{ parameterForm.type }} ›</view></picker>
        <textarea v-model="parameterForm.value" class="textarea" placeholder="参数值；JSON 需填写合法 JSON" />
        <input v-model="parameterForm.description" class="field" placeholder="用途与变更说明" />
        <input v-model="parameterForm.effectiveFrom" class="field" placeholder="ISO 生效时间" />
        <label class="check"><checkbox :checked="parameterForm.locked" @tap="parameterForm.locked = !parameterForm.locked" />锁定版本（仅超级管理员可继续变更）</label>
        <button class="primary" :loading="acting === 'parameter'" @tap="createParameter">发布参数版本</button>
      </view>
      <SectionEmpty v-if="!parameters.length" title="暂无生效参数" description="参数创建后按 key 与生效时间选择当前版本。" />
      <view v-for="item in parameters" :key="item.id" class="card data-card"><view class="row"><text class="strong">{{ item.key }}</text><StatusBadge :status="item.locked ? 'LOCKED' : 'ACTIVE'" /></view><text class="value">{{ JSON.stringify(item.value) }}</text><text class="muted small">{{ item.description }} · 生效 {{ shortDate(item.effectiveFrom) }}</text></view>
    </template>

    <template v-else-if="activeTab === 'risks'">
      <SectionEmpty v-if="!risks.length" title="暂无风险事件" description="支付、退款、券码等规则触发的异常会进入此队列。" />
      <view v-for="risk in risks" :key="risk.id" class="card data-card"><view class="row"><view><text class="strong">{{ risk.summary }}</text><text class="muted small">{{ risk.ruleCode }} · {{ risk.objectType }} · {{ shortDate(risk.createdAt) }}</text></view><StatusBadge :status="risk.status" /></view><text class="risk-level">风险等级：{{ risk.severity }}</text><input v-if="!['RESOLVED','DISMISSED'].includes(risk.status)" v-model="riskReasons[risk.id]" class="field" placeholder="处理原因（必填）" /><view v-if="!['RESOLVED','DISMISSED'].includes(risk.status)" class="actions"><button v-if="risk.status === 'OPEN'" size="mini" :loading="acting === `risk:${risk.id}`" @tap="actRisk(risk, 'review')">进入复核</button><button v-if="canResolveRisk" size="mini" class="primary" @tap="actRisk(risk, 'resolve')">确认解决</button><button v-if="canResolveRisk" size="mini" @tap="actRisk(risk, 'dismiss')">排除误报</button></view></view>
    </template>

    <template v-else-if="activeTab === 'audit'">
      <view class="card toolbar"><input v-model="auditObjectType" placeholder="对象类型，如 Order" /><button size="mini" @tap="loadCurrentTab">筛选</button></view>
      <SectionEmpty v-if="!auditLogs.length" title="没有审计日志" description="有权限的业务状态动作会记录操作者、前后值和原因。" />
      <view v-for="item in auditLogs" :key="item.id" class="card data-card"><view class="row"><text class="strong">{{ item.action }}</text><StatusBadge :status="item.result || 'SUCCESS'" /></view><text class="muted small">{{ item.objectType }} / {{ item.objectId || '-' }} · {{ item.actor?.displayName || '系统' }} · {{ shortDate(item.createdAt) }}</text><text v-if="item.reason" class="reason">原因：{{ item.reason }}</text></view>
    </template>

    <template v-else-if="activeTab === 'privacy'">
      <view class="card notice">注销不是物理删除。先停用账号、移交岗位并结清余额/订单/退款/课包/报名/券，再由非申请人的超级管理员复核；历史财务凭证和审计仅保留匿名内部编号。</view>
      <SectionEmpty v-if="!erasureRequests.length" title="暂无注销申请" description="会员从个人中心提交后会进入这里；管理员可检查阻断项，只有超级管理员可完成不可逆匿名化。" />
      <view v-for="request in erasureRequests" :key="request.id" class="card data-card">
        <view class="row"><view><text class="strong">{{ request.user?.displayName || request.userId }}</text><text class="muted small">{{ request.user?.phone || '手机号未登记/已去除' }} · 申请于 {{ shortDate(request.requestedAt) }}</text></view><StatusBadge :status="request.status" /></view>
        <text class="reason">申请原因：{{ request.reason }}</text>
        <text v-if="request.reviewReason" class="reason">复核原因：{{ request.reviewReason }}</text>
        <view v-if="request.status === 'REQUESTED'" class="actions"><button size="mini" :loading="acting === `erasure:blockers:${request.id}`" @tap="inspectErasure(request)">检查结清条件</button></view>
        <view v-if="erasureBlockers[request.id]?.length" class="blocker-list"><text v-for="item in erasureBlockers[request.id]" :key="item.code" class="blocker">{{ item.message }}（{{ item.count }}）</text></view>
        <template v-if="request.status === 'REQUESTED' && canCompleteErasure">
          <textarea v-model="erasureReasons[request.id]" class="textarea" maxlength="300" placeholder="复核原因（必填）" />
          <view class="actions"><button size="mini" @tap="decideErasure(request, 'reject')">驳回</button><button size="mini" class="danger" :disabled="Boolean(erasureBlockers[request.id]?.length)" :loading="acting === `erasure:complete:${request.id}`" @tap="decideErasure(request, 'complete')">完成匿名化</button></view>
        </template>
        <text v-else-if="request.status === 'REQUESTED'" class="notice">管理员可检查；只有超级管理员可驳回或完成匿名化。</text>
      </view>
    </template>

    <template v-else>
      <view class="card notice">导出由 API 生成真实 XLSX 并写入审计。mock 模式不会伪造报表；remote 模式下可直接打开或转发。</view>
      <view class="export-grid"><button v-for="scope in exportScopes" :key="scope[0]" class="export" :loading="acting === `export:${scope[0]}`" @tap="exportReport(scope[0])">{{ scope[1] }}</button></view>
    </template>
  </OperationsFrame>
</template>

<style scoped>
.tabs{margin:22rpx 0 16rpx}.tab-row{display:flex;gap:12rpx;white-space:nowrap}.tab{display:inline-flex;margin:0;padding:0 24rpx;height:64rpx;line-height:64rpx;border:0;border-radius:999rpx;background:#fff;color:#456255;font-size:23rpx}.tab::after{border:0}.tab.active{background:#17653d;color:#fff}.card{margin-top:16rpx;padding:24rpx;border-radius:22rpx;background:#fff;box-shadow:0 8rpx 22rpx rgba(18,61,39,.05)}.toolbar,.row,.actions{display:flex;align-items:center;gap:14rpx}.toolbar input{flex:1}.error{display:flex;align-items:center;justify-content:space-between;color:#9e2f2f;background:#fff1f0}.split{display:grid;gap:16rpx}.list{display:grid;gap:2rpx}.row-card{display:flex;justify-content:space-between;align-items:center;border:2rpx solid transparent}.row-card.selected{border-color:#c8a94f;background:#fffdf3}.right{text-align:right}.strong,.section-title{display:block;font-weight:800;color:#193d2b}.section-title{font-size:29rpx;margin-bottom:12rpx}.muted{color:#718078}.small{display:block;margin-top:7rpx;font-size:21rpx;line-height:1.5}.wechat{display:block;margin-top:7rpx;color:#a05b32;font-size:19rpx}.wechat.bound{color:#17653d}.chips{display:flex;flex-wrap:wrap;gap:10rpx;margin:20rpx 0}.chip{padding:10rpx 16rpx;border-radius:999rpx;background:#edf1ee;color:#627269;font-size:21rpx}.chip.on{background:#17653d;color:#fff}.field,.textarea{box-sizing:border-box;width:100%;margin-top:14rpx;padding:18rpx 20rpx;border:1rpx solid #dbe3de;border-radius:14rpx;background:#fbfcfb;font-size:23rpx}.textarea{height:128rpx}.actions{flex-wrap:wrap;margin-top:18rpx}.actions button{margin:0}.primary{background:#17653d;color:#fff}.danger{background:#a53a32;color:#fff}.notice{color:#6d5a24;background:#fff7df;font-size:22rpx;line-height:1.6}.check{display:flex;align-items:center;margin:16rpx 0;color:#5f6c65;font-size:22rpx}.data-card .row{justify-content:space-between;align-items:flex-start}.value{display:block;margin:12rpx 0;padding:12rpx;border-radius:10rpx;background:#f4f7f4;color:#365244;font-family:monospace;font-size:21rpx;word-break:break-all}.reason,.risk-level{display:block;margin-top:12rpx;color:#765d24;font-size:22rpx}.export-grid{display:grid;grid-template-columns:1fr 1fr;gap:14rpx;margin-top:16rpx}.export{margin:0;background:#fff;color:#17653d;font-size:23rpx}
.blocker-list{display:grid;gap:8rpx;margin-top:14rpx;padding:16rpx;border-radius:12rpx;background:#fff1f0}.blocker{color:#9e2f2f;font-size:21rpx;line-height:1.5}
</style>
