import type {
  CouponCode,
  CouponTemplate,
  Court,
  LedgerEntry,
  Member,
  Merchant,
  Order,
  SystemParam,
  TimeSlot,
  TrainingCourse,
  TrainingEnrollment,
  TrainingSessionLog,
} from './types'

/**
 * ====== 合同财务规则（不可推断、不可修改） ======
 * 1. 培训业务独立建账；
 * 2. 培训实际有效流水 × 20% = 计入球馆合同流水；
 * 3. 培训业务不再另付场地费，trainingVenueFee 恒为 0；
 * 4. 培训占用场地的片数/小时只用于资源效率分析，不增加培训应付账款。
 */
export const TRAINING_VENUE_FEE = 0 as const
export const DEFAULT_TRAINING_CONTRACT_RATE = 0.2 as const

export const getParamNumber = (params: SystemParam[], key: string, fallback: number): number => {
  const p = params.find((x) => x.key === key)
  const n = p ? Number(p.value) : Number.NaN
  return Number.isFinite(n) ? n : fallback
}

/** 培训计入球馆合同流水的比例（后台可配置，当前 20%） */
export const trainingContractRate = (params: SystemParam[]): number =>
  getParamNumber(params, 'training.contract_rate', DEFAULT_TRAINING_CONTRACT_RATE * 100) / 100

/** 培训有效流水 × 比例 = 计入球馆合同流水 */
export const trainingContractContribution = (effectiveRevenue: number, rate: number): number =>
  round2(effectiveRevenue * rate)

/** 培训场地费恒为 0（占场只做资源效率分析） */
export const trainingVenueFee = (): number => TRAINING_VENUE_FEE

export const round2 = (n: number): number => Math.round(n * 100) / 100
export const yuan = (n: number): string =>
  `¥${n.toLocaleString('zh-CN', { minimumFractionDigits: n % 1 === 0 ? 0 : 2, maximumFractionDigits: 2 })}`

export interface TrainingSummary {
  /** 已确认收入（消课确认部分） */
  confirmedRevenue: number
  /** 未消课余额（预收负债） */
  unusedBalance: number
  /** 已退费 */
  refundAmount: number
  /** 实际有效流水 = 已确认收入 */
  effectiveRevenue: number
  /** 计入球馆合同流水 */
  contractContribution: number
  /** 培训场地费（恒为 0） */
  trainingVenueFee: number
  /** 教练成本 */
  coachCost: number
  /** 耗材成本 */
  materialCost: number
  /** 培训毛利 = 已确认收入 - 教练成本 - 耗材成本 */
  grossProfit: number
  /** 占用场地片数合计（仅资源效率分析） */
  occupiedCourtCount: number
  /** 占用场地小时合计（仅资源效率分析） */
  occupiedHours: number
  /** 培训应付账款（不因占场增加） */
  trainingPayableFromVenue: number
  rate: number
}

export const computeTrainingSummary = (
  enrollments: TrainingEnrollment[],
  logs: TrainingSessionLog[],
  params: SystemParam[],
): TrainingSummary => {
  const rate = trainingContractRate(params)
  const confirmedRevenue = round2(enrollments.reduce((s, e) => s + e.confirmedRevenue, 0))
  const unusedBalance = round2(enrollments.reduce((s, e) => s + e.unusedBalance, 0))
  const refundAmount = round2(enrollments.reduce((s, e) => s + e.refundAmount, 0))
  const coachCost = round2(logs.reduce((s, l) => s + l.coachCost, 0))
  const materialCost = round2(logs.reduce((s, l) => s + l.materialCost, 0))
  const occupiedCourtCount = logs.reduce((s, l) => s + l.courtCount, 0)
  const occupiedHours = round2(logs.reduce((s, l) => s + l.hours * l.courtCount, 0))
  return {
    confirmedRevenue,
    unusedBalance,
    refundAmount,
    effectiveRevenue: confirmedRevenue,
    contractContribution: trainingContractContribution(confirmedRevenue, rate),
    trainingVenueFee: trainingVenueFee(),
    coachCost,
    materialCost,
    grossProfit: round2(confirmedRevenue - coachCost - materialCost),
    occupiedCourtCount,
    occupiedHours,
    trainingPayableFromVenue: 0,
    rate,
  }
}

/** 合同示例口径：培训有效流水 100000 → 计入球馆流水 20000，场地费 0 */
export const contractExample = (params: SystemParam[]) => {
  const rate = trainingContractRate(params)
  return {
    effectiveRevenue: 100000,
    contractContribution: trainingContractContribution(100000, rate),
    venueFee: TRAINING_VENUE_FEE,
    rate,
  }
}

// ===== 场地经营 =====

export interface VenueSummary {
  todayOrders: number
  todayRevenue: number
  paidCount: number
  checkedInCount: number
  refundedCount: number
  newCustomerCount: number
  soldSlots: number
  totalSlots: number
  utilization: number
  trainingOccupiedSlots: number
}

export const TRAINING_BLOCKED = { courtIds: ['C15', 'C16', 'C17', 'C18'], slotIds: ['S6'] }

export const isTrainingOccupied = (courtId: string, slotId: string): boolean =>
  TRAINING_BLOCKED.courtIds.includes(courtId) && TRAINING_BLOCKED.slotIds.includes(slotId)

export const computeVenueSummary = (
  orders: Order[],
  courts: Court[],
  slots: TimeSlot[],
  members: Member[],
  today: string,
): VenueSummary => {
  const todays = orders.filter((o) => o.businessType === 'venue' && o.date === today)
  const active = todays.filter((o) => o.status !== 'refunded' && o.status !== 'cancelled')
  const totalSlots = courts.length * slots.length
  const trainingOccupiedSlots = TRAINING_BLOCKED.courtIds.length * TRAINING_BLOCKED.slotIds.length
  const soldSlots = active.length
  const newCustomerIds = new Set(
    active.filter((o) => members.find((m) => m.id === o.memberId)?.isNewCustomer).map((o) => o.memberId),
  )
  return {
    todayOrders: todays.length,
    todayRevenue: round2(active.reduce((s, o) => s + o.amount, 0)),
    paidCount: todays.filter((o) => o.status === 'paid').length,
    checkedInCount: todays.filter((o) => o.status === 'checked_in' || o.status === 'completed').length,
    refundedCount: todays.filter((o) => o.status === 'refunded').length,
    newCustomerCount: newCustomerIds.size,
    soldSlots,
    totalSlots,
    utilization: Math.round(((soldSlots + trainingOccupiedSlots) / totalSlots) * 1000) / 10,
    trainingOccupiedSlots,
  }
}

// ===== 联盟对账 =====

export interface AllianceRow {
  merchant: Merchant
  templates: CouponTemplate[]
  issued: number
  claimed: number
  redeemed: number
  redeemRate: number
  attributedGmv: number
  effectiveNewCustomers: number
  cooperationFee: number
  roi: number
  settlementStatus: Merchant['settlementStatus']
}

export const computeAllianceRows = (
  merchants: Merchant[],
  templates: CouponTemplate[],
  codes: CouponCode[],
): AllianceRow[] =>
  merchants.map((merchant) => {
    const mts = templates.filter((t) => t.merchantId === merchant.id)
    const ids = mts.map((t) => t.id)
    const mCodes = codes.filter((c) => ids.includes(c.templateId))
    const issued = mts.reduce((s, t) => s + t.issuedCount, 0)
    const claimed = mCodes.filter((c) => c.status === 'claimed' || c.status === 'redeemed').length
    const redeemedCodes = mCodes.filter((c) => c.status === 'redeemed')
    const redeemed = redeemedCodes.length
    const attributedGmv = round2(
      merchant.attributedGmv + redeemedCodes.reduce((s, c) => s + (c.attributedAmount ?? 0), 0),
    )
    const effectiveNewCustomers = merchant.effectiveNewCustomers + redeemed
    return {
      merchant,
      templates: mts,
      issued,
      claimed,
      redeemed,
      redeemRate: claimed === 0 ? 0 : Math.round((redeemed / claimed) * 1000) / 10,
      attributedGmv,
      effectiveNewCustomers,
      cooperationFee: merchant.cooperationFee,
      roi: merchant.cooperationFee === 0 ? 0 : Math.round((attributedGmv / merchant.cooperationFee) * 100) / 100,
      settlementStatus: merchant.settlementStatus,
    }
  })

// ===== 会员经营 =====

export interface MemberSummary {
  total: number
  newThisMonth: number
  repurchase7d: number
  repurchase30d: number
  newCustomers: number
  expiringSoon: number
}

export const computeMemberSummary = (members: Member[]): MemberSummary => ({
  total: members.length,
  newThisMonth: members.filter((m) => m.joinedAt.startsWith('2026-08')).length,
  repurchase7d: Math.round(
    (members.filter((m) => m.visits30d >= 2 && (m.lastVisitAt ?? '') >= '2026-08-10').length / members.length) * 1000,
  ) / 10,
  repurchase30d:
    Math.round((members.filter((m) => m.visits30d >= 4).length / members.length) * 1000) / 10,
  newCustomers: members.filter((m) => m.isNewCustomer).length,
  expiringSoon: members.filter((m) => m.expiresAt < '2026-12-31').length,
})

/** 现金贡献毛利：场地 + 商品 + 球局 + 赛事（培训按合同 20% 计入） */
export const computeCashContribution = (ledger: LedgerEntry[]) => {
  const venueLike = ledger
    .filter((l) => l.kind === '业务收款' && l.subject === '球馆本部')
    .reduce((s, l) => s + l.amount, 0)
  const refunds = ledger.filter((l) => l.kind === '退款').reduce((s, l) => s + l.amount, 0)
  const trainingContribution = ledger
    .filter((l) => l.kind === '计入球馆流水')
    .reduce((s, l) => s + l.amount, 0)
  return {
    venueLike: round2(venueLike),
    refunds: round2(refunds),
    trainingContribution: round2(trainingContribution),
    total: round2(venueLike + refunds + trainingContribution),
  }
}

export const courseOf = (courses: TrainingCourse[], courseId: string) =>
  courses.find((c) => c.id === courseId)
