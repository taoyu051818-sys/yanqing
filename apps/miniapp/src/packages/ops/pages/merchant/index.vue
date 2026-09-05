<script setup lang="ts">
import { computed, nextTick, reactive, ref } from 'vue'
import { onLoad, onShow, onShareAppMessage } from '@dcloudio/uni-app'
import OperationsFrame from '../../components/OperationsFrame.vue'
import OperationTask from '../../components/OperationTask.vue'
import { useOperationTask, reasonField } from '../../components/operation-task'
import { couponClaimPath, couponCodeFromInput } from '../../../../utils/coupon-invitation'
import { SHARE_CARD_IMAGES } from '../../../../config/share'
import MetricCard from '../../../../components/MetricCard.vue'
import { hasOperationsAccess } from '../../../../config/operations'
import { endpoints } from '../../../../services/api'
import { useSessionStore } from '../../../../stores/session'
import { idempotencyKey, money } from '../../../../utils/format'
import { withPendingCreationKey } from '../../../../utils/pending-creation-key'

const task = useOperationTask()
const session = useSessionStore()
const merchants = ref<any[]>([])
const templates = ref<any[]>([])
const settlements = ref<any[]>([])
const selectedMerchantId = ref('')
const loading = ref(false)
const actionKey = ref('')
const loadError = ref('')
const actionError = ref('')
const lastRedeemedCode = ref('')
const batchVisible = ref(20)
const batchShareError = ref('')
const generatedBatch = ref<{ templateName: string; codes: string[] } | null>(null)
const showMerchantForm = ref(false)
const showTemplateForm = ref(false)
const dataScopeKey = ref('')
const managementView = ref('')
const managementViewHandled = ref(false)

const isAdmin = computed(() => session.roles.some((role) => ['ADMIN', 'SUPER_ADMIN'].includes(role)))
const isMerchant = computed(() => session.roles.includes('MERCHANT'))
const canRedeem = computed(() => session.roles.some((role) => ['MERCHANT', 'FRONT_DESK', 'ADMIN', 'SUPER_ADMIN'].includes(role)))
const canViewSettlements = computed(() => session.roles.some((role) => ['MERCHANT', 'FINANCE', 'ADMIN', 'SUPER_ADMIN'].includes(role)))
const canViewTemplates = computed(() => isMerchant.value || isAdmin.value)
const canCreateCampaign = computed(() => isAdmin.value)
const canIssueCodes = computed(() => isMerchant.value || isAdmin.value)
const canDecideSettlement = computed(() => isMerchant.value || isAdmin.value)

const merchant = computed(() =>
  merchants.value.find((item) => item.id === selectedMerchantId.value) || merchants.value[0] || null,
)
const merchantIsActive = computed(() => Boolean(
  merchant.value && (!merchant.value.status || merchant.value.status === 'ACTIVE'),
))
const merchantNames = computed(() => merchants.value.map((item) => `${item.name} · ${item.category || '联盟商户'}`))
const merchantTemplates = computed(() => templates.value.filter((item) => item.merchantId === merchant.value?.id))
const merchantSettlements = computed(() => settlements.value.filter((item) => item.merchantId === merchant.value?.id))
const pendingSettlements = computed(() => merchantSettlements.value.filter((item) => item.status === 'PENDING_CONFIRMATION'))

const roleLabel = computed(() => {
  if (session.roles.includes('SUPER_ADMIN')) return '超级管理员'
  if (session.roles.includes('ADMIN')) return '联盟运营 / 管理员'
  if (session.roles.includes('FINANCE')) return '财务只读协作'
  if (session.roles.includes('MERCHANT')) return '商户'
  return '前台代核销'
})
const pageDescription = computed(() => {
  if (isAdmin.value) return '在同一领域维护合作商户、券活动和唯一券发行，并查看商户结算交接。'
  if (isMerchant.value) return '仅查看本店券活动和结算单；核销本店券码，并对待确认账单确认或提出争议。'
  if (session.roles.includes('FINANCE')) return '查看联盟商户与结算状态；提交和入账仍在财务结算中心完成。'
  return '前台只代为核销匹配商户的券码，不维护合同、券活动或结算。'
})

const metrics = computed(() => [
  ['累计核销', String(merchant.value?._count?.couponRedemptions || 0), '当前商户'],
  ['券活动', String(merchantTemplates.value.length), '有效与历史模板'],
  ['待商户确认', String(pendingSettlements.value.length), '确认或争议'],
  ['账户隔离', '已启用', '商户自行收款'],
])

const merchantForm = reactive({
  code: '', name: '', category: '', level: 'MEMBER_BENEFIT',
  contactName: '', contactPhone: '', settlementMode: 'PER_REDEMPTION', settlementAmount: '10',
})
const templateForm = reactive({
  code: '', name: '', activityName: '', benefitDescription: '', faceValue: '20', allowVenueBooking: false,
  validFrom: shanghaiDate(), validTo: shanghaiDate(30), claimLimitPerUser: '1', issueLimit: '100',
})
const merchantLevels = [
  { value: 'TRAFFIC_PARTNER', label: '流量合作' },
  { value: 'MEMBER_BENEFIT', label: '会员权益' },
  { value: 'SPONSOR', label: '赛事赞助' },
]
const settlementModes = [
  { value: 'FIXED', label: '周期固定费用' },
  { value: 'PER_REDEMPTION', label: '按核销次数' },
  { value: 'PER_NEW_CUSTOMER', label: '按有效新客' },
]
const settlementLabels: Record<string, string> = {
  DRAFT: '草稿', PENDING_CONFIRMATION: '待商户确认', CONFIRMED: '商户已确认', SETTLED: '已结算', VOID: '已作废',
}

function shanghaiDate(offsetDays = 0) {
  const value = new Date(Date.now() + offsetDays * 86_400_000)
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(value)
  const fields = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return `${fields.year}-${fields.month}-${fields.day}`
}

function cents(value: string, label: string) {
  const input = value.trim()
  if (!/^\d+(\.\d{1,2})?$/.test(input)) throw new Error(`${label}格式不正确`)
  const result = Math.round(Number(input) * 100)
  if (!Number.isSafeInteger(result) || result < 0) throw new Error(`${label}必须为非负金额`)
  return result
}

function positiveInteger(value: string, label: string, maximum: number) {
  const result = Number(value)
  if (!Number.isInteger(result) || result < 1 || result > maximum) {
    throw new Error(`${label}必须为1-${maximum}的整数`)
  }
  return result
}

function displayPeriod(item: any) {
  const format = (value: string) => new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(value))
  return `${format(item.periodStart)} — ${format(item.periodEnd)}`
}

function changeMerchant(event: any) {
  selectedMerchantId.value = merchants.value[Number(event.detail.value)]?.id || ''
  generatedBatch.value = null
  actionError.value = ''
}

async function load() {
  await session.hydrate()
  if (!hasOperationsAccess(session.roles, 'alliance')) return
  const nextScopeKey = `${session.user?.id || 'anonymous'}:${[...session.roles].sort().join(',')}`
  if (dataScopeKey.value && dataScopeKey.value !== nextScopeKey) {
    selectedMerchantId.value = ''
    generatedBatch.value = null
    lastRedeemedCode.value = ''
  }
  dataScopeKey.value = nextScopeKey
  loading.value = true
  loadError.value = ''
  merchants.value = []
  templates.value = []
  settlements.value = []
  const results = await Promise.allSettled([
    endpoints.merchants(),
    canViewTemplates.value ? endpoints.couponTemplates() : Promise.resolve([]),
    canViewSettlements.value ? endpoints.allianceSettlements() : Promise.resolve([]),
  ])
  if (results[0].status === 'fulfilled') merchants.value = results[0].value || []
  if (results[1].status === 'fulfilled') templates.value = results[1].value || []
  if (results[2].status === 'fulfilled') settlements.value = results[2].value || []
  const errors = results
    .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
    .map((result) => result.reason?.message || '联盟数据同步失败')
  loadError.value = errors.join('；')
  if (!merchants.value.some((item) => item.id === selectedMerchantId.value)) {
    selectedMerchantId.value = merchants.value[0]?.id || ''
  }
  loading.value = false
  if (managementView.value === 'coupons' && !managementViewHandled.value) {
    managementViewHandled.value = true
    showTemplateForm.value = canCreateCampaign.value && merchantIsActive.value
    await nextTick()
    uni.pageScrollTo({ selector: '#coupon-management', duration: 280 })
  }
}

async function runAction(key: string, action: () => Promise<unknown>, message: string) {
  if (actionKey.value) return
  actionKey.value = key
  actionError.value = ''
  try {
    await action()
    uni.showToast({ title: message, icon: 'success' })
    await load()
  } catch (cause: any) {
    actionError.value = cause?.message || '操作未完成，请刷新后重试'
  } finally {
    actionKey.value = ''
  }
}

function redeem(code?: string) {
  if (!canRedeem.value || !merchant.value || !merchantIsActive.value) return
  const merchantId = merchant.value.id
  task.start({ title: '核销消费券', description: merchant.value.name + ' · 核对券与实际消费金额后确认。券核销后不可重复使用。',
    confirmText: '确认核销一次', fields: [
      { key: 'code', label: '消费券', initial: code?.trim(), hint: '优先使用扫码带入；无法扫码时可填写顾客出示的券码。', max: 128 },
      { key: 'amount', kind: 'money', label: '实际成交金额（元）', initial: '0', hint: '仅作消费归因，不会自动扣款。无成交金额填0。' },
    ],
    submit: async values => {
      const attributedAmountCents = cents(values.amount, '成交金额')
      const command = { code: values.code, merchantId, attributedAmountCents }
      await withPendingCreationKey('merchant.redeem.' + values.code, command, idempotencyKey => endpoints.redeemCoupon({ ...command, idempotencyKey }))
      lastRedeemedCode.value = values.code
      await load()
      return '核销成功，已计入商户核销记录，券不可再次使用。'
    },
  })
}

async function scan() {
  try {
    const result = await uni.scanCode({ scanType: ['qrCode', 'barCode'] })
    const code = couponCodeFromInput(result.result)
    if (!code) throw new Error('未识别到有效领取卡，请扫描本平台卡券或选择手动输入')
    await redeem(code)
  } catch (cause: any) {
    if (cause?.errMsg?.includes('cancel')) return
    actionError.value = cause?.message || '扫码失败，可改用手动输入'
  }
}

async function confirmSettlement(item: any) {
  const confirmed = await uni.showModal({
    title: '确认联盟结算单',
    content: `${item.merchant?.name || merchant.value?.name} · ${displayPeriod(item)}\n应结服务费 ${money(item.cooperationFeeCents)}。确认后由财务完成入账。`,
    confirmText: '确认账单',
  })
  if (!confirmed.confirm) return
  await runAction(`settlement-confirm:${item.id}`, () => endpoints.confirmAllianceSettlement(item.id), '账单已确认')
}

function disputeSettlement(item: any) {
  task.start({ title: '提出结算争议', description: (item.merchant?.name || merchant.value?.name) + ' · ' + displayPeriod(item) + ' · 应结 ' + money(item.cooperationFeeCents) + '。提交后账单退回草稿，原金额与历史不覆盖。',
    confirmText: '确认退回核查', fields: [reasonField('差异依据')],
    submit: async ({ reason }) => { await endpoints.disputeAllianceSettlement(item.id, { reason }); await load(); return '争议已记录，账单退回待核查状态。' },
  })
}

async function createMerchant() {
  if (!canCreateCampaign.value) return
  let amountCents: number
  try {
    if (merchantForm.code.trim().length < 2 || merchantForm.name.trim().length < 2 || merchantForm.category.trim().length < 2) {
      throw new Error('商户编码、名称和分类至少需要2个字符')
    }
    amountCents = cents(merchantForm.settlementAmount, '结算单价')
  } catch (cause: any) { actionError.value = cause.message; return }
  const confirmed = await uni.showModal({
    title: '确认建立联盟商户',
    content: `${merchantForm.name.trim()} · ${merchantForm.category.trim()}\n结算模式：${settlementModes.find((item) => item.value === merchantForm.settlementMode)?.label}，金额 ${money(amountCents)}`,
    confirmText: '确认创建',
  })
  if (!confirmed.confirm) return
  await runAction('merchant-create', async () => {
    const created: any = await endpoints.createMerchant({
      code: merchantForm.code.trim(), name: merchantForm.name.trim(), category: merchantForm.category.trim(),
      level: merchantForm.level, contactName: merchantForm.contactName.trim() || undefined,
      contactPhone: merchantForm.contactPhone.trim() || undefined,
      settlementRule: { mode: merchantForm.settlementMode, amountCents },
    })
    selectedMerchantId.value = created.id
    Object.assign(merchantForm, { code: '', name: '', category: '', contactName: '', contactPhone: '' })
    showMerchantForm.value = false
  }, '商户已建立')
}

async function createTemplate() {
  if (!canCreateCampaign.value || !merchant.value) return
  let faceValueCents: number
  let claimLimitPerUser: number
  let issueLimit: number
  try {
    if (merchant.value.status && merchant.value.status !== 'ACTIVE') {
      throw new Error('停用商户不能创建券活动')
    }
    if ([templateForm.code, templateForm.name, templateForm.activityName, templateForm.benefitDescription].some((value) => value.trim().length < 2)) {
      throw new Error('券编码、名称、活动和权益说明至少需要2个字符')
    }
    faceValueCents = cents(templateForm.faceValue, '券面值')
    claimLimitPerUser = positiveInteger(templateForm.claimLimitPerUser, '每人领取上限', 100)
    issueLimit = positiveInteger(templateForm.issueLimit, '发行上限', 100000)
    if (new Date(`${templateForm.validTo}T23:59:59+08:00`) <= new Date(`${templateForm.validFrom}T00:00:00+08:00`)) {
      throw new Error('结束日期必须晚于开始日期')
    }
  } catch (cause: any) { actionError.value = cause.message; return }
  const confirmed = await uni.showModal({
    title: '确认创建券活动',
    content: `${merchant.value.name} · ${templateForm.activityName.trim()}\n发行上限 ${issueLimit} 张，有效至 ${templateForm.validTo}。`,
    confirmText: '确认创建',
  })
  if (!confirmed.confirm) return
  await runAction('template-create', async () => {
    await endpoints.createCouponTemplate({
      merchantId: merchant.value.id, code: templateForm.code.trim(), name: templateForm.name.trim(),
      activityName: templateForm.activityName.trim(), benefitDescription: templateForm.benefitDescription.trim(),
      faceValueCents, allowVenueBooking: templateForm.allowVenueBooking, validFrom: `${templateForm.validFrom}T00:00:00+08:00`,
      validTo: `${templateForm.validTo}T23:59:59+08:00`, claimLimitPerUser, issueLimit,
    })
    Object.assign(templateForm, { code: '', name: '', activityName: '', benefitDescription: '' })
    showTemplateForm.value = false
  }, '券活动已创建')
}

function issueCodes(item: any) {
  const remaining = Math.max(0, Number(item.issueLimit || 0) - Number(item.issuedCount || 0))
  if (!canIssueCodes.value || remaining <= 0) return
  const max = Math.min(2000, remaining)
  task.start({ title: '批量发行消费券', description: item.name + ' · 剩余可发行 ' + remaining + ' 张。只生成本批唯一券，不自动代替会员领取。',
    confirmText: '确认发行所填数量', fields: [{ key: 'count', label: '发行数量（张）', kind: 'number', min: 1, max, hint: '本批最多 ' + max + ' 张。', initial: '1' }],
    submit: async values => {
      const count = positiveInteger(values.count, '发行数量', max)
      const result: any = await withPendingCreationKey('alliance.coupon-batch.' + item.id, { templateId: item.id, count },
        idempotencyKey => endpoints.generateCouponCodes(item.id, { count, idempotencyKey }))
      generatedBatch.value = { templateName: item.name, codes: result.codes || [] }
      batchVisible.value = 20
      await load()
      return '已发行 ' + count + ' 张。请在本批券列表选择要发出的领取链接。'
    },
  })
}



function toggleMerchantStatus() {
  if (!isAdmin.value || !merchant.value) return
  const selected = merchant.value
  const activating = selected.status !== 'ACTIVE'
  const status = activating ? 'ACTIVE' : 'DISABLED'
  task.start({ title: activating ? '启用商户' : '停用商户', description: selected.name + (activating ? ' · 恢复发行和核销；停用券模板仍需另行启用。' : ' · 停止创建活动、发行及核销，历史和结算单保留。'),
    confirmText: activating ? '确认启用' : '确认停用', fields: [reasonField('变更依据')],
    submit: async ({ reason }) => {
      await withPendingCreationKey('alliance.merchant-status.' + selected.id, { merchantId: selected.id, status, reason }, idempotencyKey => endpoints.setMerchantStatus(selected.id, { status, reason, idempotencyKey }))
      await load(); return activating ? '商户已启用。' : '商户已停用，历史数据保留。'
    },
  })
}

function toggleTemplateStatus(item: any) {
  if (!isAdmin.value) return
  const enabled = !item.enabled
  if (enabled && !merchantIsActive.value) { actionError.value = '请先启用商户'; return }
  task.start({ title: enabled ? '启用券活动' : '停用券活动', description: item.name + (enabled ? ' · 仍按有效期和发行上限校验。' : ' · 停止继续发行和使用；已发券与核销记录保留。'),
    confirmText: enabled ? '确认启用' : '确认停用', fields: [reasonField('变更依据')],
    submit: async ({ reason }) => {
      await withPendingCreationKey('alliance.template-status.' + item.id, { templateId: item.id, enabled, reason }, idempotencyKey => endpoints.setCouponTemplateStatus(item.id, { enabled, reason, idempotencyKey }))
      await load(); return enabled ? '券活动已启用。' : '券活动已停用，历史记录保留。'
    },
  })
}

function configureScope(item: any) {
  task.start({ title: '设置券适用范围', description: item.name + ' · 影响该活动已发出的未使用券。已支付订单不追溯改价，未付旧订单需重新核验。', confirmText: '确认变更适用范围',
    fields: [{ key: 'scope', label: '可用业务', kind: 'choices', initial: item.allowVenueBooking ? 'VENUE' : 'MERCHANT',
      options: [{ value: 'MERCHANT', label: '仅所属商户消费' }, { value: 'VENUE', label: '商户消费及订场抵扣' }] }, reasonField('变更依据')],
    submit: async ({ scope, reason }) => {
      const command = { enabled: item.enabled, allowVenueBooking: scope === 'VENUE', reason }
      await withPendingCreationKey('alliance.template-scope.' + item.id, command, idempotencyKey => endpoints.setCouponTemplateStatus(item.id, { ...command, idempotencyKey }))
      await load(); return '适用范围已更新，后续建单及付款均由服务器重新核验。'
    },
  })
}

onShareAppMessage((options: any) => {
  const code = String(options?.target?.dataset?.couponCode || '')
  return code && generatedBatch.value?.codes.includes(code)
    ? { title: generatedBatch.value.templateName + ' · 邀请你领取', path: couponClaimPath(code), imageUrl: SHARE_CARD_IMAGES.miniapp }
    : { title: '延庆金羽羽毛球', path: '/pages/home/index', imageUrl: SHARE_CARD_IMAGES.miniapp }
})
// #ifdef H5
async function shareCoupon(code: string) {
  batchShareError.value = ''
  const url = window.location.origin + window.location.pathname + '#' + couponClaimPath(code)
  try {
    if (navigator.share) { await navigator.share({ title: generatedBatch.value?.templateName || '领取消费券', url }); return }
    await uni.setClipboardData({ data: url })
    uni.showToast({ title: '领取链接已复制，好友打开确认即可', icon: 'none' })
  } catch (cause: any) { if (cause?.name !== 'AbortError') batchShareError.value = '分享未完成，可重试或使用微信端发送卡片。' }
}
// #endif

function copyGeneratedCodes() {
  if (!generatedBatch.value?.codes.length) return
  uni.setClipboardData({ data: generatedBatch.value.codes.join('\n') })
}

function templateState(item: any) {
  if (!item.enabled) return { label: '已停用', className: 'state-disabled' }
  if (!merchantIsActive.value) return { label: '随商户暂停', className: 'state-disabled' }
  if (new Date(item.validTo).getTime() <= Date.now()) return { label: '已过期', className: 'state-disabled' }
  if (Number(item.issuedCount || 0) >= Number(item.issueLimit || 0)) return { label: '已发完', className: 'state-disabled' }
  if (new Date(item.validFrom).getTime() > Date.now()) return { label: '待生效', className: 'state-pending_confirmation' }
  return { label: '进行中', className: 'state-active' }
}

function canIssueTemplate(item: any) {
  return item.enabled && merchantIsActive.value &&
    new Date(item.validTo).getTime() > Date.now() &&
    Number(item.issuedCount || 0) < Number(item.issueLimit || 0)
}

onLoad((options) => {
  managementView.value = typeof options?.view === 'string' ? options.view : ''
})
onShow(load)
</script>

<template>
  <OperationsFrame access="alliance" icon="shop" title="联盟商户" eyebrow="ALLIANCE MERCHANT" :role="roleLabel" :venue="merchant?.name || '商户账户'" :description="pageDescription">
    <OperationTask :task="task" />
    <view v-if="loading" class="loading card">正在同步联盟商户、券活动与结算单…</view>
    <view v-if="loadError" class="error card"><text>{{ loadError }}</text><button class="ghost compact" :disabled="loading" @tap="load">重试</button></view>
    <view v-if="actionError" class="error card"><text>{{ actionError }}</text></view>

    <view v-if="merchants.length > 1 && !isMerchant" class="card merchant-selector">
      <text class="field-label">当前经营对象</text>
      <picker :range="merchantNames" @change="changeMerchant"><view class="picker-value">{{ merchant?.name || '选择商户' }}　›</view></picker>
    </view>
    <view v-if="merchant" class="metric-grid"><MetricCard v-for="item in metrics" :key="item[0]" :label="item[0]" :value="item[1]" :note="item[2]" /></view>

    <view v-if="canRedeem && merchant" class="section-title">唯一券核销</view>
    <view v-if="canRedeem && merchant" class="card merchant-card">
      <view class="row"><view><text class="merchant-title">{{ merchant.name }}</text><text class="muted">{{ merchant.category || '联盟合作商户' }} · 商户自行收款，平台记录券核销和归因</text></view><text class="status" :class="merchantIsActive ? 'state-active' : 'state-disabled'">{{ merchantIsActive ? '合作中' : '已停用' }}</text></view>
      <view class="merchant-actions"><button class="primary" :disabled="Boolean(actionKey) || !merchantIsActive" @tap="scan">{{ merchantIsActive ? '扫码核销' : '商户已停用' }}</button><button class="secondary" :disabled="Boolean(actionKey) || !merchantIsActive" @tap="redeem()">手动输入</button></view>
    </view>
    <view v-if="lastRedeemedCode" class="success card"><text class="notice-title">最近核销</text><text class="muted">券码 {{ lastRedeemedCode }} 已核销，消费归因已写入本商户台账。</text></view>

    <template v-if="canViewSettlements && merchant">
      <view class="section-title">商户结算单 <text class="section-note">{{ merchantSettlements.length }} 张</text></view>
      <view v-for="item in merchantSettlements" :key="item.id" class="card settlement-card">
        <view class="row"><view><text class="merchant-title">{{ displayPeriod(item) }}</text><text class="muted">发放 / 领取 / 核销：{{ item.issuedCount || 0 }} / {{ item.claimedCount || 0 }} / {{ item.redeemedCount || 0 }}</text></view><text class="status" :class="`state-${String(item.status).toLowerCase()}`">{{ settlementLabels[item.status] || item.status }}</text></view>
        <view class="amount-grid"><view><text class="field-label">归因 GMV</text><text class="amount">{{ money(item.attributedGmvCents) }}</text></view><view><text class="field-label">有效新客</text><text class="amount">{{ item.effectiveNewCustomers || 0 }} 人</text></view><view><text class="field-label">应结服务费</text><text class="amount highlight">{{ money(item.cooperationFeeCents) }}</text></view></view>
        <view v-if="item.status === 'PENDING_CONFIRMATION' && canDecideSettlement" class="action-row"><button class="primary compact" :disabled="Boolean(actionKey)" @tap="confirmSettlement(item)">确认账单</button><button class="danger compact" :disabled="Boolean(actionKey)" @tap="disputeSettlement(item)">提出争议</button></view>
        <text v-else-if="item.status === 'DRAFT'" class="state-note">草稿由财务核算并提交后，商户才能确认或争议。</text>
        <text v-else-if="item.status === 'CONFIRMED'" class="state-note">商户已确认，等待财务结算入账。</text>
      </view>
      <view v-if="!loading && !merchantSettlements.length" class="empty card">当前商户还没有结算单；结算草稿由财务按实际核销归因生成。</view>
    </template>

    <template v-if="canViewTemplates && merchant">
      <view id="coupon-management" class="section-title">券活动与唯一券 <text class="section-note">{{ merchantTemplates.length }} 个</text></view>
      <button v-if="canCreateCampaign" class="secondary full" :disabled="!merchantIsActive" @tap="showTemplateForm = !showTemplateForm">{{ merchantIsActive ? (showTemplateForm ? '收起券活动表单' : '新建券活动') : '商户停用期间不能新建券活动' }}</button>
      <view v-if="showTemplateForm && canCreateCampaign && merchantIsActive" class="card form-card">
        <view><text class="field-label">券模板编码</text><input v-model="templateForm.code" class="input" maxlength="40" placeholder="例如 COFFEE-2026" /></view>
        <view><text class="field-label">券名称</text><input v-model="templateForm.name" class="input" maxlength="120" placeholder="会员可见的券名称" /></view>
        <view><text class="field-label">活动名称</text><input v-model="templateForm.activityName" class="input" maxlength="120" placeholder="本次发行活动名称" /></view>
        <view><text class="field-label">会员权益说明</text><textarea v-model="templateForm.benefitDescription" class="textarea" maxlength="300" placeholder="说明适用商品、门槛和不可用场景" /></view>
        <view class="grid-2"><view><text class="field-label">券面值（元）</text><input v-model="templateForm.faceValue" class="input" type="digit" /></view><view><text class="field-label">发行上限（张）</text><input v-model="templateForm.issueLimit" class="input" type="number" /></view></view>
        <view class="grid-2"><picker mode="date" :value="templateForm.validFrom" @change="templateForm.validFrom = ($event.detail as any).value"><view><text class="field-label">生效日期</text><view class="picker-field">{{ templateForm.validFrom }}　›</view></view></picker><picker mode="date" :value="templateForm.validTo" @change="templateForm.validTo = ($event.detail as any).value"><view><text class="field-label">失效日期</text><view class="picker-field">{{ templateForm.validTo }}　›</view></view></picker></view>
        <view><text class="field-label">适用范围：默认仅限所属商户消费</text><switch :checked="templateForm.allowVenueBooking" @change="templateForm.allowVenueBooking = Boolean(($event as any).detail.value)" /><text>另外允许订场抵扣（影响场馆收入）</text></view>
        <view><text class="field-label">每位会员领取上限（张）</text><input v-model="templateForm.claimLimitPerUser" class="input" type="number" /></view>
        <text class="template-guardrail">模板发行后不覆盖历史规则；需要改面值、有效期或上限时，请停用旧模板并创建新模板，已发券仍按原快照核销。</text>
        <button class="primary full" :disabled="Boolean(actionKey)" @tap="createTemplate">确认创建券活动</button>
      </view>
      <view v-for="item in merchantTemplates" :key="item.id" class="card template-card">
        <view class="row"><view><text class="merchant-title">{{ item.name }}</text><text class="muted">{{ item.code }} · {{ item.activityName }}</text></view><text class="status" :class="templateState(item).className">{{ templateState(item).label }}</text></view>
        <text class="benefit">{{ item.benefitDescription }}</text><text class="state-note">{{ item.code?.startsWith("NEWCOMER") ? "新客体验专用规则" : item.allowVenueBooking ? "商户消费 / 订场抵扣" : "仅限所属商户消费" }}</text>
        <button v-if="isAdmin && !item.code?.startsWith('NEWCOMER')" class="secondary full" @tap="configureScope(item)">设置适用范围</button>
        <view class="progress-line"><text>已发行 {{ item.issuedCount || 0 }} / {{ item.issueLimit }}</text><text>已核销 {{ item.redeemedCount || 0 }}</text></view>
        <view class="lifecycle-actions"><button v-if="canIssueCodes" class="secondary" :disabled="Boolean(actionKey) || !canIssueTemplate(item)" @tap="issueCodes(item)">{{ canIssueTemplate(item) ? '批量发行唯一券' : templateState(item).label }}</button><button v-if="isAdmin" :class="item.enabled ? 'danger' : 'secondary'" :disabled="Boolean(actionKey) || (!item.enabled && !merchantIsActive)" @tap="toggleTemplateStatus(item)">{{ item.enabled ? '停用模板' : '启用模板' }}</button></view>
      </view>
      <view v-if="!loading && !merchantTemplates.length" class="empty card">当前商户还没有券活动，管理员可先建立模板再发行唯一券。</view>
      <view v-if="generatedBatch" class="success card"><text class="notice-title">{{ generatedBatch.templateName }} · 本批 {{ generatedBatch.codes.length }} 张</text><text class="muted">每张券发给一位会员。对方打开卡片后确认领取，无需复制券码；请勿群发同一张券。</text>
        <view v-for="(code,index) in generatedBatch.codes.slice(0,batchVisible)" :key="code" class="batch-row"><text>第 {{ index + 1 }} 张领取卡</text>
          <!-- #ifdef MP-WEIXIN -->
          <button class="secondary full" open-type="share" :data-coupon-code="code">发送领券卡片</button>
          <!-- #endif -->
          <!-- #ifdef H5 -->
          <button class="secondary full" @tap="shareCoupon(code)">分享领取链接</button>
          <!-- #endif -->
        </view>
        <text v-if="batchShareError" role="alert">{{ batchShareError }}</text>
        <button v-if="batchVisible < generatedBatch.codes.length" class="secondary full" @tap="batchVisible += 20">显示后续领取卡</button>
        <button class="ghost full" @tap="copyGeneratedCodes">批量印制用途：复制全部券码</button>
      </view>
    </template>

    <template v-if="canCreateCampaign">
      <view class="section-title">合作商户档案</view>
      <view v-if="merchant" class="card lifecycle-card"><view class="row"><view><text class="merchant-title">{{ merchant.name }}</text><text class="muted">状态变更不会删除历史券码、核销和结算记录。</text></view><text class="status" :class="merchantIsActive ? 'state-active' : 'state-disabled'">{{ merchantIsActive ? 'ACTIVE' : 'DISABLED' }}</text></view><button :class="merchantIsActive ? 'danger full' : 'secondary full'" :disabled="Boolean(actionKey)" @tap="toggleMerchantStatus">{{ merchantIsActive ? '停用当前商户' : '启用当前商户' }}</button></view>
      <button class="secondary full" @tap="showMerchantForm = !showMerchantForm">{{ showMerchantForm ? '收起商户表单' : '新建联盟商户' }}</button>
      <view v-if="showMerchantForm" class="card form-card">
        <view class="grid-2"><input v-model="merchantForm.code" class="input" maxlength="40" placeholder="商户编码" /><input v-model="merchantForm.name" class="input" maxlength="120" placeholder="商户名称" /></view>
        <input v-model="merchantForm.category" class="input" maxlength="80" placeholder="商户分类，如餐饮" />
        <picker :range="merchantLevels" range-key="label" @change="merchantForm.level = merchantLevels[Number(($event.detail as any).value)].value"><view class="picker-field">合作等级：{{ merchantLevels.find((item) => item.value === merchantForm.level)?.label }}　›</view></picker>
        <view class="grid-2"><input v-model="merchantForm.contactName" class="input" placeholder="联系人（可选）" /><input v-model="merchantForm.contactPhone" class="input" placeholder="联系电话（可选）" /></view>
        <picker :range="settlementModes" range-key="label" @change="merchantForm.settlementMode = settlementModes[Number(($event.detail as any).value)].value"><view class="picker-field">结算规则：{{ settlementModes.find((item) => item.value === merchantForm.settlementMode)?.label }}　›</view></picker>
        <input v-model="merchantForm.settlementAmount" class="input" type="digit" placeholder="结算单价（元）" />
        <button class="primary full" :disabled="Boolean(actionKey)" @tap="createMerchant">确认建立商户</button>
      </view>
    </template>

    <view class="section-title">操作边界</view>
    <view class="card boundary"><text class="muted">商户只见本店数据；重复核销、过期券和非本店券会被拒绝。券活动由管理员创建，商户可发行本店模板的唯一券。财务生成并提交结算单，商户只负责确认或提出有原因的争议。</text></view>
    <view v-if="!loading && !merchant" class="empty card">当前账号没有绑定可用联盟商户。</view>
  </OperationsFrame>
</template>

<style scoped>
.metric-grid { display:grid; grid-template-columns:repeat(2,1fr); gap:14rpx; margin-top:22rpx; }
.merchant-selector,.merchant-card,.settlement-card,.template-card,.form-card,.lifecycle-card,.success,.error,.loading { margin-top:18rpx; }
.merchant-selector { display:flex; align-items:center; justify-content:space-between; gap:20rpx; }
.picker-value { color:#17653d; font-weight:800; }
.merchant-title,.notice-title { display:block; margin-bottom:8rpx; font-size:29rpx; font-weight:800; }
.merchant-actions,.action-row { display:grid; grid-template-columns:1fr 1fr; gap:12rpx; margin-top:22rpx; }
.merchant-actions button,.action-row button { margin:0; }
.lifecycle-actions { display:grid; grid-template-columns:1fr 1fr; gap:12rpx; margin-top:14rpx; }.lifecycle-actions button { width:100%; margin:0; }
.section-note { color:#758079; font-size:22rpx; font-weight:400; }
.status { flex:0 0 auto; padding:7rpx 13rpx; border-radius:999rpx; color:#17653d; background:#e8f4eb; font-size:20rpx; }
.state-draft,.state-disabled { color:#6f746f; background:#eef0ef; }.state-pending_confirmation { color:#8a6019; background:#fff2d6; }.state-settled { color:#fff; background:#17653d; }
.amount-grid { display:grid; grid-template-columns:repeat(3,1fr); gap:12rpx; margin-top:20rpx; padding-top:18rpx; border-top:1rpx solid #edf0ed; }
.field-label { display:block; color:#758079; font-size:21rpx; }.amount { display:block; margin-top:7rpx; font-size:24rpx; font-weight:800; }.highlight { color:#17653d; }
.template-guardrail { display:block; color:#7b6940; font-size:21rpx; line-height:1.6; }
.state-note,.benefit { display:block; margin-top:18rpx; color:#65736a; font-size:22rpx; line-height:1.6; }
.danger { color:#8a3636; background:#fbeaea; border:1rpx solid #efcaca; }
.compact { min-width:130rpx; min-height:58rpx; margin:0; padding:0 16rpx; line-height:58rpx; font-size:22rpx; }
.full { width:100%; margin:14rpx 0 0; }
.form-card { display:grid; gap:14rpx; }.grid-2 { display:grid; grid-template-columns:1fr 1fr; gap:12rpx; }
.textarea { width:100%; min-height:130rpx; padding:20rpx; box-sizing:border-box; background:#f5f7f4; border-radius:16rpx; font-size:25rpx; }
.picker-field { min-height:76rpx; padding:0 20rpx; color:#405449; background:#f5f7f4; border-radius:16rpx; line-height:76rpx; font-size:23rpx; }
.progress-line { display:flex; justify-content:space-between; gap:16rpx; margin:18rpx 0; color:#536159; font-size:22rpx; }
.success { color:#17653d; background:#e8f4eb; }.success .muted { display:block; margin-top:7rpx; line-height:1.55; }
.error { display:flex; align-items:center; justify-content:space-between; gap:14rpx; color:#8a3636; background:#fbeaea; line-height:1.5; }
.loading { color:#536159; text-align:center; }
.code { display:block; padding:8rpx 0; border-bottom:1rpx dashed #bad4c1; font-family:monospace; font-size:21rpx; }
.boundary { line-height:1.7; }.empty { color:#758079; text-align:center; }
button[disabled] { opacity:.48; }
</style>
