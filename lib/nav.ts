import type { RoleKey } from './types'

export interface NavItem {
  href: string
  label: string
  desc: string
}

export interface RoleNav {
  role: RoleKey
  label: string
  short: string
  home: string
  accent: string
  items: NavItem[]
}

export const ROLE_NAV: RoleNav[] = [
  {
    role: 'member',
    label: '会员端小程序',
    short: '会员',
    home: '/member',
    accent: 'brand',
    items: [
      { href: '/member', label: '首页', desc: '会员卡、余额与今日推荐' },
      { href: '/member/booking', label: '预约订场', desc: '20片场地可视化选场支付' },
      { href: '/member/orders', label: '我的订单', desc: '签到码、退款与消费记录' },
      { href: '/member/events', label: '赛事报名', desc: '瑞士积分赛双人组合报名' },
      { href: '/member/training', label: '培训课程', desc: '课包购买与消课进度' },
      { href: '/member/games', label: '球局广场', desc: '主理人球局与拼场' },
      { href: '/member/coupons', label: '我的券包', desc: '体验券与联盟权益券' },
      { href: '/member/wallet', label: '账户中心', desc: '五类账户流水与推荐奖励' },
    ],
  },
  {
    role: 'staff',
    label: '员工 / 教练端',
    short: '员工',
    home: '/staff',
    accent: 'primary',
    items: [
      { href: '/staff', label: '值班工作台', desc: '今日任务与场地占用' },
      { href: '/staff/checkin', label: '订场核销', desc: '扫码签到放行' },
      { href: '/staff/event', label: '赛事控制台', desc: '签到、编排轮次与录分' },
      { href: '/staff/training', label: '教练消课', desc: '课时签到与确认收入' },
      { href: '/staff/courts', label: '场地看板', desc: '20片场地实时状态' },
    ],
  },
  {
    role: 'merchant',
    label: '主理人 / 商户端',
    short: '商户',
    home: '/merchant',
    accent: 'gold',
    items: [
      { href: '/merchant', label: '商户概览', desc: '归因成交与结算状态' },
      { href: '/merchant/coupons', label: '权益券管理', desc: '创建券模板与发行量' },
      { href: '/merchant/redeem', label: '券码核销', desc: '短码核销与重复拦截' },
      { href: '/merchant/games', label: '我的球局', desc: '球局开局与收益' },
    ],
  },
  {
    role: 'admin',
    label: '老板 / 管理后台',
    short: '后台',
    home: '/admin',
    accent: 'primary',
    items: [
      { href: '/admin', label: '经营驾驶舱', desc: '现金贡献、场地效率与漏斗' },
      { href: '/admin/orders', label: '订单与流水', desc: '四要素全量流水台账' },
      { href: '/admin/venue', label: '场地经营', desc: '时段结构与利用率' },
      { href: '/admin/events', label: '赛事管理', desc: '比分修正与积分排行' },
      { href: '/admin/training', label: '培训核算', desc: '20%合同口径与退费' },
      { href: '/admin/alliance', label: '联盟对账', desc: '券码追踪与商户结算' },
      { href: '/admin/members', label: '会员与账户', desc: '五类账户与人工调整' },
      { href: '/admin/params', label: '参数中心', desc: '价格与规则参数版本' },
      { href: '/admin/audit', label: '审计日志', desc: '敏感操作留痕' },
    ],
  },
]

export const navByRole = (role: RoleKey): RoleNav => ROLE_NAV.find((r) => r.role === role)!

export const roleFromPath = (path: string): RoleKey => {
  if (path.startsWith('/staff')) return 'staff'
  if (path.startsWith('/merchant')) return 'merchant'
  if (path.startsWith('/admin')) return 'admin'
  return 'member'
}
