<script setup lang="ts">
import { computed, ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import OperationsFrame from '../../../../components/OperationsFrame.vue'
import MetricCard from '../../../../components/MetricCard.vue'
import StatusBadge from '../../../../components/StatusBadge.vue'
import { endpoints, type ReconciliationPeriod } from '../../../../services/api'
import { useSessionStore } from '../../../../stores/session'
import { money, shortDate, today } from '../../../../utils/format'
import { withPendingCreationKey } from '../../../../utils/pending-creation-key'

type LoadSource = 'dashboard' | 'refunds' | 'training' | 'trainingSettlements' | 'merchants' | 'settlements' | 'reconciliation' | 'adjustments' | 'shifts'

const session = useSessionStore()
const dashboard = ref<Record<string, any> | null>(null)
const orders = ref<any[]>([])
const training = ref<Record<string, any> | null>(null)
const trainingSettlements = ref<any[]>([])
const merchants = ref<any[]>([])
const settlements = ref<any[]>([])
const reconciliation = ref<ReconciliationPeriod | null>(null)
const adjustments = ref<any[]>([])
const shifts = ref<any[]>([])
const loading = ref(false)
const actionKey = ref('')
const successMessage = ref('')
const actionError = ref('')
const lastSyncedAt = ref('')
const trainingSettlementStatusOptions = [
  { value: '', label: '全部状态' },
  { value: 'DRAFT', label: '草稿' },
  { value: 'PENDING_CONFIRMATION', label: '待复核' },
  { value: 'CONFIRMED', label: '待入账' },
  { value: 'SETTLED', label: '已结算' },
  { value: 'VOID', label: '已作废' },
]
const trainingSettlementStatusIndex = ref(0)
const trainingPeriodStartDate = ref(closeBusinessPeriod().date)
const trainingPeriodEndDate = ref(today())

const emptyLoadErrors = (): Record<LoadSource, string> => ({
  dashboard: '',
  refunds: '',
  training: '',
  trainingSettlements: '',
  merchants: '',
  settlements: '',
  reconciliation: '',
  adjustments: '',
  shifts: '',
})
const loadErrors = ref<Record<LoadSource, string>>(emptyLoadErrors())

const canFinanceAction = computed(() =>
  session.roles.some((role) => ['FINANCE', 'ADMIN', 'SUPER_ADMIN'].includes(role)),
)
const canMerchantAction = computed(() =>
  session.roles.some((role) => ['MERCHANT', 'ADMIN', 'SUPER_ADMIN'].includes(role)),
)
const roleLabel = computed(() => {
  if (session.roles.includes('SUPER_ADMIN')) return '超级管理员'
  if (session.roles.includes('ADMIN')) return '管理员'
  if (session.roles.includes('MERCHANT')) return '商户确认'
  return '财务'
})

const allRefunds = computed(() => orders.value
  .flatMap((order) => (order.refunds || []).map((refund: any) => ({ ...refund, order })))
  .sort((left, right) => new Date(right.requestedAt || 0).getTime() - new Date(left.requestedAt || 0).getTime()))

const reviewRefunds = computed(() => allRefunds.value.filter((item) =>
  ['REQUESTED', 'REFUND_PENDING'].includes(item.status),
))

const activeRefunds = computed(() => allRefunds.value.filter((item) =>
  ['REQUESTED', 'REFUND_PENDING', 'APPROVED', 'PROCESSING', 'FAILED'].includes(item.status),
))

const unsettledFeeCents = computed(() => settlements.value
  .filter((item) => !['SETTLED', 'VOID'].includes(item.status))
  .reduce((sum, item) => sum + Number(item.cooperationFeeCents || 0), 0))

const displayedUnsettledFeeCents = computed(() => settlements.value.length
  ? unsettledFeeCents.value
  : Number(dashboard.value?.alliance?.cooperationFeeCents || 0))

const unreviewedShiftVariances = computed(() => shifts.value.filter((shift) =>
  shift.status === 'CLOSED' &&
  Number(shift.cashVarianceCents || 0) !== 0 &&
  !shift.varianceReviewedAt,
))

const metrics = computed(() => [
  ['今日经营收入', money((dashboard.value?.venue?.revenueCents || 0) + (dashboard.value?.goods?.revenueCents || 0)), '场地 + 商品'],
  ['培训确认收入', money(training.value?.confirmedRevenueCents ?? dashboard.value?.training?.confirmedRevenueCents), '实际消课确认'],
  ['待资金复核', String(reviewRefunds.value.length + adjustments.value.length + unreviewedShiftVariances.value.length + trainingSettlements.value.filter((item) => ['PENDING_CONFIRMATION', 'CONFIRMED'].includes(item.status)).length), '退款 + 调账 + 班次差异 + 培训结算'],
  ['联盟待结金额', money(displayedUnsettledFeeCents.value), '未结算服务费'],
])

function businessPeriod() {
  const date = today()
  const startsAt = new Date(`${date}T00:00:00+08:00`)
  const endsAt = new Date(startsAt.getTime() + 86_400_000)
  return { date, periodStart: startsAt.toISOString(), periodEnd: endsAt.toISOString() }
}

function closeBusinessPeriod() {
  const yesterday = new Date(Date.now() - 86_400_000)
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(yesterday)
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  const date = `${values.year}-${values.month}-${values.day}`
  const startsAt = new Date(`${date}T00:00:00+08:00`)
  return { date, periodStart: startsAt.toISOString(), periodEnd: new Date(startsAt.getTime() + 86_400_000).toISOString() }
}

function sourceError(source: LoadSource, reason: unknown) {
  const fallback: Record<LoadSource, string> = {
    dashboard: '经营指标同步失败',
    refunds: '退款队列同步失败',
    training: '培训财务数据同步失败',
    trainingSettlements: '培训结算单同步失败',
    merchants: '联盟商户同步失败',
    settlements: '联盟结算单同步失败',
    reconciliation: '日结关账状态同步失败',
    adjustments: '账户调整队列同步失败',
    shifts: '前台班次差异同步失败',
  }
  return reason instanceof Error && reason.message ? reason.message : fallback[source]
}

function actionErrorMessage(reason: unknown, fallback: string) {
  return reason instanceof Error && reason.message ? reason.message : fallback
}

function refresh() {
  void load({ preserveMessage: true })
}

async function load(options: { preserveMessage?: boolean } = {}) {
  if (loading.value) return
  loading.value = true
  actionError.value = ''
  loadErrors.value = emptyLoadErrors()
  if (!options.preserveMessage) successMessage.value = ''

  try {
    await session.hydrate()
    const period = businessPeriod()
    const closePeriod = closeBusinessPeriod()
    const result = await Promise.allSettled([
      endpoints.dashboard(),
      endpoints.adminOrders(),
      endpoints.trainingFinancials(period.periodStart, period.periodEnd),
      endpoints.merchants(),
      endpoints.allianceSettlements(),
      endpoints.reconciliationPeriod(closePeriod.date),
      canFinanceAction.value ? endpoints.accountAdjustments() : Promise.resolve([]),
      canFinanceAction.value
        ? endpoints.trainingSettlements({
            ...(trainingSettlementStatusOptions[trainingSettlementStatusIndex.value].value
              ? { status: trainingSettlementStatusOptions[trainingSettlementStatusIndex.value].value }
              : {}),
          })
        : Promise.resolve([]),
      canFinanceAction.value
        ? endpoints.frontDeskShiftHistory({ status: 'CLOSED', limit: 50 })
        : Promise.resolve([]),
    ])

    if (result[0].status === 'fulfilled') dashboard.value = result[0].value
    else loadErrors.value.dashboard = sourceError('dashboard', result[0].reason)

    if (result[1].status === 'fulfilled') orders.value = result[1].value?.items || []
    else loadErrors.value.refunds = sourceError('refunds', result[1].reason)

    if (result[2].status === 'fulfilled') training.value = result[2].value
    else loadErrors.value.training = sourceError('training', result[2].reason)

    if (result[3].status === 'fulfilled') merchants.value = result[3].value || []
    else loadErrors.value.merchants = sourceError('merchants', result[3].reason)

    if (result[4].status === 'fulfilled') settlements.value = result[4].value || []
    else loadErrors.value.settlements = sourceError('settlements', result[4].reason)

    if (result[5].status === 'fulfilled') reconciliation.value = result[5].value
    else loadErrors.value.reconciliation = sourceError('reconciliation', result[5].reason)

    if (result[6].status === 'fulfilled') adjustments.value = result[6].value || []
    else loadErrors.value.adjustments = sourceError('adjustments', result[6].reason)

    if (result[7].status === 'fulfilled') trainingSettlements.value = result[7].value || []
    else loadErrors.value.trainingSettlements = sourceError('trainingSettlements', result[7].reason)

    if (result[8].status === 'fulfilled') shifts.value = result[8].value || []
    else loadErrors.value.shifts = sourceError('shifts', result[8].reason)

    lastSyncedAt.value = new Date().toLocaleTimeString('zh-CN', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    })
  } catch (reason) {
    actionError.value = actionErrorMessage(reason, '财务工作台同步失败，请稍后重试')
  } finally {
    loading.value = false
  }
}

async function closeBusinessDay() {
  if (!canFinanceAction.value) return
  const period = closeBusinessPeriod()
  if (reconciliation.value?.status === 'LOCKED') {
    uni.showToast({ title: '该营业日已关账', icon: 'none' })
    return
  }
  const modal = await uni.showModal({
    title: `关账 ${period.date}`,
    content: reconciliation.value?.blocked
      ? `当前有 ${reconciliation.value.exceptionCount} 项待处理异常，关账请求会保留 REVIEW 状态。确认提交复核？`
      : '确认已完成支付、退款、培训和联盟结算核对，并锁定该营业日？',
    confirmText: '提交关账',
  })
  if (!modal.confirm) return
  await runAction(
    `reconciliation-close:${period.date}`,
    reconciliation.value?.blocked ? `${period.date} 已进入待处理复核` : `${period.date} 已关账锁定`,
    '日结关账失败',
    async () => {
      const result = await endpoints.closeReconciliationPeriod(period.date, { reason: '财务工作台日结复核' })
      reconciliation.value = result
    },
  )
}

function reconciliationStatusLabel(status?: string) {
  return ({ OPEN: '待关账', REVIEW: '有异常待复核', LOCKED: '已锁定' } as Record<string, string>)[status || ''] || status || '未初始化'
}

function reconciliationAmount(key: string) {
  return money(reconciliation.value?.totals?.[key] || 0)
}

async function runAction(
  key: string,
  success: string,
  fallbackError: string,
  operation: () => Promise<unknown>,
) {
  if (actionKey.value || loading.value) return
  actionKey.value = key
  actionError.value = ''
  try {
    await operation()
    successMessage.value = success
    uni.showToast({ title: '操作成功', icon: 'success' })
    await load({ preserveMessage: true })
  } catch (reason) {
    actionError.value = actionErrorMessage(reason, fallbackError)
    uni.showToast({ title: actionError.value, icon: 'none' })
  } finally {
    actionKey.value = ''
  }
}

async function askReason(title: string, placeholder: string): Promise<string | null> {
  const modal = await uni.showModal({
    title,
    content: '',
    editable: true,
    placeholderText: placeholder,
    confirmText: '继续',
  })
  if (!modal.confirm) return null
  const reason = modal.content?.trim() || ''
  if (reason.length < 2) {
    uni.showToast({ title: '原因至少填写 2 个字', icon: 'none' })
    return null
  }
  return reason
}

async function approveRefund(refund: any) {
  const reason = await askReason(
    `批准退款 ${refund.refundNo || ''}`,
    '填写核对依据或批准原因（必填）',
  )
  if (!reason) return
  const confirmed = await uni.showModal({
    title: '确认批准退款',
    content: `${refund.order.orderNo} · ${money(refund.amountCents)}。批准后将按原支付路径处理，原因：${reason}`,
    confirmText: '确认批准',
  })
  if (!confirmed.confirm) return
  await runAction(
    `refund-approve:${refund.id}`,
    `退款 ${refund.refundNo || refund.id} 已批准并进入退款处理`,
    '退款批准失败',
    () => endpoints.approveRefund(refund.id, { reason }),
  )
}

async function rejectRefund(refund: any) {
  const reason = await askReason(
    `驳回退款 ${refund.refundNo || ''}`,
    '填写驳回原因（必填，将进入审计）',
  )
  if (!reason) return
  const confirmed = await uni.showModal({
    title: '确认驳回退款',
    content: `${refund.order.orderNo} · ${money(refund.amountCents)}。驳回原因：${reason}`,
    confirmText: '确认驳回',
  })
  if (!confirmed.confirm) return
  await runAction(
    `refund-reject:${refund.id}`,
    `退款 ${refund.refundNo || refund.id} 已驳回`,
    '退款驳回失败',
    () => endpoints.rejectRefund(refund.id, { reason }),
  )
}

async function reviewAdjustment(request: any, approved: boolean) {
  const reason = await askReason(
    approved ? '批准账户调整' : '驳回账户调整',
    approved ? '填写核对原始凭证或批准依据' : '填写驳回原因',
  )
  if (!reason) return
  const confirmed = await uni.showModal({
    title: approved ? '确认调整入账' : '确认驳回申请',
    content: `${request.account?.user?.displayName || '会员'} · ${accountDelta(request)}。${approved ? '入账后只可提交反向调整，不能覆盖历史。' : '本次申请不会改动余额。'}`,
    confirmText: approved ? '复核入账' : '确认驳回',
  })
  if (!confirmed.confirm) return
  await runAction(
    `account-adjustment-${approved ? 'approve' : 'reject'}:${request.id}`,
    approved ? '账户调整已复核入账' : '账户调整申请已驳回',
    approved ? '账户调整入账失败' : '账户调整驳回失败',
    () => approved
      ? endpoints.approveAccountAdjustment(request.id, reason)
      : endpoints.rejectAccountAdjustment(request.id, reason),
  )
}

async function reviewShiftVariance(shift: any) {
  if (!canFinanceAction.value || shift.varianceReviewedAt) return
  if ([shift.operatorId, shift.closedById].includes(session.user?.id)) {
    uni.showToast({ title: '班次操作人或关班人不能复核自己的差异', icon: 'none' })
    return
  }
  const reason = await askReason('复核现金差异', '填写盘点凭证、差异原因及处理结论')
  if (!reason) return
  const confirmed = await uni.showModal({
    title: '确认现金差异复核',
    content: `${shift.operator?.displayName || '前台'} · 账面 ${money(shift.expectedCashCents)} · 实点 ${money(shift.closingCashCents)} · 差异 ${money(shift.cashVarianceCents)}。复核原因：${reason}`,
    confirmText: '确认复核',
  })
  if (!confirmed.confirm) return
  await runAction(
    `shift-variance-review:${shift.id}`,
    '前台现金差异已复核并写入审计',
    '现金差异复核失败',
    () => endpoints.reviewFrontDeskShiftVariance(shift.id, { reason }),
  )
}

function accountDelta(request: any) {
  const amount = Number(request.amount || 0)
  const type = request.account?.type || ''
  if (['CASH_PRINCIPAL', 'GIFT_BALANCE'].includes(type)) return money(amount)
  return `${amount > 0 ? '+' : ''}${amount} ${type || '单位'}`
}

function isOwnAdjustment(request: any) {
  return request.requestedById === session.user?.id
}

function onTrainingSettlementStatusChange(event: any) {
  const next = Number(event?.detail?.value || 0)
  trainingSettlementStatusIndex.value = Number.isInteger(next) ? next : 0
  refresh()
}

function onTrainingPeriodStartChange(event: any) {
  trainingPeriodStartDate.value = String(event?.detail?.value || trainingPeriodStartDate.value)
}

function onTrainingPeriodEndChange(event: any) {
  trainingPeriodEndDate.value = String(event?.detail?.value || trainingPeriodEndDate.value)
}

async function askNonnegativeMoney(title: string, placeholder: string): Promise<number | null> {
  const modal = await uni.showModal({ title, content: '', editable: true, placeholderText: placeholder, confirmText: '下一步' })
  if (!modal.confirm) return null
  const value = modal.content?.trim() || '0'
  if (!/^\d+(\.\d{1,2})?$/.test(value)) {
    uni.showToast({ title: '请输入非负金额，最多两位小数', icon: 'none' })
    return null
  }
  return Math.round(Number(value) * 100)
}

async function createTrainingSettlementDraft() {
  if (trainingPeriodEndDate.value <= trainingPeriodStartDate.value) {
    uni.showToast({ title: '结束日期必须晚于开始日期', icon: 'none' })
    return
  }
  const acquisitionCostCents = await askNonnegativeMoney('本账期获客成本', '输入金额（元），无则填 0')
  if (acquisitionCostCents === null) return
  const marketingCostCents = await askNonnegativeMoney('本账期营销成本', '输入金额（元），无则填 0')
  if (marketingCostCents === null) return
  const command = {
    periodStart: new Date(`${trainingPeriodStartDate.value}T00:00:00+08:00`).toISOString(),
    periodEnd: new Date(`${trainingPeriodEndDate.value}T00:00:00+08:00`).toISOString(),
    acquisitionCostCents,
    marketingCostCents,
  }
  const confirmed = await uni.showModal({
    title: '确认生成培训结算草稿',
    content: `${trainingPeriodStartDate.value} 至 ${trainingPeriodEndDate.value}（结束日不含）· 获客 ${money(acquisitionCostCents)} · 营销 ${money(marketingCostCents)}。若周期含已锁定营业日，系统会拒绝生成。`,
    confirmText: '生成草稿',
  })
  if (!confirmed.confirm) return
  await runAction(
    `training-settlement-create:${trainingPeriodStartDate.value}:${trainingPeriodEndDate.value}`,
    '培训结算草稿已生成，待提交复核',
    '培训结算草稿生成失败',
    () => endpoints.createTrainingSettlement(command),
  )
}

function trainingSettlementPeriod(settlement: any) {
  if (!settlement.periodStart || !settlement.periodEnd) return '账期待补充'
  return `${new Date(settlement.periodStart).toLocaleDateString('zh-CN')} — ${new Date(settlement.periodEnd).toLocaleDateString('zh-CN')}（结束日不含）`
}

function trainingSettlementStatusLabel(status?: string) {
  return ({
    DRAFT: '草稿',
    PENDING_CONFIRMATION: '待复核',
    CONFIRMED: '已确认 / 待入账',
    SETTLED: '已结算',
    VOID: '已作废',
  } as Record<string, string>)[status || ''] || status || '未知状态'
}

function isOwnTrainingSettlement(settlement: any) {
  return Boolean(settlement.createdById && settlement.createdById === session.user?.id)
}

function trainingSettlementLatestNote(settlement: any) {
  const history = Array.isArray(settlement.workflowHistory) ? settlement.workflowHistory : []
  const latest = history[history.length - 1]
  if (!latest) return ''
  return [latest.actorName, latest.reason ? `原因：${latest.reason}` : '', latest.at ? shortDate(latest.at) : ''].filter(Boolean).join(' · ')
}

async function changeTrainingSettlement(
  settlement: any,
  action: 'submit' | 'confirm' | 'settle' | 'return' | 'void',
) {
  if (['confirm', 'settle', 'return'].includes(action) && isOwnTrainingSettlement(settlement)) {
    uni.showToast({ title: '制单人不能复核自己的结算单', icon: 'none' })
    return
  }
  const labels = {
    submit: ['提交培训结算', '填写数据核对依据', '提交复核'],
    confirm: ['确认培训结算', '填写消课、成本和合同口径复核依据', '确认通过'],
    settle: ['培训结算入账', '填写付款/收款凭证或入账依据', '确认入账'],
    return: ['退回培训结算', '填写差异项和退回原因', '确认退回'],
    void: ['作废培训草稿', '填写作废原因', '确认作废'],
  } as const
  const reason = await askReason(labels[action][0], labels[action][1])
  if (!reason) return
  const confirmed = await uni.showModal({
    title: labels[action][0],
    content: `${trainingSettlementPeriod(settlement)} · 场馆合同分成 ${money(settlement.venueContributionCents)}。本次原因：${reason}。状态变更将写入不可覆盖的审计历史。`,
    confirmText: labels[action][2],
  })
  if (!confirmed.confirm) return
  const command = { action, reason, fromStatus: settlement.status }
  await runAction(
    `training-settlement-${action}:${settlement.id}`,
    `培训结算已${action === 'submit' ? '提交复核' : action === 'confirm' ? '确认' : action === 'settle' ? '结算入账' : action === 'return' ? '退回草稿' : '作废'}`,
    '培训结算状态更新失败',
    () => withPendingCreationKey(
      `training.settlement.${settlement.id}.${action}`,
      command,
      (idempotencyKey) => {
        const payload = { reason, idempotencyKey }
        if (action === 'submit') return endpoints.submitTrainingSettlement(settlement.id, payload)
        if (action === 'confirm') return endpoints.confirmTrainingSettlement(settlement.id, payload)
        if (action === 'settle') return endpoints.settleTrainingSettlement(settlement.id, payload)
        if (action === 'return') return endpoints.returnTrainingSettlement(settlement.id, payload)
        return endpoints.voidTrainingSettlement(settlement.id, payload)
      },
    ),
  )
}

async function createSettlement(merchant: any) {
  const input = await uni.showModal({
    title: `生成 ${merchant.name} 结算草稿`,
    content: '',
    editable: true,
    placeholderText: '输入本周期归因毛利（元，可为 0）',
    confirmText: '核对周期',
  })
  if (!input.confirm) return
  const grossProfitYuan = input.content?.trim() || ''
  if (!/^\d+(\.\d{1,2})?$/.test(grossProfitYuan)) {
    uni.showToast({ title: '请输入正确金额，最多两位小数', icon: 'none' })
    return
  }
  const attributedGrossProfitCents = Math.round(Number(grossProfitYuan) * 100)
  const period = businessPeriod()
  const confirmed = await uni.showModal({
    title: '确认生成结算草稿',
    content: `${merchant.name} · ${period.date}，归因毛利 ${money(attributedGrossProfitCents)}。系统将按已核销券码重算结算指标。`,
    confirmText: '生成草稿',
  })
  if (!confirmed.confirm) return
  await runAction(
    `settlement-create:${merchant.id}`,
    `${merchant.name} 的 ${period.date} 结算草稿已生成`,
    '结算草稿生成失败',
    () => endpoints.createAllianceSettlement({
      merchantId: merchant.id,
      periodStart: period.periodStart,
      periodEnd: period.periodEnd,
      attributedGrossProfitCents,
    }),
  )
}

async function submitSettlement(settlement: any) {
  const confirmed = await uni.showModal({
    title: '提交商户确认',
    content: `${settlementMerchant(settlement)} · 服务费 ${money(settlement.cooperationFeeCents)}。提交后金额锁定并等待商户确认。`,
    confirmText: '确认提交',
  })
  if (!confirmed.confirm) return
  await runAction(
    `settlement-submit:${settlement.id}`,
    `${settlementMerchant(settlement)} 的结算单已提交商户确认`,
    '结算单提交失败',
    () => endpoints.submitAllianceSettlement(settlement.id),
  )
}

async function confirmSettlement(settlement: any) {
  const confirmed = await uni.showModal({
    title: '确认联盟结算单',
    content: `${settlementMerchant(settlement)} · 服务费 ${money(settlement.cooperationFeeCents)}。确认后将进入财务付款队列。`,
    confirmText: '确认账单',
  })
  if (!confirmed.confirm) return
  await runAction(
    `settlement-confirm:${settlement.id}`,
    `${settlementMerchant(settlement)} 已确认结算单`,
    '结算单确认失败',
    () => endpoints.confirmAllianceSettlement(settlement.id),
  )
}

async function disputeSettlement(settlement: any) {
  const reason = await askReason('提出结算争议', '填写差异项、凭证或需复核原因（必填）')
  if (!reason) return
  const confirmed = await uni.showModal({
    title: '确认退回草稿',
    content: `结算单将退回 DRAFT，原金额不覆盖，争议原因：${reason}`,
    confirmText: '提交争议',
  })
  if (!confirmed.confirm) return
  await runAction(
    `settlement-dispute:${settlement.id}`,
    `${settlementMerchant(settlement)} 的结算单已退回复核`,
    '结算争议提交失败',
    () => endpoints.disputeAllianceSettlement(settlement.id, { reason }),
  )
}

async function settleSettlement(settlement: any) {
  const confirmed = await uni.showModal({
    title: '确认结算入账',
    content: `${settlementMerchant(settlement)} · 应结服务费 ${money(settlement.cooperationFeeCents)}。仅在付款凭证与商户确认一致后执行。`,
    confirmText: '确认已结算',
  })
  if (!confirmed.confirm) return
  await runAction(
    `settlement-settle:${settlement.id}`,
    `${settlementMerchant(settlement)} 的结算单已完成入账`,
    '结算入账失败',
    () => endpoints.settleAllianceSettlement(settlement.id),
  )
}

function settlementMerchant(settlement: any) {
  return settlement.merchant?.name || merchants.value.find((item) => item.id === settlement.merchantId)?.name || '联盟商户'
}

function settlementPeriod(settlement: any) {
  if (!settlement.periodStart || !settlement.periodEnd) return '结算周期待补充'
  const start = new Date(settlement.periodStart).toLocaleDateString('zh-CN')
  const end = new Date(settlement.periodEnd).toLocaleDateString('zh-CN')
  return `${start} — ${end}`
}

function settlementStatusLabel(status?: string) {
  const labels: Record<string, string> = {
    DRAFT: '草稿',
    PENDING_CONFIRMATION: '待商户确认',
    CONFIRMED: '商户已确认',
    SETTLED: '已结算',
    VOID: '已作废',
  }
  return labels[status || ''] || status || '未知状态'
}

function refundStatusNote(status?: string) {
  const labels: Record<string, string> = {
    REQUESTED: '等待财务复核',
    REFUND_PENDING: '等待财务复核',
    APPROVED: '已批准，等待退款通道处理',
    PROCESSING: '退款通道处理中',
    FAILED: '退款失败，需人工核对',
  }
  return labels[status || ''] || status || '状态待同步'
}

function settlementHint(settlement: any) {
  if (settlement.status === 'DRAFT') return canFinanceAction.value ? '待财务提交商户确认' : '待财务复核并提交'
  if (settlement.status === 'PENDING_CONFIRMATION') return canMerchantAction.value ? '请商户确认或提出争议' : '已提交，等待商户确认'
  if (settlement.status === 'CONFIRMED') return canFinanceAction.value ? '商户已确认，待财务结算入账' : '已确认，等待财务结算'
  if (settlement.status === 'SETTLED') return '结算闭环完成，记录不可覆盖'
  if (settlement.status === 'VOID') return '结算单已作废，仅供审计查询'
  return '请刷新获取最新状态'
}

function workflowNote(settlement: any) {
  const history = settlement.detail?.workflowHistory
  if (!Array.isArray(history) || !history.length) return ''
  const latest = history[history.length - 1]
  if (!latest || typeof latest !== 'object') return ''
  const parts = []
  if (latest.reason) parts.push(`原因：${latest.reason}`)
  if (latest.at) parts.push(shortDate(latest.at))
  return parts.join(' · ')
}

function ratio(value: unknown) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed.toFixed(2) : '—'
}

function acting(key: string) {
  return actionKey.value === key
}

function settlementHasAction(settlement: any) {
  return (settlement.status === 'DRAFT' && canFinanceAction.value) ||
    (settlement.status === 'PENDING_CONFIRMATION' && canMerchantAction.value) ||
    (settlement.status === 'CONFIRMED' && canFinanceAction.value)
}

onShow(() => { void load() })
</script>

<template>
  <OperationsFrame
    title="财务结算"
    eyebrow="FINANCE & RECONCILIATION"
    :role="roleLabel"
    description="以营业日期为边界核对收入、退款、培训分成和联盟结算；每个财务动作都有状态、原因和复核责任。"
  >
    <view class="metric-grid">
      <MetricCard v-for="item in metrics" :key="item[0]" :label="item[0]" :value="item[1]" :note="item[2]" />
    </view>

    <view class="sync-bar card">
      <view>
        <text class="sync-title">数据同步</text>
        <text class="muted">{{ loading ? '正在同步经营账本…' : (lastSyncedAt ? `最近同步 ${lastSyncedAt}` : '尚未同步') }}</text>
      </view>
      <button class="secondary inline" :disabled="loading || Boolean(actionKey)" @tap="refresh">{{ loading ? '同步中' : '刷新' }}</button>
    </view>
    <view v-if="successMessage" class="notice success card">{{ successMessage }}</view>
    <view v-if="actionError" class="notice error card">{{ actionError }}</view>

    <view class="section-title">经营对账</view>
    <view class="card reconciliation">
      <view class="row"><text>场地收入</text><text class="money">{{ money(dashboard?.venue?.revenueCents) }}</text></view>
      <view class="row"><text>商品收入</text><text class="money">{{ money(dashboard?.goods?.revenueCents) }}</text></view>
      <view class="row"><text>培训确认收入</text><text class="money">{{ money(training?.confirmedRevenueCents ?? dashboard?.training?.confirmedRevenueCents) }}</text></view>
      <view class="row"><text>培训场馆合同分成</text><text class="money">{{ money(training?.venueContributionCents ?? dashboard?.training?.venueContributionCents) }}</text></view>
      <view class="row"><text>培训场地费</text><text class="money">{{ money(training?.venueFeeCents ?? dashboard?.training?.venueFeeCents) }}</text></view>
      <text v-if="loadErrors.dashboard || loadErrors.training" class="inline-error">{{ loadErrors.dashboard || loadErrors.training }}，当前数值可能不完整。</text>
      <text class="muted guardrail">口径锁定：培训占场只记资源占用，不收场地费；培训确认收入必须来自已复核消课，场馆合同分成按有效收入计算。</text>
    </view>

    <view class="section-title">
      退款审核
      <text class="section-note">{{ loading ? '同步中' : `${reviewRefunds.length} 笔待审` }}</text>
    </view>
    <view v-if="loadErrors.refunds" class="notice error card">
      <text>{{ loadErrors.refunds }}</text>
      <button class="ghost retry" :disabled="loading" @tap="refresh">重试</button>
    </view>
    <view v-if="loading && !activeRefunds.length" class="empty card">正在同步退款申请与通道状态…</view>
    <view v-for="refund in activeRefunds" :key="refund.id" class="card workflow-card">
      <view class="workflow-head">
        <view class="workflow-main">
          <text class="order-title">{{ refund.order.title || '退款申请' }}</text>
          <text class="muted">{{ refund.order.orderNo }} · {{ refund.refundNo || refund.id }}</text>
        </view>
        <view class="status-block">
          <StatusBadge :value="refund.status" />
          <text class="status-note">{{ refundStatusNote(refund.status) }}</text>
        </view>
      </view>
      <view class="detail-grid">
        <view><text class="detail-label">申请金额</text><text class="detail-value danger-money">{{ money(refund.amountCents) }}</text></view>
        <view><text class="detail-label">申请时间</text><text class="detail-value">{{ shortDate(refund.requestedAt) }}</text></view>
      </view>
      <view class="reason-box"><text class="detail-label">申请原因</text><text class="reason-text">{{ refund.reason || '未填写' }}</text></view>
      <view v-if="['REQUESTED', 'REFUND_PENDING'].includes(refund.status)" class="action-row">
        <button class="primary action-button" :disabled="loading || Boolean(actionKey)" @tap="approveRefund(refund)">{{ acting(`refund-approve:${refund.id}`) ? '批准中…' : '批准退款' }}</button>
        <button class="danger action-button" :disabled="loading || Boolean(actionKey)" @tap="rejectRefund(refund)">{{ acting(`refund-reject:${refund.id}`) ? '驳回中…' : '驳回申请' }}</button>
      </view>
    </view>
    <view v-if="!loading && !loadErrors.refunds && !activeRefunds.length" class="empty card">当前没有待审核或处理中的退款</view>

    <template v-if="canFinanceAction">
      <view class="section-title">
        账户调整复核
        <text class="section-note">{{ loading ? '同步中' : `${adjustments.length} 笔待审` }}</text>
      </view>
      <view v-if="loadErrors.adjustments" class="notice error card">
        <text>{{ loadErrors.adjustments }}</text>
        <button class="ghost retry" :disabled="loading" @tap="refresh">重试</button>
      </view>
      <view v-for="request in adjustments" :key="request.id" class="card workflow-card">
        <view class="workflow-head">
          <view class="workflow-main">
            <text class="order-title">{{ request.account?.user?.displayName || '会员账户' }}</text>
            <text class="muted">{{ request.account?.type }} · 申请人 {{ request.requestedBy?.displayName || request.requestedById }}</text>
          </view>
          <text class="state-chip state-draft">待复核</text>
        </view>
        <view class="detail-grid">
          <view><text class="detail-label">调整数额</text><text class="detail-value">{{ accountDelta(request) }}</text></view>
          <view><text class="detail-label">申请时间</text><text class="detail-value">{{ shortDate(request.createdAt) }}</text></view>
        </view>
        <view class="reason-box"><text class="detail-label">调整原因</text><text class="reason-text">{{ request.reason }}</text></view>
        <view v-if="isOwnAdjustment(request)" class="locked-note">制单人与复核人不能是同一账号，请由另一名财务或管理员处理。</view>
        <view v-else class="action-row">
          <button class="primary action-button" :disabled="loading || Boolean(actionKey)" @tap="reviewAdjustment(request, true)">{{ acting(`account-adjustment-approve:${request.id}`) ? '入账中…' : '复核入账' }}</button>
          <button class="danger action-button" :disabled="loading || Boolean(actionKey)" @tap="reviewAdjustment(request, false)">{{ acting(`account-adjustment-reject:${request.id}`) ? '驳回中…' : '驳回申请' }}</button>
        </view>
      </view>
      <view v-if="!loading && !loadErrors.adjustments && !adjustments.length" class="empty card">当前没有待复核账户调整</view>
    </template>

    <view class="section-title">
      培训结算
      <text class="section-note">{{ loading ? '同步中' : `${trainingSettlements.length} 张` }}</text>
    </view>
    <text class="section-description">财务制单、另一账号复核、确认后入账；账期一旦日结锁定，结算单不能再新建或变更。</text>
    <view class="card training-settlement-tools">
      <view class="period-picker-row">
        <picker mode="date" :value="trainingPeriodStartDate" @change="onTrainingPeriodStartChange">
          <view class="picker-field"><text class="detail-label">账期开始</text><text class="detail-value">{{ trainingPeriodStartDate }}</text></view>
        </picker>
        <picker mode="date" :value="trainingPeriodEndDate" @change="onTrainingPeriodEndChange">
          <view class="picker-field"><text class="detail-label">账期结束（不含）</text><text class="detail-value">{{ trainingPeriodEndDate }}</text></view>
        </picker>
      </view>
      <view class="training-tool-actions">
        <picker :range="trainingSettlementStatusOptions" range-key="label" :value="trainingSettlementStatusIndex" @change="onTrainingSettlementStatusChange">
          <view class="secondary filter-button">筛选：{{ trainingSettlementStatusOptions[trainingSettlementStatusIndex].label }}</view>
        </picker>
        <button class="primary inline training-create" :disabled="loading || Boolean(actionKey)" @tap="createTrainingSettlementDraft">
          {{ acting(`training-settlement-create:${trainingPeriodStartDate}:${trainingPeriodEndDate}`) ? '生成中…' : '生成账期草稿' }}
        </button>
      </view>
    </view>
    <view v-if="loadErrors.trainingSettlements" class="notice error card">
      <text>{{ loadErrors.trainingSettlements }}</text>
      <button class="ghost retry" :disabled="loading" @tap="refresh">重试</button>
    </view>
    <view v-if="loading && !trainingSettlements.length" class="empty card">正在同步培训结算账本…</view>
    <view v-for="statement in trainingSettlements" :key="statement.id" class="card workflow-card settlement-card">
      <view class="workflow-head">
        <view class="workflow-main">
          <text class="order-title">培训合同流水结算</text>
          <text class="muted">{{ trainingSettlementPeriod(statement) }}</text>
        </view>
        <text class="state-chip" :class="`state-${String(statement.status || '').toLowerCase()}`">{{ trainingSettlementStatusLabel(statement.status) }}</text>
      </view>
      <view class="settlement-numbers">
        <view><text class="detail-label">有效消课收入</text><text class="detail-value money">{{ money(statement.effectiveRevenueCents) }}</text></view>
        <view><text class="detail-label">场馆合同分成</text><text class="detail-value money">{{ money(statement.venueContributionCents) }}</text></view>
        <view><text class="detail-label">现金贡献毛利</text><text class="detail-value">{{ money(statement.cashContributionMarginCents) }}</text></view>
        <view><text class="detail-label">教练 / 助教成本</text><text class="detail-value">{{ money(statement.coachCostCents) }} / {{ money(statement.assistantCostCents) }}</text></view>
        <view><text class="detail-label">物料成本</text><text class="detail-value">{{ money(statement.materialCostCents) }}</text></view>
        <view><text class="detail-label">获客 / 营销成本</text><text class="detail-value">{{ money(statement.acquisitionCostCents) }} / {{ money(statement.marketingCostCents) }}</text></view>
      </view>
      <view class="state-guidance">
        <text>制单人：{{ statement.createdBy?.displayName || statement.createdById || '历史数据待补录' }}</text>
        <text v-if="trainingSettlementLatestNote(statement)" class="muted workflow-note">最近动作：{{ trainingSettlementLatestNote(statement) }}</text>
      </view>
      <view v-if="isOwnTrainingSettlement(statement) && ['PENDING_CONFIRMATION', 'CONFIRMED'].includes(statement.status)" class="locked-note">制单人与复核/入账人不能是同一账号，请切换另一名财务或管理员。</view>
      <view class="action-row">
        <button v-if="statement.status === 'DRAFT'" class="primary action-button" :disabled="loading || Boolean(actionKey)" @tap="changeTrainingSettlement(statement, 'submit')">{{ acting(`training-settlement-submit:${statement.id}`) ? '提交中…' : '提交复核' }}</button>
        <button v-if="statement.status === 'DRAFT'" class="danger action-button" :disabled="loading || Boolean(actionKey)" @tap="changeTrainingSettlement(statement, 'void')">{{ acting(`training-settlement-void:${statement.id}`) ? '作废中…' : '作废草稿' }}</button>
        <button v-if="statement.status === 'PENDING_CONFIRMATION' && !isOwnTrainingSettlement(statement)" class="primary action-button" :disabled="loading || Boolean(actionKey)" @tap="changeTrainingSettlement(statement, 'confirm')">{{ acting(`training-settlement-confirm:${statement.id}`) ? '确认中…' : '复核确认' }}</button>
        <button v-if="statement.status === 'PENDING_CONFIRMATION' && !isOwnTrainingSettlement(statement)" class="danger action-button" :disabled="loading || Boolean(actionKey)" @tap="changeTrainingSettlement(statement, 'return')">{{ acting(`training-settlement-return:${statement.id}`) ? '退回中…' : '退回草稿' }}</button>
        <button v-if="statement.status === 'CONFIRMED' && !isOwnTrainingSettlement(statement)" class="primary action-button" :disabled="loading || Boolean(actionKey)" @tap="changeTrainingSettlement(statement, 'settle')">{{ acting(`training-settlement-settle:${statement.id}`) ? '入账中…' : '确认结算入账' }}</button>
      </view>
    </view>
    <view v-if="!loading && !loadErrors.trainingSettlements && !trainingSettlements.length" class="empty card">当前筛选条件下没有培训结算单</view>

    <view class="section-title">
      前台现金差异复核
      <text class="section-note">{{ loading ? '同步中' : `${unreviewedShiftVariances.length} 个待复核班次` }}</text>
    </view>
    <text class="section-description">现金按实际收款操作员归属；班次操作人或关班人不能复核自己的差异，非零差异处理后才能完成日结关账。</text>
    <view v-if="loadErrors.shifts" class="notice error card">
      <text>{{ loadErrors.shifts }}</text>
      <button class="ghost retry" :disabled="loading" @tap="refresh">重试</button>
    </view>
    <view v-for="shift in unreviewedShiftVariances" :key="shift.id" class="card workflow-card">
      <view class="workflow-head">
        <view class="workflow-main">
          <text class="order-title">{{ shift.operator?.displayName || '前台班次' }}</text>
          <text class="muted">{{ shift.businessDateLabel || shortDate(shift.businessDate) }} · {{ shift.venueCode || 'MAIN' }}</text>
        </view>
        <text class="state-chip state-pending_confirmation">待差异复核</text>
      </view>
      <view class="settlement-numbers">
        <view><text class="detail-label">备用金</text><text class="detail-value">{{ money(shift.openingCashCents) }}</text></view>
        <view><text class="detail-label">账面现金</text><text class="detail-value">{{ money(shift.expectedCashCents) }}</text></view>
        <view><text class="detail-label">实际盘点</text><text class="detail-value">{{ money(shift.closingCashCents) }}</text></view>
        <view><text class="detail-label">现金差异</text><text class="detail-value danger-money">{{ money(shift.cashVarianceCents) }}</text></view>
      </view>
      <view v-if="[shift.operatorId, shift.closedById].includes(session.user?.id)" class="locked-note">你参与了本班次操作或关班，请切换另一名财务或管理员复核。</view>
      <view v-else class="action-row">
        <button class="primary action-button" :disabled="loading || Boolean(actionKey)" @tap="reviewShiftVariance(shift)">{{ acting(`shift-variance-review:${shift.id}`) ? '复核中…' : '复核现金差异' }}</button>
      </view>
    </view>
    <view v-if="!loading && !loadErrors.shifts && !unreviewedShiftVariances.length" class="empty card">当前没有待复核现金差异</view>

    <view class="section-title">日结与账期关账</view>
    <view v-if="loadErrors.reconciliation" class="notice error card">
      <text>{{ loadErrors.reconciliation }}</text>
      <button class="ghost retry" :disabled="loading" @tap="refresh">重试</button>
    </view>
    <view v-else class="card reconciliation-period">
      <view class="workflow-head">
        <view class="workflow-main">
          <text class="order-title">待关账营业日 {{ closeBusinessPeriod().date }}</text>
          <text class="muted">状态：{{ reconciliationStatusLabel(reconciliation?.status) }} · 异常 {{ reconciliation?.exceptionCount || 0 }} 项</text>
        </view>
        <StatusBadge :value="reconciliation?.status || 'OPEN'" />
      </view>
      <view class="settlement-numbers period-numbers">
        <view><text class="detail-label">支付流水</text><text class="detail-value">{{ reconciliationAmount('successfulPaymentCents') }}</text></view>
        <view><text class="detail-label">完成退款</text><text class="detail-value">{{ reconciliationAmount('completedRefundCents') }}</text></view>
        <view><text class="detail-label">培训确认收入</text><text class="detail-value">{{ reconciliationAmount('trainingEffectiveRevenueCents') }}</text></view>
        <view><text class="detail-label">联盟服务费</text><text class="detail-value">{{ reconciliationAmount('allianceCooperationFeeCents') }}</text></view>
      </view>
      <view v-if="reconciliation?.blockers?.length" class="blocker-list">
        <text v-for="blocker in reconciliation.blockers" :key="blocker.kind" class="blocker">{{ blocker.message }}</text>
      </view>
      <text class="muted period-note">只关已结束的营业日；当天数据保持实时。关账快照不可覆盖，未处理退款、支付或结算会先进入 REVIEW。</text>
      <button v-if="canFinanceAction && reconciliation?.status !== 'LOCKED'" class="primary period-close" :disabled="loading || Boolean(actionKey)" @tap="closeBusinessDay">
        {{ acting(`reconciliation-close:${closeBusinessPeriod().date}`) ? '提交中…' : reconciliation?.blocked ? '提交复核' : '核对并关账' }}
      </button>
      <view v-else-if="reconciliation?.status === 'LOCKED'" class="locked-note">该营业日已锁定，重复刷新不会产生新的关账记录。</view>
    </view>

    <view class="section-title">联盟结算草稿</view>
    <text class="section-description">先选择商户生成周期草稿；草稿金额来自唯一券核销归因，不能用手工预估替代。</text>
    <view v-if="loadErrors.merchants" class="notice error card">{{ loadErrors.merchants }}</view>
    <view v-for="merchant in merchants" :key="merchant.id" class="card merchant-row">
      <view class="workflow-main">
        <text class="order-title">{{ merchant.name }}</text>
        <text class="muted">{{ merchant.code || merchant.category || '联盟商户' }} · 仅统计已核销归因</text>
      </view>
      <button class="secondary inline" :disabled="loading || Boolean(actionKey) || !canFinanceAction" @tap="createSettlement(merchant)">{{ acting(`settlement-create:${merchant.id}`) ? '生成中…' : '生成草稿' }}</button>
    </view>
    <view v-if="loading && !merchants.length" class="empty card">正在同步联盟商户…</view>
    <view v-if="!loading && !loadErrors.merchants && !merchants.length" class="empty card">当前没有可结算联盟商户</view>

    <view class="section-title">
      联盟结算单
      <text class="section-note">{{ loading ? '同步中' : `${settlements.length} 张` }}</text>
    </view>
    <view v-if="loadErrors.settlements" class="notice error card">
      <text>{{ loadErrors.settlements }}</text>
      <button class="ghost retry" :disabled="loading" @tap="refresh">重试</button>
    </view>
    <view v-if="loading && !settlements.length" class="empty card">正在同步结算状态…</view>
    <view v-for="settlement in settlements" :key="settlement.id" class="card workflow-card settlement-card">
      <view class="workflow-head">
        <view class="workflow-main">
          <text class="order-title">{{ settlementMerchant(settlement) }}</text>
          <text class="muted">{{ settlementPeriod(settlement) }}</text>
        </view>
        <text class="state-chip" :class="`state-${String(settlement.status || '').toLowerCase()}`">{{ settlementStatusLabel(settlement.status) }}</text>
      </view>
      <view class="settlement-numbers">
        <view><text class="detail-label">发放 / 领取 / 核销</text><text class="detail-value">{{ settlement.issuedCount || 0 }} / {{ settlement.claimedCount || 0 }} / {{ settlement.redeemedCount || 0 }}</text></view>
        <view><text class="detail-label">有效新客</text><text class="detail-value">{{ settlement.effectiveNewCustomers || 0 }} 人</text></view>
        <view><text class="detail-label">归因 GMV</text><text class="detail-value">{{ money(settlement.attributedGmvCents) }}</text></view>
        <view><text class="detail-label">归因毛利</text><text class="detail-value">{{ money(settlement.attributedGrossProfitCents) }}</text></view>
        <view><text class="detail-label">应结服务费</text><text class="detail-value money">{{ money(settlement.cooperationFeeCents) }}</text></view>
        <view><text class="detail-label">ROI</text><text class="detail-value">{{ ratio(settlement.roi) }}</text></view>
      </view>
      <view class="state-guidance">
        <text>{{ settlementHint(settlement) }}</text>
        <text v-if="workflowNote(settlement)" class="muted workflow-note">{{ workflowNote(settlement) }}</text>
      </view>
      <view v-if="settlementHasAction(settlement)" class="action-row">
        <button v-if="settlement.status === 'DRAFT' && canFinanceAction" class="primary action-button" :disabled="loading || Boolean(actionKey)" @tap="submitSettlement(settlement)">{{ acting(`settlement-submit:${settlement.id}`) ? '提交中…' : '提交商户确认' }}</button>
        <button v-if="settlement.status === 'PENDING_CONFIRMATION' && canMerchantAction" class="primary action-button" :disabled="loading || Boolean(actionKey)" @tap="confirmSettlement(settlement)">{{ acting(`settlement-confirm:${settlement.id}`) ? '确认中…' : '确认账单' }}</button>
        <button v-if="settlement.status === 'PENDING_CONFIRMATION' && canMerchantAction" class="danger action-button" :disabled="loading || Boolean(actionKey)" @tap="disputeSettlement(settlement)">{{ acting(`settlement-dispute:${settlement.id}`) ? '提交中…' : '提出争议' }}</button>
        <button v-if="settlement.status === 'CONFIRMED' && canFinanceAction" class="primary action-button" :disabled="loading || Boolean(actionKey)" @tap="settleSettlement(settlement)">{{ acting(`settlement-settle:${settlement.id}`) ? '入账中…' : '确认结算入账' }}</button>
      </view>
    </view>
    <view v-if="!loading && !loadErrors.settlements && !settlements.length" class="empty card">当前没有联盟结算单，可先从商户生成草稿</view>

    <view class="card boundary">
      <text class="muted">岗位边界：财务负责退款复核、结算提交与最终入账；商户负责确认或提出争议。前台签到、教练消课、商户券码核销均由原岗位完成，财务不越权代办。</text>
    </view>
  </OperationsFrame>
</template>

<style scoped>
.metric-grid { display:grid; grid-template-columns:repeat(2,1fr); gap:14rpx; margin-top:22rpx; }
.sync-bar { display:flex; align-items:center; justify-content:space-between; gap:18rpx; margin-top:20rpx; padding:20rpx 24rpx; }
.sync-title { display:block; margin-bottom:6rpx; font-size:27rpx; font-weight:800; }
.notice { display:flex; align-items:center; justify-content:space-between; gap:14rpx; margin-top:16rpx; line-height:1.6; }
.success { color:#17653d; background:#e8f4eb; }
.error { color:#8a3636; background:#fbeaea; }
.reconciliation { margin-top:22rpx; }
.reconciliation .row { padding:14rpx 0; border-bottom:1rpx solid #edf0ed; }
.guardrail { display:block; margin-top:16rpx; line-height:1.6; }
.inline-error { display:block; margin-top:14rpx; color:#a24c35; font-size:22rpx; }
.section-note { color:#758079; font-size:22rpx; font-weight:400; }
.section-description { display:block; margin:-10rpx 2rpx 12rpx; color:#758079; font-size:22rpx; line-height:1.55; }
.workflow-card { margin-top:14rpx; padding:24rpx; }
.workflow-head { display:flex; align-items:flex-start; justify-content:space-between; gap:16rpx; }
.workflow-main { min-width:0; flex:1; }
.order-title { display:block; margin-bottom:8rpx; font-size:28rpx; font-weight:800; }
.status-block { display:flex; flex-direction:column; align-items:flex-end; gap:7rpx; }
.status-note { max-width:220rpx; color:#758079; font-size:19rpx; line-height:1.35; text-align:right; }
.detail-grid,.settlement-numbers { display:grid; grid-template-columns:repeat(2,1fr); gap:14rpx; margin-top:20rpx; padding-top:18rpx; border-top:1rpx solid #edf0ed; }
.settlement-numbers { grid-template-columns:repeat(3,1fr); }
.detail-label { display:block; color:#7a857e; font-size:20rpx; }
.detail-value { display:block; margin-top:6rpx; color:#26332b; font-size:24rpx; font-weight:700; }
.danger-money { color:#a24c35; }
.reason-box,.state-guidance { margin-top:18rpx; padding:16rpx; background:#f4f7f4; border-radius:14rpx; }
.reason-text { display:block; margin-top:7rpx; color:#38473e; font-size:23rpx; line-height:1.55; }
.state-guidance { color:#52635a; font-size:22rpx; line-height:1.55; }
.workflow-note { display:block; margin-top:6rpx; }
.action-row { display:flex; flex-wrap:wrap; justify-content:flex-end; gap:12rpx; margin-top:20rpx; }
.action-button { min-width:176rpx; min-height:64rpx; margin:0; padding:0 20rpx; line-height:64rpx; font-size:22rpx; }
.danger { color:#8a3636; background:#fbeaea; border:1rpx solid #efcaca; }
.merchant-row { display:flex; align-items:center; justify-content:space-between; gap:14rpx; margin-top:12rpx; padding:20rpx 24rpx; }
.inline { min-width:116rpx; min-height:58rpx; margin:0; padding:0 16rpx; line-height:58rpx; font-size:22rpx; }
.retry { min-width:92rpx; min-height:50rpx; margin:0; padding:0 14rpx; color:#8a3636; line-height:50rpx; font-size:20rpx; }
.ghost { background:#eef2ef; }
.state-chip { flex:0 0 auto; padding:8rpx 14rpx; color:#56645b; background:#eef2ef; border-radius:999rpx; font-size:21rpx; }
.state-pending_confirmation,.state-draft { color:#9b6300; background:#fff2d6; }
.state-confirmed,.state-settled { color:#17653d; background:#e5f3e9; }
.state-void { color:#8a3636; background:#fbeaea; }
.empty { margin-top:14rpx; color:#758079; text-align:center; }
.boundary { margin-top:26rpx; line-height:1.7; }
.reconciliation-period { margin-top:14rpx; }
.period-numbers { margin-top:16rpx; }
.blocker-list { display:flex; flex-direction:column; gap:8rpx; margin-top:16rpx; padding:14rpx 16rpx; background:#fff4d8; border-radius:14rpx; }
.blocker { color:#8a5d12; font-size:21rpx; line-height:1.45; }
.period-note { display:block; margin-top:16rpx; line-height:1.55; }
.period-close { width:100%; margin-top:18rpx; }
.locked-note { margin-top:18rpx; padding:14rpx; color:#17653d; background:#e8f4eb; border-radius:14rpx; font-size:22rpx; text-align:center; }
.training-settlement-tools { margin-top:14rpx; padding:22rpx 24rpx; }
.period-picker-row { display:grid; grid-template-columns:repeat(2,1fr); gap:14rpx; }
.picker-field { padding:16rpx; background:#f4f7f4; border-radius:14rpx; }
.training-tool-actions { display:flex; align-items:center; justify-content:space-between; gap:14rpx; margin-top:18rpx; }
.filter-button { padding:14rpx 18rpx; border-radius:12rpx; font-size:22rpx; }
.training-create { min-width:190rpx; }
button[disabled] { opacity:.5; }
</style>
