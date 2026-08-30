<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import OperationsFrame from '../../../../components/OperationsFrame.vue'
import MetricCard from '../../../../components/MetricCard.vue'
import { endpoints } from '../../../../services/api'
import { useSessionStore } from '../../../../stores/session'
import { idempotencyKey, money } from '../../../../utils/format'
import { withPendingCreationKey } from '../../../../utils/pending-creation-key'

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
const generatedBatch = ref<{ templateName: string; codes: string[] } | null>(null)
const showMerchantForm = ref(false)
const showTemplateForm = ref(false)
const dataScopeKey = ref('')

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
  code: '', name: '', activityName: '', benefitDescription: '', faceValue: '20',
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

async function redeem(code?: string) {
  if (!canRedeem.value || !merchant.value) return
  if (!merchantIsActive.value) { actionError.value = '商户已停用，不能核销券码'; return }
  let couponCode = code?.trim() || ''
  if (!couponCode) {
    const codeInput = await uni.showModal({ title: '输入唯一券码', editable: true, placeholderText: '扫描结果或券码' })
    if (!codeInput.confirm) return
    couponCode = codeInput.content?.trim() || ''
  }
  if (!couponCode) return
  const amountInput = await uni.showModal({
    title: '登记消费归因', editable: true, placeholderText: '实际成交金额（元），无金额填0',
  })
  if (!amountInput.confirm) return
  let attributedAmountCents = 0
  try { attributedAmountCents = cents(amountInput.content?.trim() || '0', '成交金额') }
  catch (cause: any) { actionError.value = cause.message; return }
  const confirmed = await uni.showModal({
    title: '二次确认核销',
    content: `${merchant.value.name} · ${couponCode}\n归因金额 ${money(attributedAmountCents)}。核销后券码不可再次使用。`,
    confirmText: '确认核销',
  })
  if (!confirmed.confirm) return
  await runAction(`redeem:${couponCode}`, async () => {
    await endpoints.redeemCoupon({
      code: couponCode,
      merchantId: merchant.value.id,
      attributedAmountCents,
      idempotencyKey: idempotencyKey(`merchant-${couponCode}`),
    })
    lastRedeemedCode.value = couponCode
  }, '核销成功')
}

async function scan() {
  try {
    const result = await uni.scanCode({ scanType: ['qrCode', 'barCode'] })
    await redeem(result.result.split('/').pop() || result.result)
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

async function disputeSettlement(item: any) {
  const input = await uni.showModal({
    title: '填写结算争议', editable: true, placeholderText: '至少2个字，说明核销、归因或合同口径差异',
  })
  const reason = input.content?.trim() || ''
  if (!input.confirm) return
  if (reason.length < 2) { actionError.value = '争议原因至少需要2个字'; return }
  const confirmed = await uni.showModal({
    title: '二次确认提出争议',
    content: `账单将退回草稿，原金额不会被覆盖。\n原因：${reason}`,
    confirmText: '确认退回', confirmColor: '#a52626',
  })
  if (!confirmed.confirm) return
  await runAction(`settlement-dispute:${item.id}`, () => endpoints.disputeAllianceSettlement(item.id, { reason }), '争议已提交')
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
      faceValueCents, validFrom: `${templateForm.validFrom}T00:00:00+08:00`,
      validTo: `${templateForm.validTo}T23:59:59+08:00`, claimLimitPerUser, issueLimit,
    })
    Object.assign(templateForm, { code: '', name: '', activityName: '', benefitDescription: '' })
    showTemplateForm.value = false
  }, '券活动已创建')
}

async function issueCodes(item: any) {
  const remaining = Math.max(0, Number(item.issueLimit || 0) - Number(item.issuedCount || 0))
  if (!canIssueCodes.value || remaining <= 0) return
  const input = await uni.showModal({
    title: '批量发行唯一券', editable: true, placeholderText: `本批数量，剩余可发行 ${remaining} 张`,
  })
  if (!input.confirm) return
  let count: number
  try { count = positiveInteger(input.content?.trim() || '', '发行数量', Math.min(2000, remaining)) }
  catch (cause: any) { actionError.value = cause.message; return }
  const confirmed = await uni.showModal({
    title: '二次确认发行',
    content: `${item.name} 将生成 ${count} 个不可重复的唯一券码。生成后请通过受控渠道发放。`,
    confirmText: '确认发行',
  })
  if (!confirmed.confirm) return
  await runAction(`issue:${item.id}`, async () => {
    const command = { templateId: item.id, count }
    const result: any = await withPendingCreationKey(
      `alliance.coupon-batch.${item.id}`,
      command,
      (idempotencyKey) => endpoints.generateCouponCodes(item.id, { count, idempotencyKey }),
    )
    generatedBatch.value = { templateName: item.name, codes: result.codes || [] }
  }, `已发行${count}张`)
}

async function lifecycleReason(title: string, placeholder: string) {
  const input = await uni.showModal({ title, editable: true, placeholderText: placeholder })
  if (!input.confirm) return ''
  const reason = input.content?.trim() || ''
  if (reason.length < 2 || reason.length > 300) {
    actionError.value = '状态变更原因需要2-300个字符'
    return ''
  }
  return reason
}

async function toggleMerchantStatus() {
  if (!isAdmin.value || !merchant.value) return
  const activating = merchant.value.status !== 'ACTIVE'
  const status = activating ? 'ACTIVE' : 'DISABLED'
  const reason = await lifecycleReason(
    activating ? '填写启用商户原因' : '填写停用商户原因',
    activating ? '如：合作协议已续签并复核' : '如：合作到期或风险暂停',
  )
  if (!reason) return
  const confirmed = await uni.showModal({
    title: activating ? '二次确认启用商户' : '二次确认停用商户',
    content: activating
      ? `${merchant.value.name} 将恢复券活动创建、唯一券发行和核销；已停用的券模板仍需逐一启用。\n原因：${reason}`
      : `${merchant.value.name} 停用后不能新建券活动、发行或核销券码；历史数据与结算单不会删除。\n原因：${reason}`,
    confirmText: activating ? '确认启用' : '确认停用',
    confirmColor: activating ? '#17653d' : '#a52626',
  })
  if (!confirmed.confirm) return
  const merchantId = merchant.value.id
  const command = { merchantId, status, reason }
  await runAction(`merchant-status:${merchantId}`, () => withPendingCreationKey(
    `alliance.merchant-status.${merchantId}`,
    command,
    (commandKey) => endpoints.setMerchantStatus(merchantId, {
      status,
      reason,
      idempotencyKey: commandKey,
    }),
  ), activating ? '商户已启用' : '商户已停用')
}

async function toggleTemplateStatus(item: any) {
  if (!isAdmin.value) return
  const enabled = !item.enabled
  if (enabled && !merchantIsActive.value) {
    actionError.value = '请先启用商户，再启用券模板'
    return
  }
  const reason = await lifecycleReason(
    enabled ? '填写启用券模板原因' : '填写停用券模板原因',
    enabled ? '如：活动物料和履约能力已确认' : '如：活动结束或权益调整',
  )
  if (!reason) return
  const confirmed = await uni.showModal({
    title: enabled ? '二次确认启用券模板' : '二次确认停用券模板',
    content: enabled
      ? `${item.name} 启用后可继续发行唯一券；有效期和发行上限仍会校验。\n原因：${reason}`
      : `${item.name} 停用后不能继续发行，既有数据不会删除。\n原因：${reason}`,
    confirmText: enabled ? '确认启用' : '确认停用',
    confirmColor: enabled ? '#17653d' : '#a52626',
  })
  if (!confirmed.confirm) return
  const command = { templateId: item.id, enabled, reason }
  await runAction(`template-status:${item.id}`, () => withPendingCreationKey(
    `alliance.template-status.${item.id}`,
    command,
    (commandKey) => endpoints.setCouponTemplateStatus(item.id, {
      enabled,
      reason,
      idempotencyKey: commandKey,
    }),
  ), enabled ? '券模板已启用' : '券模板已停用')
}

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

onShow(load)
</script>

<template>
  <OperationsFrame title="联盟商户" eyebrow="ALLIANCE MERCHANT" :role="roleLabel" :venue="merchant?.name || '商户账户'" :description="pageDescription">
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
      <view class="section-title">券活动与唯一券 <text class="section-note">{{ merchantTemplates.length }} 个</text></view>
      <button v-if="canCreateCampaign" class="secondary full" :disabled="!merchantIsActive" @tap="showTemplateForm = !showTemplateForm">{{ merchantIsActive ? (showTemplateForm ? '收起券活动表单' : '新建券活动') : '商户停用期间不能新建券活动' }}</button>
      <view v-if="showTemplateForm && canCreateCampaign && merchantIsActive" class="card form-card">
        <input v-model="templateForm.code" class="input" maxlength="40" placeholder="券模板编码，如 COFFEE-2026" />
        <input v-model="templateForm.name" class="input" maxlength="120" placeholder="券名称" />
        <input v-model="templateForm.activityName" class="input" maxlength="120" placeholder="活动名称" />
        <textarea v-model="templateForm.benefitDescription" class="textarea" maxlength="300" placeholder="会员权益说明" />
        <view class="grid-2"><input v-model="templateForm.faceValue" class="input" type="digit" placeholder="券面值（元）" /><input v-model="templateForm.issueLimit" class="input" type="number" placeholder="发行上限" /></view>
        <view class="grid-2"><picker mode="date" :value="templateForm.validFrom" @change="templateForm.validFrom = ($event.detail as any).value"><view class="picker-field">开始 {{ templateForm.validFrom }}</view></picker><picker mode="date" :value="templateForm.validTo" @change="templateForm.validTo = ($event.detail as any).value"><view class="picker-field">结束 {{ templateForm.validTo }}</view></picker></view>
        <input v-model="templateForm.claimLimitPerUser" class="input" type="number" placeholder="每人领取上限" />
        <button class="primary full" :disabled="Boolean(actionKey)" @tap="createTemplate">确认创建券活动</button>
      </view>
      <view v-for="item in merchantTemplates" :key="item.id" class="card template-card">
        <view class="row"><view><text class="merchant-title">{{ item.name }}</text><text class="muted">{{ item.code }} · {{ item.activityName }}</text></view><text class="status" :class="templateState(item).className">{{ templateState(item).label }}</text></view>
        <text class="benefit">{{ item.benefitDescription }}</text>
        <view class="progress-line"><text>已发行 {{ item.issuedCount || 0 }} / {{ item.issueLimit }}</text><text>已核销 {{ item.redeemedCount || 0 }}</text></view>
        <view class="lifecycle-actions"><button v-if="canIssueCodes" class="secondary" :disabled="Boolean(actionKey) || !canIssueTemplate(item)" @tap="issueCodes(item)">{{ canIssueTemplate(item) ? '批量发行唯一券' : templateState(item).label }}</button><button v-if="isAdmin" :class="item.enabled ? 'danger' : 'secondary'" :disabled="Boolean(actionKey) || (!item.enabled && !merchantIsActive)" @tap="toggleTemplateStatus(item)">{{ item.enabled ? '停用模板' : '启用模板' }}</button></view>
      </view>
      <view v-if="!loading && !merchantTemplates.length" class="empty card">当前商户还没有券活动，管理员可先建立模板再发行唯一券。</view>
      <view v-if="generatedBatch" class="success card"><view class="row"><view><text class="notice-title">{{ generatedBatch.templateName }} · 本批 {{ generatedBatch.codes.length }} 张</text><text class="muted">页面仅预览前 20 个，复制可取得本批全部券码。</text></view><button class="ghost compact" @tap="copyGeneratedCodes">复制全部</button></view><text v-for="code in generatedBatch.codes.slice(0, 20)" :key="code" class="code">{{ code }}</text></view>
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
