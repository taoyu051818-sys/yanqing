<script setup lang="ts">
import { computed, nextTick, reactive, ref } from 'vue'
import { onLoad, onShow } from '@dcloudio/uni-app'
import OperationsFrame from '../../components/OperationsFrame.vue'
import OperationTask from '../../components/OperationTask.vue'
import { useOperationTask, reasonField } from '../../components/operation-task'
import MetricCard from '../../../../components/MetricCard.vue'
import { hasOperationsAccess } from '../../../../config/operations'
import { endpoints } from '../../../../services/api'
import { useSessionStore } from '../../../../stores/session'
import type { Member360View, MemberDirectoryItem } from '../../../../types/domain'
import { withPendingCreationKey } from '../../../../utils/pending-creation-key'
import { money } from '../../../../utils/format'
import {
  findOpsDeepLinkRecord,
  opsDeepLinkDomId,
  parseOpsDeepLinkQuery,
  type OpsDeepLinkQuery,
} from '../../../../utils/work-item-deep-link'

const task = useOperationTask()
const session = useSessionStore()
const members = ref<MemberDirectoryItem[]>([])
const leads = ref<any[]>([])
const hostApplications = ref<any[]>([])
const rechargePlans = ref<any[]>([])
const membershipProducts = ref<any[]>([])
const customer = ref<Member360View | null>(null)
const query = ref('')
const loading = ref(false)
const loadError = ref('')
const membersLoaded = ref(false)
const leadsLoaded = ref(false)
const hostApplicationsLoaded = ref(false)
const rechargePlansLoaded = ref(false)
const membershipProductSubmitting = ref(false)
const membershipProductError = ref('')
const membershipProductSource = ref<any>(null)
const selectedId = ref('')
const tab = ref<'members' | 'leads' | 'membershipProducts' | 'rechargePlans'>('members')
const deepLinkQuery = ref<OpsDeepLinkQuery>({})
const deepLinkHandled = ref(false)
const focusedRecord = ref('')
const sourceOptions = [
  { value: 'STORE_VISIT', label: '到店' }, { value: 'DOUYIN', label: '抖音' },
  { value: 'MEITUAN', label: '美团' }, { value: 'REFERRAL', label: '直接推荐' },
  { value: 'ALLIANCE', label: '联盟商户' }, { value: 'OTHER', label: '其他' },
]
const createForm = reactive({ displayName: '', phone: '', sourceChannel: 'STORE_VISIT', campaign: '' })
const rechargePlanForm = reactive({
  code: '', name: '', principalYuan: '', giftYuan: '0',
  effectiveFrom: new Date().toISOString().slice(0, 10),
  effectiveTo: '2099-01-01', reason: '',
})
const memberLevelOptions = [
  { value: 'EXPERIENCE', label: '体验会员' },
  { value: 'REGULAR', label: '普通会员' },
  { value: 'GOLD', label: '金卡会员' },
  { value: 'BLACK', label: '黑金会员' },
]
const membershipProductForm = reactive({
  code: '', name: '', level: 'REGULAR', priceYuan: '', durationDays: '365',
  bookingBenefit: '', discountBenefit: '', additionalBenefit: '',
  effectiveFrom: new Date().toISOString().slice(0, 10),
  effectiveTo: '2099-01-01', reason: '',
})
const leadLabels: Record<string, string> = {
  NEW: '新线索', CONTACTING: '跟进中', TRIAL_RESERVED: '已约体验', ATTENDED: '已到店',
  CONVERTED: '已转会员', LOST: '已流失', ARCHIVED: '已归档',
}
const accountLabels: Record<string, string> = {
  CASH_PRINCIPAL: '现金本金', GIFT_BALANCE: '赠送余额', BADMINTON_COIN: '羽毛球币',
  EVENT_POINTS: '成人赛事积分', GROWTH_POINTS: '青少年成长积分', YOUTH_GROWTH_POINTS: '青少年成长积分',
}
const memberLevelLabels: Record<string, string> = {
  EXPERIENCE: '体验会员', BASIC: '基础会员', REGULAR: '普通会员', GOLD: '金卡会员',
  BLACK: '黑金会员', STAFF: '员工会员',
}
const benefitLabels: Record<string, string> = {
  booking: '订场权益', discount: '会员折扣', guest: '同行权益', training: '培训权益',
  event: '赛事权益', additional: '其他权益',
}
const accountLabel = (type?: string) => accountLabels[type || ''] || '其他账户'
const memberLevelLabel = (level?: string) => memberLevelLabels[level || ''] || '普通会员'
const leadSourceLabel = (source?: string) => sourceOptions.find((item) => item.value === source)?.label || '其他来源'
const accountBalance = (account: any) =>
  ['CASH_PRINCIPAL', 'GIFT_BALANCE'].includes(account.type) ? money(account.balance) : `${account.balance || 0}`
const canViewLeads = computed(() => session.roles.some((role) => ['FRONT_DESK', 'COACH', 'ADMIN', 'SUPER_ADMIN'].includes(role)))
const canWriteLeads = computed(() => session.roles.some((role) => ['FRONT_DESK', 'ADMIN', 'SUPER_ADMIN'].includes(role)))
const canReviewHosts = computed(() => session.roles.some((role) => ['ADMIN', 'SUPER_ADMIN'].includes(role)))
const canRequestAdjustments = computed(() => session.roles.some((role) => ['FINANCE', 'ADMIN', 'SUPER_ADMIN'].includes(role)))
const canManageRechargePlans = computed(() => session.roles.some((role) => ['ADMIN', 'SUPER_ADMIN'].includes(role)))
const canViewMembershipProducts = computed(() => session.roles.some((role) => ['FRONT_DESK', 'ADMIN', 'SUPER_ADMIN'].includes(role)))
const canManageMembershipProducts = computed(() => session.roles.some((role) => ['ADMIN', 'SUPER_ADMIN'].includes(role)))
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
  if (!hasOperationsAccess(session.roles, 'members')) return
  loading.value = true
  loadError.value = ''
  membersLoaded.value = false
  leadsLoaded.value = false
  hostApplicationsLoaded.value = false
  rechargePlansLoaded.value = false
  membershipProductError.value = ''
  const results = await Promise.allSettled([
    endpoints.members(),
    canViewLeads.value ? endpoints.customerLeads() : Promise.resolve({ items: [] }),
    canReviewHosts.value ? endpoints.hostApplications() : Promise.resolve([]),
    canManageRechargePlans.value ? endpoints.manageRechargePlans() : Promise.resolve([]),
    canViewMembershipProducts.value ? endpoints.manageMembershipProducts() : Promise.resolve([]),
  ])
  const [memberResult, leadResult, hostResult, rechargePlanResult, membershipProductResult] = results
  if (memberResult.status === 'fulfilled') {
    members.value = memberResult.value.items || []
    membersLoaded.value = true
  }
  if (leadResult.status === 'fulfilled') {
    leads.value = leadResult.value.items || []
    leadsLoaded.value = true
  }
  if (hostResult.status === 'fulfilled') {
    hostApplications.value = hostResult.value || []
    hostApplicationsLoaded.value = true
  }
  if (rechargePlanResult.status === 'fulfilled') {
    rechargePlans.value = rechargePlanResult.value || []
    rechargePlansLoaded.value = true
  }
  if (membershipProductResult.status === 'fulfilled') membershipProducts.value = membershipProductResult.value || []
  else if (canViewMembershipProducts.value) membershipProductError.value = membershipProductResult.reason?.message || '会员产品版本加载失败'
  const failedSources = [
    memberResult.status === 'rejected' ? '会员目录' : '',
    canViewLeads.value && leadResult.status === 'rejected' ? '客户线索' : '',
    canReviewHosts.value && hostResult.status === 'rejected' ? '主理人申请' : '',
    canManageRechargePlans.value && rechargePlanResult.status === 'rejected' ? '充值计划' : '',
  ].filter(Boolean)
  if (failedSources.length) loadError.value = `${failedSources.join('、')}加载失败；未同步列表不会按空数据展示。`
  loading.value = false
  await applyMemberDeepLink()
}

async function applyMemberDeepLink() {
  if (deepLinkHandled.value || !deepLinkQuery.value.focus) return
  const focus = deepLinkQuery.value.focus
  let record: any = null
  let prefix = ''
  let label = '客户记录'
  if (focus === 'lead') {
    tab.value = 'leads'
    record = findOpsDeepLinkRecord(leads.value, deepLinkQuery.value, ['id'])
    prefix = 'lead'
    label = '客户线索'
  } else if (focus === 'host-application') {
    tab.value = 'members'
    record = findOpsDeepLinkRecord(hostApplications.value, deepLinkQuery.value, ['id', 'userId'])
    prefix = 'host-application'
    label = '主理人申请'
  } else if (focus === 'member') {
    tab.value = 'members'
    record = findOpsDeepLinkRecord(members.value as any[], deepLinkQuery.value, ['id'])
    prefix = 'member'
    label = '会员'
    if (record) await selectMember(record)
  } else {
    deepLinkHandled.value = true
    uni.showToast({ title: `无法识别客户待办类型：${focus}`, icon: 'none' })
    return
  }
  deepLinkHandled.value = true
  if (!record) {
    uni.showToast({ title: `未找到待办对应的${label}，可能已处理或无权查看`, icon: 'none' })
    return
  }
  focusedRecord.value = `${prefix}:${record.id}`
  await nextTick()
  uni.pageScrollTo({ selector: `#${opsDeepLinkDomId(prefix, record.id)}`, duration: 250 })
}

async function selectMember(member: MemberDirectoryItem) {
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

function assign(lead: any) {
  if (!canWriteLeads.value) return
  task.start({ title: '分配负责人', description: lead.displayName + ' · 仅显示当前可接收线索的在岗员工。', confirmText: '确认分配',
    fields: [{ key: 'ownerId', label: '负责人', kind: 'search', search: async (keyword, page) => {
      const result = await endpoints.leadOwners({ keyword, page, pageSize: 20 })
      const labels: Record<string,string> = { FRONT_DESK: '前台', COACH: '教练', ADMIN: '管理员', SUPER_ADMIN: '总管理员' }
      return { total: result.total, items: result.items.map((item: any) => ({ value: item.id, label: item.displayName, description: item.roles.map((role: string) => labels[role]).join(' / ') })) }
    } }],
    submit: async values => { await endpoints.assignCustomerLead(lead.id, values.ownerId); await refreshLeads('已分配'); return '负责人已更新，可在该线索继续跟进。' },
  })
}

function followUp(lead: any) {
  task.start({ title: '记录客户跟进', description: lead.displayName + ' · 按实际沟通结果选择阶段，不会自动推进。', confirmText: '保存跟进',
    fields: [
      { key: 'content', label: '沟通结果', min: 2, max: 1000 },
      { key: 'nextStatus', label: '当前阶段', kind: 'choices', initial: lead.status, options: ['NEW','CONTACTING','TRIAL_RESERVED','ATTENDED'].filter((status, index, all) => index >= all.indexOf(lead.status)).map(value => ({ value, label: leadLabels[value] })) },
    ],
    submit: async values => { await endpoints.followUpCustomerLead(lead.id, { kind: 'WECHAT', ...values }); await refreshLeads('跟进已保存'); return '沟通记录与阶段已同步。' },
  })
}

function convert(lead: any) {
  task.start({ title: '线索转为会员', description: lead.displayName + ' · 搜索并核对实际注册会员，转换后保留来源与跟进历史。', confirmText: '确认关联会员',
    fields: [{ key: 'memberId', label: '会员', kind: 'search', search: async (keyword, page) => {
      const result = await endpoints.members({ keyword, page, pageSize: 20 })
      return { total: result.total, items: result.items.map((item: any) => ({ value: item.id, label: item.displayName, description: item.phone || '未提供联系电话' })) }
    } }],
    submit: async values => { await endpoints.convertCustomerLead(lead.id, values.memberId); await refreshLeads('已转为会员'); return '线索已关联会员，可从会员360继续服务。' },
  })
}

function lose(lead: any) {
  task.start({ title: '标记线索流失', description: lead.displayName + ' · 关闭当前跟进，不删除历史。', confirmText: '确认标记流失',
    fields: [reasonField('流失原因', ['暂时无运动计划','时间无法安排','选择其他场馆'])],
    submit: async ({ reason }) => { await endpoints.loseCustomerLead(lead.id, reason); await refreshLeads('已标记流失'); return '线索已关闭，原因保留在跟进记录。' },
  })
}

function reviewHost(application: any, approved: boolean) {
  task.start({ title: approved ? '批准主理人申请' : '驳回主理人申请',
    description: (application.displayName || application.user?.displayName || '当前申请人') + (approved ? ' · 确认后授予主理人能力，操作记入审计。' : ' · 驳回不授予权限。'),
    confirmText: approved ? '确认授予主理人' : '确认驳回', fields: [reasonField('审批意见')],
    submit: async ({ reason }) => {
      if (approved) await endpoints.approveHost(application.userId, { reason })
      else await endpoints.rejectHost(application.userId, reason)
      hostApplications.value = await endpoints.hostApplications()
      return approved ? '申请已批准，权限由服务器重新核验后生效。' : '申请已驳回，审批意见已记录。'
    },
  })
}

function requestAccountAdjustment() {
  const accounts = customer.value?.accounts || []
  const memberId = selectedId.value
  if (!memberId || !accounts.length) return
  task.start({ title: '申请账户调整', description: (customer.value?.member?.displayName || '当前会员') + ' · 提交不会立即改变余额，必须由另一名财务或管理员复核。', confirmText: '提交独立复核',
    fields: [
      { key: 'accountType', label: '调整账户', kind: 'choices', options: accounts.map((account: any) => ({ value: account.type, label: accountLabel(account.type), description: '当前 ' + accountBalance(account) })) },
      { key: 'amount', label: '增减数额', hint: '金额账户填元，其余账户填整数；扣减带负号，例如 -20。' },
      reasonField('调整依据'),
    ],
    submit: async ({ accountType, amount: raw, reason }) => {
      const isMoney = ['CASH_PRINCIPAL','GIFT_BALANCE'].includes(accountType)
      if (isMoney ? !/^-?\d+(\.\d{1,2})?$/.test(raw) : !/^-?\d+$/.test(raw)) throw new Error('调整数额格式不正确')
      const amount = isMoney ? Math.round(Number(raw) * 100) : Number(raw)
      if (!Number.isSafeInteger(amount) || amount === 0) throw new Error('调整数额不能为0')
      const command = { memberId, accountType, amount, reason }
      await withPendingCreationKey('account.adjustment.' + memberId + '.' + accountType, command, idempotencyKey =>
        endpoints.createAccountAdjustment(memberId, { accountType, amount, reason, idempotencyKey }))
      return '调整申请已提交，余额尚未改变，请等待独立复核。'
    },
  })
}

const yuanToCents = (value: string) => {
  const normalized = value.trim()
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) return NaN
  return Math.round(Number(normalized) * 100)
}

const effectiveIso = (value: string) => {
  const normalized = value.trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(normalized))
    return new Date(`${normalized}T00:00:00+08:00`).toISOString()
  const date = new Date(normalized)
  return Number.isNaN(date.getTime()) ? '' : date.toISOString()
}

async function refreshRechargePlans(message: string) {
  rechargePlans.value = await endpoints.manageRechargePlans()
  uni.showToast({ title: message, icon: 'success' })
}

async function createRechargePlan() {
  const principalCents = yuanToCents(rechargePlanForm.principalYuan)
  const giftCents = yuanToCents(rechargePlanForm.giftYuan)
  const effectiveFrom = effectiveIso(rechargePlanForm.effectiveFrom)
  const effectiveTo = effectiveIso(rechargePlanForm.effectiveTo)
  if (!/^[A-Z0-9][A-Z0-9_-]{1,39}$/.test(rechargePlanForm.code.trim()))
    return uni.showToast({ title: '计划编码需为大写字母、数字、下划线或横线', icon: 'none' })
  if (rechargePlanForm.name.trim().length < 2)
    return uni.showToast({ title: '请填写计划名称', icon: 'none' })
  if (!Number.isSafeInteger(principalCents) || principalCents < 100)
    return uni.showToast({ title: '充值本金无效', icon: 'none' })
  if (!Number.isSafeInteger(giftCents) || giftCents < 0 || giftCents > principalCents)
    return uni.showToast({ title: '赠送金额不得超过本金', icon: 'none' })
  if (!effectiveFrom || !effectiveTo || new Date(effectiveTo) <= new Date(effectiveFrom))
    return uni.showToast({ title: '有效期无效', icon: 'none' })
  const reason = rechargePlanForm.reason.trim()
  if (reason.length < 2) return uni.showToast({ title: '请填写创建原因', icon: 'none' })
  const command = {
    code: rechargePlanForm.code.trim(), name: rechargePlanForm.name.trim(),
    principalCents, giftCents, effectiveFrom, effectiveTo, reason,
  }
  try {
    await withPendingCreationKey('membership.recharge-plan.create', command, (idempotencyKey) =>
      endpoints.createRechargePlan({ ...command, idempotencyKey }),
    )
    Object.assign(rechargePlanForm, { code: '', name: '', principalYuan: '', giftYuan: '0', reason: '' })
    await refreshRechargePlans('充值计划版本已创建')
  } catch (cause: any) { uni.showToast({ title: cause.message || '创建失败', icon: 'none' }) }
}

function setRechargePlanStatus(plan: any) {
  const enabled = !plan.enabled
  task.start({ title: enabled ? '启用充值计划' : '停用充值计划', description: plan.name + ' · 只影响后续销售，历史本金和赠送权益不改变。',
    confirmText: enabled ? '确认启用' : '确认停用', fields: [reasonField('变更依据')],
    submit: async ({ reason }) => {
      await withPendingCreationKey('membership.recharge-plan.status.' + plan.id, { planId: plan.id, enabled, reason }, idempotencyKey => endpoints.setRechargePlanStatus(plan.id, { enabled, reason, idempotencyKey }))
      await refreshRechargePlans('状态已更新'); return '充值计划状态已更新，历史订单保持不变。'
    },
  })
}

function resetMembershipProductForm() {
  membershipProductSource.value = null
  Object.assign(membershipProductForm, {
    code: '', name: '', level: 'REGULAR', priceYuan: '', durationDays: '365',
    bookingBenefit: '', discountBenefit: '', additionalBenefit: '',
    effectiveFrom: new Date().toISOString().slice(0, 10),
    effectiveTo: '2099-01-01', reason: '',
  })
}

function beginMembershipProductVersion(product: any) {
  membershipProductSource.value = product
  const benefits = product.benefits || {}
  const fallbackBenefits = Object.entries(benefits)
    .filter(([key]) => !['booking', 'discount', 'additional'].includes(key))
    .map(([key, value]) => `${key}：${String(value)}`)
    .join('；')
  Object.assign(membershipProductForm, {
    code: product.code,
    name: product.name,
    level: product.level,
    priceYuan: (Number(product.priceCents || 0) / 100).toFixed(2).replace(/\.00$/, ''),
    durationDays: String(product.durationDays || 365),
    bookingBenefit: String(benefits.booking || ''),
    discountBenefit: String(benefits.discount || ''),
    additionalBenefit: String(benefits.additional || fallbackBenefits),
    effectiveFrom: new Date().toISOString().slice(0, 10),
    effectiveTo: '2099-01-01',
    reason: '',
  })
  uni.pageScrollTo({ scrollTop: 0, duration: 200 })
}

function changeMemberLevel(event: any) {
  membershipProductForm.level = memberLevelOptions[Number(event.detail.value)]?.value || 'REGULAR'
}

function membershipBenefits(product: any) {
  const entries = Object.entries(product?.benefits || {})
  if (!entries.length) return '未配置权益说明'
  return entries.map(([key, value]) => `${benefitLabels[key] || '其他权益'}：${String(value)}`).join('；')
}

async function refreshMembershipProducts(message?: string) {
  membershipProductError.value = ''
  try {
    membershipProducts.value = await endpoints.manageMembershipProducts()
    if (message) uni.showToast({ title: message, icon: 'success' })
  } catch (cause: any) {
    membershipProductError.value = cause?.message || '会员产品版本加载失败'
  }
}

async function createMembershipProductVersion() {
  if (!canManageMembershipProducts.value || membershipProductSubmitting.value) return
  const source = membershipProductSource.value
  const code = membershipProductForm.code.trim()
  const name = membershipProductForm.name.trim()
  const priceCents = yuanToCents(membershipProductForm.priceYuan)
  const durationDays = Number(membershipProductForm.durationDays)
  const effectiveFrom = effectiveIso(membershipProductForm.effectiveFrom)
  const effectiveTo = membershipProductForm.effectiveTo.trim()
    ? effectiveIso(membershipProductForm.effectiveTo)
    : ''
  const reason = membershipProductForm.reason.trim()
  if (!source && !/^[A-Z0-9][A-Z0-9_-]{1,39}$/.test(code))
    return uni.showToast({ title: '产品编码格式无效', icon: 'none' })
  if (name.length < 2 || name.length > 80)
    return uni.showToast({ title: '产品名称需为2-80个字', icon: 'none' })
  if (!Number.isSafeInteger(priceCents) || priceCents < 0)
    return uni.showToast({ title: '会员价格无效', icon: 'none' })
  if (!Number.isSafeInteger(durationDays) || durationDays < 1 || durationDays > 3650)
    return uni.showToast({ title: '有效天数需为1-3650天', icon: 'none' })
  if (!effectiveFrom || (membershipProductForm.effectiveTo.trim() && !effectiveTo) || (effectiveTo && new Date(effectiveTo) <= new Date(effectiveFrom)))
    return uni.showToast({ title: '产品生效区间无效', icon: 'none' })
  if (reason.length < 2 || reason.length > 300)
    return uni.showToast({ title: '请填写2-300字创建原因', icon: 'none' })
  const benefits = {
    booking: membershipProductForm.bookingBenefit.trim(),
    discount: membershipProductForm.discountBenefit.trim(),
    additional: membershipProductForm.additionalBenefit.trim(),
  }
  if (!Object.values(benefits).some(Boolean))
    return uni.showToast({ title: '至少填写一项会员权益', icon: 'none' })
  const confirmed = await uni.showModal({
    title: source ? `确认创建 ${source.code} 新版本` : '确认创建会员产品',
    content: `${name} · ${money(priceCents)} · ${durationDays}天\n创建后条款不可覆盖，新版本默认停用，需另行启用。`,
    confirmText: '创建停用版本',
  })
  if (!confirmed.confirm) return
  const command: Record<string, any> = {
    name, level: membershipProductForm.level, priceCents, durationDays, benefits,
    effectiveFrom, reason,
  }
  if (effectiveTo) command.effectiveTo = effectiveTo
  if (!source) command.code = code
  membershipProductSubmitting.value = true
  try {
    await withPendingCreationKey(
      source ? `membership.product.version.${source.id}` : 'membership.product.create',
      { sourceProductId: source?.id || null, ...command },
      (idempotencyKey) => source
        ? endpoints.createMembershipProductVersion(source.id, { ...command, idempotencyKey })
        : endpoints.createMembershipProduct({ ...command, idempotencyKey }),
    )
    resetMembershipProductForm()
    await refreshMembershipProducts('会员产品版本已创建')
  } catch (cause: any) {
    uni.showToast({ title: cause?.message || '会员产品创建失败', icon: 'none' })
  } finally {
    membershipProductSubmitting.value = false
  }
}

function setMembershipProductStatus(product: any) {
  if (!canManageMembershipProducts.value || membershipProductSubmitting.value) return
  const enabled = !product.enabled
  task.start({ title: enabled ? '启用会员产品' : '停用会员产品', description: product.name + ' · 只影响后续销售，历史订单与订阅不改变。',
    confirmText: enabled ? '确认启用' : '确认停用', fields: [reasonField('变更依据')],
    submit: async ({ reason }) => {
      await withPendingCreationKey('membership.product.status.' + product.id, { productId: product.id, enabled, reason }, idempotencyKey => endpoints.setMembershipProductStatus(product.id, { enabled, reason, idempotencyKey }))
      await refreshMembershipProducts('状态已更新'); return '会员产品状态已更新，历史订阅保留。'
    },
  })
}

function changeSource(event: any) {
  createForm.sourceChannel = sourceOptions[Number(event.detail.value)]?.value || 'STORE_VISIT'
}

onLoad((options) => {
  deepLinkQuery.value = parseOpsDeepLinkQuery(options)
})
onShow(load)
</script>

<template>
  <OperationsFrame access="members" icon="members" title="客户经营" eyebrow="CRM & MEMBER 360" role="前台 / 教练 / 财务" description="线索先进入责任队列，跟进记录只追加；转化后关联现有会员并进入客户360。">
    <OperationTask :task="task" />
    <view class="metric-grid"><MetricCard v-for="item in metrics" :key="item[0]" :label="item[0]" :value="item[1]" :note="item[2]" /></view>
    <view v-if="loadError" class="card load-error"><view><text class="member-name">客户数据未完整同步</text><text class="muted block">{{ loadError }}</text></view><button class="secondary retry-button" :disabled="loading" @tap="load">重新加载</button></view>
    <view class="tabs card"><button class="tab" :class="{ active: tab === 'members' }" @tap="tab = 'members'">会员360</button><button v-if="canViewLeads" class="tab" :class="{ active: tab === 'leads' }" @tap="tab = 'leads'">客户线索</button><button v-if="canViewMembershipProducts" class="tab" :class="{ active: tab === 'membershipProducts' }" @tap="tab = 'membershipProducts'">会员产品</button><button v-if="canManageRechargePlans" class="tab" :class="{ active: tab === 'rechargePlans' }" @tap="tab = 'rechargePlans'">充值计划</button></view>
    <view v-if="tab === 'members' || tab === 'leads'" class="search-card card"><input v-model="query" class="input" :placeholder="tab === 'members' ? '输入姓名或手机号后四位查询会员' : '搜索姓名、来源活动'" confirm-type="search" /></view>

    <template v-if="tab === 'members'">
      <view v-if="canReviewHosts" class="card host-queue">
        <view class="section-title">主理人申请 <text class="section-note">{{ hostApplications.length }} 条待审批</text></view>
        <view v-for="application in hostApplications" :id="opsDeepLinkDomId('host-application', application.id)" :key="application.id" class="host-row" :class="{ 'deep-link-target': focusedRecord === `host-application:${application.id}` }">
          <view><text class="member-name">{{ application.user?.displayName }}</text><text class="muted">{{ application.user?.phone || '未登记手机号' }} · 到店 {{ application.user?.memberProfile?.visitCount || 0 }} 次</text></view>
          <view class="actions"><button size="mini" @tap="reviewHost(application, true)">批准</button><button size="mini" @tap="reviewHost(application, false)">驳回</button></view>
        </view>
        <text v-if="!loading && hostApplicationsLoaded && !hostApplications.length" class="muted">当前没有待审批主理人申请</text>
      </view>
      <view class="section-title">会员列表 <text class="section-note">{{ loading ? '同步中' : membersLoaded ? `${filteredMembers.length} 人` : '未同步' }}</text></view>
      <view v-for="member in filteredMembers" :id="opsDeepLinkDomId('member', member.id)" :key="member.id" class="card member-row" :class="{ selected: selectedId === member.id, 'deep-link-target': focusedRecord === `member:${member.id}` }" @tap="selectMember(member)"><view><text class="member-name">{{ member.displayName || '未命名会员' }}</text><text class="muted">{{ member.phone || '联系方式按角色隐藏' }} · {{ memberLevelLabel(member.level || member.memberProfile?.level) }}</text></view><text class="select-mark">{{ selectedId === member.id ? '已载入' : '查看360' }}</text></view>
      <view v-if="!loading && membersLoaded && !filteredMembers.length" class="card empty">{{ query.trim() ? '没有匹配的会员' : '当前服务范围内暂无会员' }}</view>
      <view v-if="customer" class="card customer-card">
        <view class="section-title">{{ customer.member?.displayName }} · 客户360</view>
        <text class="muted">订单 {{ customer.recentOrders?.length || 0 }} · 培训 {{ customer.recentTraining?.length || 0 }} · 球局 {{ customer.recentGames?.length || 0 }} · 赛事 {{ customer.recentEvents?.length || 0 }} · 券 {{ customer.recentCoupons?.length || 0 }}</text>
        <view v-if="customer.paymentSummary" class="account-grid">
          <view class="account"><text>储值可支付合计</text><text class="account-value">{{ money(customer.paymentSummary.storedValueAvailableCents) }}</text></view>
          <view class="account"><text>可用羽毛球币</text><text class="account-value">{{ customer.paymentSummary.badmintonCoinAvailable }}</text></view>
        </view>
        <view v-if="customer.accounts?.length" class="account-grid"><view v-for="account in customer.accounts" :key="account.id" class="account"><text>{{ accountLabel(account.type) }}</text><text class="account-value">{{ accountBalance(account) }}</text></view></view>
        <button v-if="canRequestAdjustments && customer.accounts?.length" class="secondary adjustment-button" @tap="requestAccountAdjustment">提交账户调整申请</button>
        <text v-if="customer.privacyScope === 'FRONT_DESK_LIMITED'" class="privacy">前台视图仅展示脱敏联系方式、现场履约信息及可支付额度汇总；账户构成、赛事积分、成长积分和财务明细已隐藏。</text>
        <text v-else-if="customer.privacyScope === 'COACH_ASSIGNED'" class="privacy">教练视图仅展示本班培训信息，财务、订单、账户及联系方式已隐藏。</text>
      </view>
    </template>

    <template v-else-if="tab === 'leads'">
      <view v-if="canWriteLeads" class="card lead-form">
        <view class="section-title">新建客户线索</view>
        <input v-model="createForm.displayName" class="input field" placeholder="客户姓名（必填）" />
        <input v-model="createForm.phone" class="input field" type="number" placeholder="手机号" />
        <picker :range="sourceOptions" range-key="label" @change="changeSource"><view class="picker field">来源：{{ sourceOptions.find((item) => item.value === createForm.sourceChannel)?.label }}</view></picker>
        <input v-model="createForm.campaign" class="input field" placeholder="来源活动，例如周末体验课" />
        <button class="primary" @tap="createLead">建立线索</button>
      </view>
      <view class="section-title">线索队列 <text class="section-note">{{ loading ? '同步中' : leadsLoaded ? `${filteredLeads.length} 条` : '未同步' }}</text></view>
      <view v-for="lead in filteredLeads" :id="opsDeepLinkDomId('lead', lead.id)" :key="lead.id" class="card lead-card" :class="{ 'deep-link-target': focusedRecord === `lead:${lead.id}` }">
        <view class="lead-head"><view><text class="member-name">{{ lead.displayName }}</text><text class="muted">{{ lead.phone || '联系方式按角色隐藏' }} · {{ lead.campaign || leadSourceLabel(lead.sourceChannel) }}</text></view><text class="lead-status">{{ leadLabels[lead.status] || '状态更新中' }}</text></view>
        <text class="muted block">负责人：{{ lead.owner?.displayName || '待认领' }} · 下次跟进：{{ lead.nextFollowUpAt ? new Date(lead.nextFollowUpAt).toLocaleString() : '未安排' }}</text>
        <text v-if="lead.followUps?.[0]" class="follow-up">最近：{{ lead.followUps[0].content }}</text>
        <view v-if="canWriteLeads && !['CONVERTED', 'LOST', 'ARCHIVED'].includes(lead.status)" class="actions"><button size="mini" @tap="claim(lead)">认领</button><button size="mini" @tap="assign(lead)">分配</button><button size="mini" @tap="followUp(lead)">跟进推进</button><button size="mini" @tap="convert(lead)">转会员</button><button size="mini" @tap="lose(lead)">流失</button></view>
      </view>
      <view v-if="!loading && leadsLoaded && !filteredLeads.length" class="card empty">{{ query.trim() ? '没有匹配的客户线索' : '当前没有客户线索' }}</view>
    </template>
    <template v-else-if="tab === 'membershipProducts'">
      <view v-if="canManageMembershipProducts" class="card membership-product-form">
        <view class="form-heading">
          <view><text class="member-name">{{ membershipProductSource ? `创建 ${membershipProductSource.code} 新版本` : '新建会员产品 v1' }}</text><text class="muted block">商业条款一经创建不可覆盖；新版本默认停用，启用时校验同编码有效期。</text></view>
          <button v-if="membershipProductSource" class="secondary compact-action" :disabled="membershipProductSubmitting" @tap="resetMembershipProductForm">取消派生</button>
        </view>
        <input v-model="membershipProductForm.code" class="input field" :disabled="Boolean(membershipProductSource)" placeholder="产品编码，例如 MEMBER_GOLD_YEAR" />
        <input v-model="membershipProductForm.name" class="input field" placeholder="产品名称" />
        <picker :range="memberLevelOptions" range-key="label" @change="changeMemberLevel"><view class="picker field">会员等级：{{ memberLevelOptions.find((item) => item.value === membershipProductForm.level)?.label }} ›</view></picker>
        <view class="amount-grid"><input v-model="membershipProductForm.priceYuan" class="input field" type="digit" placeholder="售价（元）" /><input v-model="membershipProductForm.durationDays" class="input field" type="number" placeholder="有效天数" /></view>
        <input v-model="membershipProductForm.bookingBenefit" class="input field" placeholder="订场权益，例如提前14天订场" />
        <input v-model="membershipProductForm.discountBenefit" class="input field" placeholder="折扣权益，例如场地9折" />
        <input v-model="membershipProductForm.additionalBenefit" class="input field" placeholder="其他权益，例如每月同行券" />
        <view class="amount-grid"><input v-model="membershipProductForm.effectiveFrom" class="input field" placeholder="生效日 YYYY-MM-DD" /><input v-model="membershipProductForm.effectiveTo" class="input field" placeholder="失效日，可留空" /></view>
        <input v-model="membershipProductForm.reason" class="input field" placeholder="创建原因（审计留痕）" />
        <button class="primary create-plan" :loading="membershipProductSubmitting" :disabled="membershipProductSubmitting" @tap="createMembershipProductVersion">创建停用状态的新版本</button>
      </view>
      <view v-else class="card readonly-note"><text class="member-name">前台只读</text><text class="muted">可核对产品条款和上下架状态；创建版本、启停必须由管理员完成。</text></view>
      <view class="section-title">会员产品版本 <text class="section-note">{{ loading ? '同步中' : `${membershipProducts.length} 个` }}</text></view>
      <view v-if="membershipProductError" class="card product-error"><text class="member-name">会员产品加载失败</text><text class="muted block">{{ membershipProductError }}</text><button class="secondary status-button" @tap="refreshMembershipProducts()">重新加载</button></view>
      <view v-else-if="loading" class="card empty">正在同步会员产品版本…</view>
      <view v-else-if="!membershipProducts.length" class="card empty">尚未配置会员产品版本</view>
      <view v-for="product in membershipProducts" v-else :key="product.id" class="card plan-row">
        <view class="plan-head"><view><text class="member-name">{{ product.name }}</text><text class="muted">{{ product.code }} · 第{{ product.version }}版 · {{ memberLevelLabel(product.level) }} · {{ money(product.priceCents) }} / {{ product.durationDays }}天</text></view><text class="lead-status" :class="{ disabled: !product.enabled }">{{ product.enabled ? '已启用' : '已停用' }}</text></view>
        <text class="benefit-line">{{ membershipBenefits(product) }}</text>
        <text class="muted block">有效期：{{ new Date(product.effectiveFrom).toLocaleDateString() }} 至 {{ product.effectiveTo ? new Date(product.effectiveTo).toLocaleDateString() : '长期' }} · 创建人 {{ product.createdBy?.displayName || '系统记录' }}</text>
        <text v-if="product.transitions?.[0]" class="follow-up">最近变更：{{ product.transitions[0].reason }} · {{ product.transitions[0].actor?.displayName }}</text>
        <view v-if="canManageMembershipProducts" class="product-actions"><button class="secondary status-button" :disabled="membershipProductSubmitting" @tap="beginMembershipProductVersion(product)">基于此版本派生</button><button class="secondary status-button" :disabled="membershipProductSubmitting" @tap="setMembershipProductStatus(product)">{{ product.enabled ? '停用产品' : '启用产品' }}</button></view>
      </view>
    </template>
    <template v-else>
      <view class="card recharge-plan-form">
        <view class="section-title">新建充值计划版本</view>
        <text class="muted block">财务条款创建后不可修改；新版本默认停用，需单独启用。赠送金额不得超过本金。</text>
        <input v-model="rechargePlanForm.code" class="input field" placeholder="计划编码，例如 RECHARGE_500" />
        <input v-model="rechargePlanForm.name" class="input field" placeholder="计划名称" />
        <view class="amount-grid"><input v-model="rechargePlanForm.principalYuan" class="input field" type="digit" placeholder="充值本金（元）" /><input v-model="rechargePlanForm.giftYuan" class="input field" type="digit" placeholder="赠送金额（元）" /></view>
        <view class="amount-grid"><input v-model="rechargePlanForm.effectiveFrom" class="input field" placeholder="生效日 YYYY-MM-DD" /><input v-model="rechargePlanForm.effectiveTo" class="input field" placeholder="失效日 YYYY-MM-DD" /></view>
        <input v-model="rechargePlanForm.reason" class="input field" placeholder="创建原因（审计留痕）" />
        <button class="primary create-plan" @tap="createRechargePlan">创建停用状态的新版本</button>
      </view>
      <view class="section-title">充值计划版本 <text class="section-note">{{ rechargePlans.length }} 个</text></view>
      <view v-for="plan in rechargePlans" :key="plan.id" class="card plan-row">
        <view class="plan-head"><view><text class="member-name">{{ plan.name }}</text><text class="muted">{{ plan.code }} · 第{{ plan.version }}版 · 本金 {{ money(plan.principalCents) }} · 赠送 {{ money(plan.giftCents) }}</text></view><text class="lead-status" :class="{ disabled: !plan.enabled }">{{ plan.enabled ? '已启用' : '已停用' }}</text></view>
        <text class="muted block">有效期：{{ new Date(plan.effectiveFrom).toLocaleDateString() }} 至 {{ plan.effectiveTo ? new Date(plan.effectiveTo).toLocaleDateString() : '长期' }} · 创建人 {{ plan.createdBy?.displayName || '系统记录' }}</text>
        <text v-if="plan.transitions?.[0]" class="follow-up">最近变更：{{ plan.transitions[0].reason }} · {{ plan.transitions[0].actor?.displayName }}</text>
        <button class="secondary status-button" @tap="setRechargePlanStatus(plan)">{{ plan.enabled ? '停用计划' : '启用计划' }}</button>
      </view>
      <view v-if="!loading && rechargePlansLoaded && !rechargePlans.length" class="card empty">尚未配置充值计划版本</view>
    </template>
    <view class="card boundary"><text class="muted">线索跟进记录不可删除；教练仅能查看分配给自己或本班会员关联线索，且看不到账户和联系方式。</text></view>
  </OperationsFrame>
</template>

<style scoped>
.metric-grid,
.account-grid,
.amount-grid,
.product-actions {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12rpx;
}
.metric-grid { margin-top: 22rpx; gap: 14rpx; }
.tabs { display: flex; flex-wrap: wrap; gap: 12rpx; margin-top: 22rpx; padding: 10rpx; }
.tab { flex: 1 1 42%; min-height: 44px; margin: 0; color: #5f6e65; background: #f3f5f3; line-height: 1.3; }
.tab.active { color: #fff; background: #17653d; }
.search-card,
.customer-card,
.lead-form,
.host-queue { margin-top: 18rpx; padding: 20rpx; }
.section-note { color: #758079; font-size: 22rpx; font-weight: 400; }
.member-row,
.lead-card { margin-top: 14rpx; padding: 22rpx 24rpx; }
.member-row,
.lead-head,
.host-row,
.plan-head,
.form-heading,
.load-error { display: flex; justify-content: space-between; gap: 12rpx; }
.member-row { align-items: center; }
.member-row > view:first-child,
.lead-head > view:first-child,
.host-row > view:first-child,
.plan-head > view:first-child,
.form-heading > view:first-child,
.load-error > view:first-child { flex: 1; min-width: 0; }
.member-row.selected { background: #f1f8f2; border-color: #17653d; }
.deep-link-target { border-color: #d69a24 !important; box-shadow: 0 0 0 4rpx rgba(214, 154, 36, 0.18); }
.member-name { display: block; margin-bottom: 8rpx; font-size: 29rpx; font-weight: 800; overflow-wrap: anywhere; }
.select-mark,
.lead-status { flex: 0 0 auto; max-width: 34%; color: #17653d; font-size: 23rpx; text-align: right; overflow-wrap: anywhere; }
.account-grid { margin-top: 18rpx; gap: 10rpx; }
.account { min-width: 0; padding: 14rpx; background: #f4f7f4; border-radius: 12rpx; font-size: 20rpx; overflow-wrap: anywhere; }
.account-value { display: block; margin-top: 6rpx; font-size: 28rpx; font-weight: 800; overflow-wrap: anywhere; }
.privacy,
.follow-up { display: block; margin-top: 14rpx; color: #8a6030; font-size: 22rpx; line-height: 1.6; overflow-wrap: anywhere; }
.field { margin-top: 12rpx; }
.picker { box-sizing: border-box; min-height: 44px; padding: 20rpx; color: #405449; border: 1rpx solid #dce5df; border-radius: 12rpx; overflow-wrap: anywhere; }
.host-row { align-items: center; padding: 18rpx 0; border-bottom: 1rpx solid #edf1ee; }
.block { display: block; margin-top: 12rpx; overflow-wrap: anywhere; }
.actions { display: flex; flex-wrap: wrap; gap: 10rpx; margin-top: 16rpx; }
.host-row .actions { flex: 0 0 auto; margin-top: 0; }
.actions button,
.status-button,
.compact-action,
.retry-button { box-sizing: border-box; min-height: 44px; margin: 0; line-height: 1.3; white-space: normal; }
.boundary { margin-top: 22rpx; line-height: 1.7; }
.adjustment-button,
.create-plan { margin-top: 16rpx; }
.recharge-plan-form,
.membership-product-form,
.readonly-note { margin-top: 18rpx; }
.plan-row { margin-top: 14rpx; }
.plan-head,
.form-heading { align-items: flex-start; gap: 14rpx; }
.lead-status.disabled { color: #8b4b41; }
.compact-action { flex: 0 0 auto; width: auto; padding: 0 18rpx; }
.benefit-line { display: block; margin-top: 14rpx; color: #405449; font-size: 23rpx; line-height: 1.6; overflow-wrap: anywhere; }
.product-actions button { width: 100%; margin-top: 16rpx; }
.product-error,
.load-error { color: #8f2828; background: #fff5f3; }
.load-error { align-items: flex-start; margin-top: 18rpx; padding: 20rpx; }
.retry-button { flex: 0 0 auto; width: auto; padding: 0 18rpx; }
.empty { color: #758079; text-align: center; overflow-wrap: anywhere; }

@media screen and (max-width: 420px) {
  .load-error,
  .form-heading { flex-direction: column; }
  .retry-button,
  .compact-action { width: 100%; }
  .host-row { align-items: flex-start; flex-direction: column; }
  .host-row .actions { width: 100%; }
  .host-row .actions button { flex: 1 1 0; min-width: 0; }
}
</style>
