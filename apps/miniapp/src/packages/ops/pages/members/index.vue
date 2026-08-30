<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import OperationsFrame from '../../../../components/OperationsFrame.vue'
import MetricCard from '../../../../components/MetricCard.vue'
import { endpoints } from '../../../../services/api'
import { useSessionStore } from '../../../../stores/session'
import { withPendingCreationKey } from '../../../../utils/pending-creation-key'

const session = useSessionStore()
const members = ref<any[]>([])
const leads = ref<any[]>([])
const hostApplications = ref<any[]>([])
const customer = ref<any>(null)
const query = ref('')
const loading = ref(false)
const selectedId = ref('')
const tab = ref<'members' | 'leads'>('members')
const sourceOptions = [
  { value: 'STORE_VISIT', label: '到店' }, { value: 'DOUYIN', label: '抖音' },
  { value: 'MEITUAN', label: '美团' }, { value: 'REFERRAL', label: '直接推荐' },
  { value: 'ALLIANCE', label: '联盟商户' }, { value: 'OTHER', label: '其他' },
]
const createForm = reactive({ displayName: '', phone: '', sourceChannel: 'STORE_VISIT', campaign: '' })
const leadLabels: Record<string, string> = {
  NEW: '新线索', CONTACTING: '跟进中', TRIAL_RESERVED: '已约体验', ATTENDED: '已到店',
  CONVERTED: '已转会员', LOST: '已流失', ARCHIVED: '已归档',
}
const canViewLeads = computed(() => session.roles.some((role) => ['FRONT_DESK', 'COACH', 'ADMIN', 'SUPER_ADMIN'].includes(role)))
const canWriteLeads = computed(() => session.roles.some((role) => ['FRONT_DESK', 'ADMIN', 'SUPER_ADMIN'].includes(role)))
const canReviewHosts = computed(() => session.roles.some((role) => ['ADMIN', 'SUPER_ADMIN'].includes(role)))
const canRequestAdjustments = computed(() => session.roles.some((role) => ['FINANCE', 'ADMIN', 'SUPER_ADMIN'].includes(role)))
const filteredMembers = computed(() => {
  const keyword = query.value.trim().toLowerCase()
  if (!keyword) return members.value
  return members.value.filter((member) => `${member.displayName || ''}${member.phone || ''}`.toLowerCase().includes(keyword))
})
const filteredLeads = computed(() => {
  const keyword = query.value.trim().toLowerCase()
  if (!keyword) return leads.value
  return leads.value.filter((lead) => `${lead.displayName || ''}${lead.phone || ''}${lead.campaign || ''}`.toLowerCase().includes(keyword))
})
const metrics = computed(() => [
  ['会员总数', String(members.value.length), '当前服务范围'],
  ['活跃线索', String(leads.value.filter((lead) => !['CONVERTED', 'LOST', 'ARCHIVED'].includes(lead.status)).length), '待持续推进'],
  ['SLA逾期', String(leads.value.filter((lead) => !['CONVERTED', 'LOST', 'ARCHIVED'].includes(lead.status) && new Date(lead.slaDueAt).getTime() < Date.now()).length), '优先处理'],
  ['客户360', selectedId.value ? '已载入' : '待选择', '角色数据隔离'],
])

async function load() {
  await session.hydrate()
  loading.value = true
  try {
    const [memberResult, leadResult, hostResult] = await Promise.all([
      endpoints.members(),
      canViewLeads.value ? endpoints.customerLeads() : Promise.resolve({ items: [] }),
      canReviewHosts.value ? endpoints.hostApplications() : Promise.resolve([]),
    ])
    members.value = memberResult.items || []
    leads.value = leadResult.items || []
    hostApplications.value = hostResult || []
  } catch (cause: any) {
    uni.showToast({ title: cause.message || '客户数据加载失败', icon: 'none' })
  } finally { loading.value = false }
}

async function selectMember(member: any) {
  selectedId.value = member.id
  uni.setStorageSync('yanqing_selected_member', member)
  try {
    customer.value = await endpoints.member360(member.id)
    uni.showToast({ title: `已载入 ${member.displayName}`, icon: 'success' })
  } catch (cause: any) { uni.showToast({ title: cause.message || '客户全景加载失败', icon: 'none' }) }
}

async function createLead() {
  if (!createForm.displayName.trim()) return uni.showToast({ title: '请填写客户姓名', icon: 'none' })
  try {
    await endpoints.createCustomerLead({ ...createForm })
    Object.assign(createForm, { displayName: '', phone: '', sourceChannel: 'STORE_VISIT', campaign: '' })
    leads.value = (await endpoints.customerLeads()).items || []
    uni.showToast({ title: '线索已创建', icon: 'success' })
  } catch (cause: any) { uni.showToast({ title: cause.message || '创建失败', icon: 'none' }) }
}

async function refreshLeads(message: string) {
  leads.value = (await endpoints.customerLeads()).items || []
  uni.showToast({ title: message, icon: 'success' })
}

async function claim(lead: any) {
  try { await endpoints.claimCustomerLead(lead.id); await refreshLeads('已认领') }
  catch (cause: any) { uni.showToast({ title: cause.message || '认领失败', icon: 'none' }) }
}

async function assign(lead: any) {
  const result = await uni.showModal({ title: '分配负责人', content: '输入员工用户ID', editable: true, placeholderText: '例如 user-coach' })
  if (!result.confirm || !result.content?.trim()) return
  try { await endpoints.assignCustomerLead(lead.id, result.content.trim()); await refreshLeads('已分配') }
  catch (cause: any) { uni.showToast({ title: cause.message || '分配失败', icon: 'none' }) }
}

async function followUp(lead: any) {
  const result = await uni.showModal({ title: '追加跟进', content: '', editable: true, placeholderText: '填写本次沟通结果' })
  if (!result.confirm || !result.content?.trim()) return
  const nextStatus: Record<string, string> = { NEW: 'CONTACTING', CONTACTING: 'TRIAL_RESERVED', TRIAL_RESERVED: 'ATTENDED', ATTENDED: 'ATTENDED' }
  try {
    await endpoints.followUpCustomerLead(lead.id, { kind: 'WECHAT', content: result.content.trim(), nextStatus: nextStatus[lead.status] || lead.status })
    await refreshLeads('跟进已追加')
  } catch (cause: any) { uni.showToast({ title: cause.message || '跟进失败', icon: 'none' }) }
}

async function convert(lead: any) {
  if (!selectedId.value) return uni.showToast({ title: '请先在会员页选择转换目标', icon: 'none' })
  try { await endpoints.convertCustomerLead(lead.id, selectedId.value); await refreshLeads('已转为会员') }
  catch (cause: any) { uni.showToast({ title: cause.message || '转换失败', icon: 'none' }) }
}

async function lose(lead: any) {
  const result = await uni.showModal({ title: '标记流失', content: '', editable: true, placeholderText: '必须填写流失原因' })
  if (!result.confirm || !result.content?.trim()) return
  try { await endpoints.loseCustomerLead(lead.id, result.content.trim()); await refreshLeads('已标记流失') }
  catch (cause: any) { uni.showToast({ title: cause.message || '操作失败', icon: 'none' }) }
}

async function reviewHost(application: any, approved: boolean) {
  const result = await uni.showModal({
    title: approved ? '批准主理人' : '驳回主理人', content: '', editable: true,
    placeholderText: approved ? '填写审批意见（可选）' : '填写驳回原因（必填）',
  })
  if (!result.confirm || (!approved && (result.content || '').trim().length < 2)) return
  try {
    if (approved) await endpoints.approveHost(application.userId, { reason: result.content?.trim() || undefined })
    else await endpoints.rejectHost(application.userId, result.content!.trim())
    hostApplications.value = await endpoints.hostApplications()
    uni.showToast({ title: approved ? '申请已批准' : '申请已驳回', icon: 'success' })
  } catch (cause: any) { uni.showToast({ title: cause.message || '审批失败', icon: 'none' }) }
}

async function requestAccountAdjustment() {
  const accounts = customer.value?.accounts || []
  if (!selectedId.value || !accounts.length) return uni.showToast({ title: '客户账户未载入', icon: 'none' })
  let selected: any
  try {
    const result = await uni.showActionSheet({ itemList: accounts.map((account: any) => `${account.type} · 当前 ${account.balance}`) })
    selected = accounts[result.tapIndex]
  } catch { return }
  const amountInput = await uni.showModal({
    title: `调整 ${selected.type}`,
    content: '', editable: true,
    placeholderText: ['CASH_PRINCIPAL', 'GIFT_BALANCE'].includes(selected.type) ? '输入增减金额（元，如 -20）' : '输入增减数量（如 -20）',
  })
  if (!amountInput.confirm) return
  const raw = amountInput.content?.trim() || ''
  const moneyAccount = ['CASH_PRINCIPAL', 'GIFT_BALANCE'].includes(selected.type)
  if (moneyAccount ? !/^-?\d+(\.\d{1,2})?$/.test(raw) : !/^-?\d+$/.test(raw)) {
    return uni.showToast({ title: '调整数额格式不正确', icon: 'none' })
  }
  const amount = moneyAccount ? Math.round(Number(raw) * 100) : Number(raw)
  if (!Number.isSafeInteger(amount) || amount === 0) return uni.showToast({ title: '调整数额不能为0', icon: 'none' })
  const reasonResult = await uni.showModal({ title: '填写调整原因', content: '', editable: true, placeholderText: '至少2个字，复核人可见' })
  const reason = reasonResult.content?.trim() || ''
  if (!reasonResult.confirm || reason.length < 2) return
  const command = { memberId: selectedId.value, accountType: selected.type, amount, reason }
  try {
    await withPendingCreationKey(`account.adjustment.${selectedId.value}.${selected.type}`, command, (idempotencyKey) =>
      endpoints.createAccountAdjustment(selectedId.value, { accountType: selected.type, amount, reason, idempotencyKey }),
    )
    uni.showModal({ title: '申请已提交', content: '余额尚未变化，需由另一名财务或管理员复核后才会入账。', showCancel: false })
  } catch (cause: any) { uni.showToast({ title: cause.message || '调整申请失败', icon: 'none' }) }
}

function changeSource(event: any) {
  createForm.sourceChannel = sourceOptions[Number(event.detail.value)]?.value || 'STORE_VISIT'
}

onShow(load)
</script>

<template>
  <OperationsFrame title="客户经营" eyebrow="CRM & MEMBER 360" role="前台 / 教练 / 财务" description="线索先进入责任队列，跟进记录只追加；转化后关联现有会员并进入客户360。">
    <view class="metric-grid"><MetricCard v-for="item in metrics" :key="item[0]" :label="item[0]" :value="item[1]" :note="item[2]" /></view>
    <view class="tabs card"><button class="tab" :class="{ active: tab === 'members' }" @tap="tab = 'members'">会员360</button><button v-if="canViewLeads" class="tab" :class="{ active: tab === 'leads' }" @tap="tab = 'leads'">客户线索</button></view>
    <view class="search-card card"><input v-model="query" class="input" :placeholder="tab === 'members' ? '输入姓名或手机号查询会员' : '搜索姓名、来源活动'" confirm-type="search" /></view>

    <template v-if="tab === 'members'">
      <view v-if="canReviewHosts" class="card host-queue">
        <view class="section-title">主理人申请 <text class="section-note">{{ hostApplications.length }} 条待审批</text></view>
        <view v-for="application in hostApplications" :key="application.id" class="host-row">
          <view><text class="member-name">{{ application.user?.displayName }}</text><text class="muted">{{ application.user?.phone || '未登记手机号' }} · 到店 {{ application.user?.memberProfile?.visitCount || 0 }} 次</text></view>
          <view class="actions"><button size="mini" @tap="reviewHost(application, true)">批准</button><button size="mini" @tap="reviewHost(application, false)">驳回</button></view>
        </view>
        <text v-if="!hostApplications.length" class="muted">当前没有待审批主理人申请</text>
      </view>
      <view class="section-title">会员列表 <text class="section-note">{{ loading ? '同步中' : `${filteredMembers.length} 人` }}</text></view>
      <view v-for="member in filteredMembers" :key="member.id" class="card member-row" :class="{ selected: selectedId === member.id }" @tap="selectMember(member)"><view><text class="member-name">{{ member.displayName || '未命名会员' }}</text><text class="muted">{{ member.phone || '联系方式按角色隐藏' }} · {{ member.level || member.memberProfile?.level || '普通会员' }}</text></view><text class="select-mark">{{ selectedId === member.id ? '已载入' : '查看360' }}</text></view>
      <view v-if="customer" class="card customer-card">
        <view class="section-title">{{ customer.member?.displayName }} · 客户360</view>
        <text class="muted">订单 {{ customer.recentOrders?.length || 0 }} · 培训 {{ customer.recentTraining?.length || 0 }} · 球局 {{ customer.recentGames?.length || 0 }} · 赛事 {{ customer.recentEvents?.length || 0 }} · 券 {{ customer.recentCoupons?.length || 0 }}</text>
        <view v-if="customer.accounts?.length" class="account-grid"><view v-for="account in customer.accounts" :key="account.id" class="account"><text>{{ account.type }}</text><text class="account-value">{{ account.balance }}</text></view></view>
        <button v-if="canRequestAdjustments && customer.accounts?.length" class="secondary adjustment-button" @tap="requestAccountAdjustment">提交账户调整申请</button>
        <text v-if="customer.financialsRedacted" class="privacy">教练视图仅展示本班培训信息，财务、订单、账户及联系方式已隐藏。</text>
      </view>
    </template>

    <template v-else>
      <view v-if="canWriteLeads" class="card lead-form">
        <view class="section-title">新建客户线索</view>
        <input v-model="createForm.displayName" class="input field" placeholder="客户姓名（必填）" />
        <input v-model="createForm.phone" class="input field" type="number" placeholder="手机号" />
        <picker :range="sourceOptions" range-key="label" @change="changeSource"><view class="picker field">来源：{{ sourceOptions.find((item) => item.value === createForm.sourceChannel)?.label }}</view></picker>
        <input v-model="createForm.campaign" class="input field" placeholder="来源活动，例如周末体验课" />
        <button class="primary" @tap="createLead">建立线索</button>
      </view>
      <view class="section-title">线索队列 <text class="section-note">{{ filteredLeads.length }} 条</text></view>
      <view v-for="lead in filteredLeads" :key="lead.id" class="card lead-card">
        <view class="lead-head"><view><text class="member-name">{{ lead.displayName }}</text><text class="muted">{{ lead.phone || '联系方式按角色隐藏' }} · {{ lead.campaign || lead.sourceChannel }}</text></view><text class="lead-status">{{ leadLabels[lead.status] || lead.status }}</text></view>
        <text class="muted block">负责人：{{ lead.owner?.displayName || '待认领' }} · 下次跟进：{{ lead.nextFollowUpAt ? new Date(lead.nextFollowUpAt).toLocaleString() : '未安排' }}</text>
        <text v-if="lead.followUps?.[0]" class="follow-up">最近：{{ lead.followUps[0].content }}</text>
        <view v-if="canWriteLeads && !['CONVERTED', 'LOST', 'ARCHIVED'].includes(lead.status)" class="actions"><button size="mini" @tap="claim(lead)">认领</button><button size="mini" @tap="assign(lead)">分配</button><button size="mini" @tap="followUp(lead)">跟进推进</button><button size="mini" @tap="convert(lead)">转会员</button><button size="mini" @tap="lose(lead)">流失</button></view>
      </view>
    </template>
    <view class="card boundary"><text class="muted">线索跟进记录不可删除；教练仅能查看分配给自己或本班会员关联线索，且看不到账户和联系方式。</text></view>
  </OperationsFrame>
</template>

<style scoped>
.metric-grid { display:grid; grid-template-columns:repeat(2,1fr); gap:14rpx; margin-top:22rpx; }.tabs { display:flex; gap:12rpx; margin-top:22rpx; padding:10rpx; }.tab { flex:1; margin:0; background:#f3f5f3; color:#5f6e65; }.tab.active { color:#fff; background:#17653d; }.search-card,.customer-card,.lead-form,.host-queue { margin-top:18rpx; padding:20rpx; }.section-note { color:#758079; font-size:22rpx; font-weight:400; }.member-row,.lead-card { margin-top:14rpx; padding:22rpx 24rpx; }.member-row { display:flex; align-items:center; justify-content:space-between; gap:12rpx; }.member-row.selected { border-color:#17653d; background:#f1f8f2; }.member-name { display:block; margin-bottom:8rpx; font-size:29rpx; font-weight:800; }.select-mark,.lead-status { color:#17653d; font-size:23rpx; }.account-grid { display:grid; grid-template-columns:repeat(2,1fr); gap:10rpx; margin-top:18rpx; }.account { padding:14rpx; background:#f4f7f4; border-radius:12rpx; font-size:20rpx; }.account-value { display:block; margin-top:6rpx; font-size:28rpx; font-weight:800; }.privacy,.follow-up { display:block; margin-top:14rpx; color:#8a6030; font-size:22rpx; line-height:1.6; }.field { margin-top:12rpx; }.picker { padding:20rpx; border:1rpx solid #dce5df; border-radius:12rpx; color:#405449; }.lead-head,.host-row { display:flex; justify-content:space-between; gap:12rpx; }.host-row { align-items:center; padding:18rpx 0; border-bottom:1rpx solid #edf1ee; }.block { display:block; margin-top:12rpx; }.actions { display:flex; flex-wrap:wrap; gap:10rpx; margin-top:16rpx; }.host-row .actions { margin-top:0; }.actions button { margin:0; }.boundary { margin-top:22rpx; line-height:1.7; }
.adjustment-button { margin-top:16rpx; }
</style>
