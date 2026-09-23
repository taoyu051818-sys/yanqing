// ===== 共享数据模型（原型用，全部为前端模拟数据） =====

export type RoleKey = 'member' | 'staff' | 'merchant' | 'admin'

/** 业务类型：每笔订单必须绑定（FR-01） */
export type BusinessType = 'venue' | 'event' | 'training' | 'game' | 'goods'
/** 收款主体：培训独立账套（FR-02） */
export type SubjectAccount = '球馆本部' | '培训中心'
/** 支付渠道 */
export type PayChannel = '微信支付' | '现金余额' | '赠送余额' | '羽球币' | '线下现金' | '体验券抵扣'
/** 来源渠道 */
export type SourceChannel =
  | '小程序自然流量'
  | '新客体验券'
  | '万达异业联盟'
  | '老带新推荐'
  | '趣运动平台'
  | '门店到访'

export type OrderStatus = 'pending' | 'paid' | 'checked_in' | 'completed' | 'refunded' | 'cancelled'

export interface Court {
  id: string
  name: string
  zone: '东区' | '西区' | '南区' | '北区'
  usage: '散客零售' | '培训占用' | '会员包场'
}

export type SlotPeriod = '早场' | '日场' | '黄金时段'

export interface TimeSlot {
  id: string
  label: string
  period: SlotPeriod
  price: number
  newbiePrice: number
}

export interface Order {
  id: string
  businessType: BusinessType
  subject: SubjectAccount
  payChannel: PayChannel
  sourceChannel: SourceChannel
  memberId: string
  memberName: string
  title: string
  amount: number
  status: OrderStatus
  createdAt: string
  /** 场地订单专有 */
  date?: string
  courtId?: string
  slotId?: string
  qrCode?: string
  checkedInAt?: string
  couponCode?: string
  refundedAt?: string
  refundAmount?: number
  note?: string
}

export interface Member {
  id: string
  name: string
  phone: string
  level: '体验会员' | '普通会员' | '金羽会员' | '黑羽会员'
  tags: string[]
  joinedAt: string
  expiresAt: string
  /** 五类账户严格分开（FR-05） */
  cashBalance: number
  giftBalance: number
  coins: number
  eventPoints: number
  growthPoints: number
  /** 单层直接推荐（FR-06） */
  referrerId?: string
  isNewCustomer: boolean
  lastVisitAt?: string
  visits30d: number
}

export interface AccountTxn {
  id: string
  memberId: string
  account: '现金本金余额' | '赠送余额' | '羽球币' | '成人赛事积分' | '青少年成长积分'
  delta: number
  balanceAfter: number
  reason: string
  at: string
  orderId?: string
}

// ===== 赛事（瑞士积分制） =====

export interface EventPair {
  id: string
  playerA: string
  playerB: string
  memberIds: string[]
  seed: number
  points: number
  wins: number
  losses: number
  scoreDiff: number
  paid: boolean
  checkedIn: boolean
  opponents: string[]
}

export interface EventMatch {
  id: string
  round: number
  court: string
  pairAId: string
  pairBId: string
  scoreA: number | null
  scoreB: number | null
  confirmed: boolean
  corrected: boolean
}

export interface SwissEvent {
  id: string
  name: string
  date: string
  venue: string
  format: '5轮瑞士积分制'
  totalRounds: number
  capacity: number
  fee: number
  status: '报名中' | '进行中' | '已结束'
  currentRound: number
  pairs: EventPair[]
  matches: EventMatch[]
  sponsor: string
  rules: string[]
}

export interface EventHistory {
  id: string
  memberId: string
  memberName: string
  eventName: string
  date: string
  rank: number
  totalPairs: number
  wins: number
  losses: number
  pointsGained: number
}

// ===== 培训（独立账套） =====

export interface TrainingCourse {
  id: string
  name: string
  coach: string
  audience: '青少年' | '成人'
  totalSessions: number
  price: number
  unitPrice: number
  courtCountPerSession: number
  hoursPerSession: number
  coachCostPerSession: number
  materialCostPerSession: number
  schedule: string
}

export interface TrainingEnrollment {
  id: string
  courseId: string
  memberId: string
  studentName: string
  guardian: string
  guardianPhone: string
  totalSessions: number
  usedSessions: number
  unitPrice: number
  paidAmount: number
  /** 已确认收入（消课后确认） */
  confirmedRevenue: number
  /** 未消课余额（预收） */
  unusedBalance: number
  status: '在读' | '已结课' | '已退费' | '部分退费'
  refundAmount: number
  createdAt: string
}

export interface TrainingSessionLog {
  id: string
  enrollmentId: string
  courseId: string
  studentName: string
  date: string
  courtCount: number
  hours: number
  confirmedAmount: number
  coachCost: number
  materialCost: number
  operator: string
  at: string
}

// ===== 联盟券 =====

export interface Merchant {
  id: string
  name: string
  category: string
  contact: string
  isVenue: boolean
  cooperationFee: number
  attributedGmv: number
  effectiveNewCustomers: number
  settlementStatus: '待对账' | '对账中' | '已结算'
}

export interface CouponTemplate {
  id: string
  name: string
  merchantId: string
  merchantName: string
  activity: string
  benefit: string
  faceValue: number
  validFrom: string
  validTo: string
  issuedCount: number
  status: '进行中' | '已下线'
  note: string
}

export interface CouponCode {
  id: string
  templateId: string
  code: string
  status: 'issued' | 'claimed' | 'redeemed' | 'expired'
  memberId?: string
  memberName?: string
  claimedAt?: string
  redeemedAt?: string
  redeemedBy?: string
  /** 归因成交额 */
  attributedAmount?: number
}

// ===== 球局 =====

export interface GameRoom {
  id: string
  title: string
  host: string
  date: string
  slot: string
  courtNames: string[]
  level: '初级' | '中级' | '高级' | '混合'
  fee: number
  capacity: number
  joined: number
  status: '报名中' | '已满' | '已结束'
  hostReward: number
}

// ===== 财务分账流水 =====

export interface LedgerEntry {
  id: string
  at: string
  businessType: BusinessType
  subject: SubjectAccount
  payChannel: PayChannel
  sourceChannel: SourceChannel
  amount: number
  title: string
  orderId?: string
  /** 培训有效流水×20% 生成的"计入球馆流水"记录（FR-03） */
  kind: '业务收款' | '计入球馆流水' | '退款' | '培训确认收入'
}

// ===== 参数与审计 =====

export interface ParamHistory {
  value: string
  effectiveFrom: string
  changedBy: string
  changedAt: string
}

export interface SystemParam {
  key: string
  name: string
  group: '场地价格' | '培训财务' | '联盟与券' | '会员权益' | '赛事规则'
  value: string
  unit: string
  effectiveFrom: string
  locked: boolean
  lockReason?: string
  history: ParamHistory[]
}

export interface AuditLog {
  id: string
  at: string
  actor: string
  role: string
  action: string
  target: string
  before?: string
  after?: string
  note?: string
}

// ===== 推荐（仅一层） =====

export interface ReferralRecord {
  id: string
  referrerId: string
  referrerName: string
  inviteeId: string
  inviteeName: string
  orderId?: string
  rewardCoins: number
  status: '待观察期结束' | '已发放' | '已失效'
  createdAt: string
  releaseAt: string
  note: string
}

// ===== 演示流程状态 =====

export type FlowKey = 'flow1' | 'flow2' | 'flow3' | 'flow4'

export interface FlowState {
  steps: Record<string, boolean>
}

export interface DemoState {
  role: RoleKey
  currentMemberId: string
  currentMerchantId: string
  courts: Court[]
  slots: TimeSlot[]
  members: Member[]
  orders: Order[]
  txns: AccountTxn[]
  events: SwissEvent[]
  eventHistory: EventHistory[]
  courses: TrainingCourse[]
  enrollments: TrainingEnrollment[]
  sessionLogs: TrainingSessionLog[]
  merchants: Merchant[]
  couponTemplates: CouponTemplate[]
  couponCodes: CouponCode[]
  games: GameRoom[]
  ledger: LedgerEntry[]
  params: SystemParam[]
  auditLogs: AuditLog[]
  referrals: ReferralRecord[]
  flows: Record<FlowKey, FlowState>
}
