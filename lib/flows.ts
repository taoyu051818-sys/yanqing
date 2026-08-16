import type { FlowKey, RoleKey } from './types'

export interface FlowStepDef {
  key: string
  label: string
  role: RoleKey
  href: string
}

export interface FlowDef {
  key: FlowKey
  index: number
  title: string
  subtitle: string
  entry: string
  steps: FlowStepDef[]
  rules: string[]
}

export const ROLE_LABEL: Record<RoleKey, string> = {
  member: '会员',
  staff: '员工 / 教练',
  merchant: '球局主理人 / 联盟商户',
  admin: '老板 / 管理员',
}

export const FLOWS: FlowDef[] = [
  {
    key: 'flow1',
    index: 1,
    title: '新客体验与订场',
    subtitle: '领取体验券 → 选场支付 → 生成签到码 → 员工签到 → 后台数据同步',
    entry: '/member/booking',
    steps: [
      { key: 'claim', label: '会员领取9.9元新客体验券', role: 'member', href: '/member/coupons' },
      { key: 'select', label: '选择日期、非黄金时段与场地', role: 'member', href: '/member/booking' },
      { key: 'pay', label: '模拟支付并生成签到二维码', role: 'member', href: '/member/booking' },
      { key: 'checkin', label: '员工端核销签到码放行', role: 'staff', href: '/staff/checkin' },
      { key: 'review', label: '后台查看今日订单与场地利用率', role: 'admin', href: '/admin' },
    ],
    rules: [
      '20片场地全部可视化，体验券仅限非黄金时段',
      '每笔订单绑定业务类型、收款主体、支付渠道与来源渠道（FR-01）',
      '推荐奖励仅一层，需经过退款观察期后发放（FR-06）',
    ],
  },
  {
    key: 'flow2',
    index: 2,
    title: '瑞士积分赛事',
    subtitle: '双人组合报名 → 签到 → 5轮编排与比分录入 → 积分排名 → 历史战绩',
    entry: '/member/events',
    steps: [
      { key: 'register', label: '会员双人组合报名', role: 'member', href: '/member/events' },
      { key: 'pay', label: '模拟支付报名费', role: 'member', href: '/member/events' },
      { key: 'checkin', label: '工作人员组合签到', role: 'staff', href: '/staff/event' },
      { key: 'round', label: '编排瑞士制轮次对阵', role: 'staff', href: '/staff/event' },
      { key: 'score', label: '逐台录入每轮比分', role: 'staff', href: '/staff/event' },
      { key: 'correct', label: '管理员人工修正比分并留日志', role: 'admin', href: '/admin/events' },
      { key: 'finish', label: '结算积分、排名与历史战绩', role: 'staff', href: '/staff/event' },
    ],
    rules: [
      '5轮瑞士积分制，48人（24组）封顶，预置24人数据',
      '组合数为奇数时最低排名组轮空计1分',
      '人工修正比分必须生成操作日志（FR-09）',
      '赛事积分独立记账，不与现金余额冲抵（FR-05）',
    ],
  },
  {
    key: 'flow3',
    index: 3,
    title: '培训购买、消课与财务结算',
    subtitle: '购课预收 → 教练签到消课 → 确认收入 → 20%合同流水 → 后台同步',
    entry: '/member/training',
    steps: [
      { key: 'purchase', label: '会员购买培训课程（全额预收）', role: 'member', href: '/member/training' },
      { key: 'consume', label: '教练端签到并消课确认收入', role: 'staff', href: '/staff/training' },
      { key: 'refund', label: '未消课部分退费处理', role: 'admin', href: '/admin/training' },
      { key: 'review', label: '后台核对20%合同结算口径', role: 'admin', href: '/admin/training' },
    ],
    rules: [
      '培训独立建账，预收 / 消课 / 退费分开（FR-02）',
      '培训有效流水 × 20% = 计入球馆合同流水（FR-03）',
      '培训不再另付场地费，trainingVenueFee 恒为 0（FR-04）',
      '培训占场片数与小时数只做资源效率分析，不增加应付账款',
    ],
  },
  {
    key: 'flow4',
    index: 4,
    title: '联盟券领取、核销与对账',
    subtitle: '球馆/商户建券 → 会员领取 → 商户核销 → 重复核销拦截 → 后台对账',
    entry: '/merchant/coupons',
    steps: [
      { key: 'create', label: '球馆或联盟商户创建权益券', role: 'merchant', href: '/merchant/coupons' },
      { key: 'claim', label: '会员领取并查看来源与有效期', role: 'member', href: '/member/coupons' },
      { key: 'redeem', label: '商户扫码或输入短码核销', role: 'merchant', href: '/merchant/redeem' },
      { key: 'settle', label: '后台联盟对账与结算', role: 'admin', href: '/admin/alliance' },
    ],
    rules: [
      '每张券唯一券码，可追踪来源与核销（FR-07）',
      '重复核销必须拦截并给出明确提示',
      '外部商户各自收款，球馆储值余额不得跨商户支付（FR-08）',
      '联盟只做权益互通、券码追踪与合同对账',
    ],
  },
]

export const flowByKey = (key: FlowKey): FlowDef => FLOWS.find((f) => f.key === key)!
