import type { LucideIcon } from 'lucide-react'
import {
  BadgePercent,
  CalendarCheck,
  ClipboardCheck,
  Coins,
  GaugeCircle,
  GraduationCap,
  Grid3x3,
  Home,
  LayoutGrid,
  ListOrdered,
  MapPinned,
  PackageSearch,
  QrCode,
  Receipt,
  Database,
  UserCog,
  ClipboardList,
  Store,
  ScrollText,
  Settings2,
  ShieldCheck,
  Ticket,
  Trophy,
  Users,
  Wallet,
} from 'lucide-react'
import type { RoleKey } from './types'

export interface NavItem {
  href: string
  label: string
  desc: string
  icon: LucideIcon
  /** 是否进入底部标签栏 */
  tab?: boolean
  /** 底部标签栏上的短标题 */
  tabLabel?: string
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
      { href: '/member', label: '首页', desc: '会员卡、余额与今日推荐', icon: Home, tab: true, tabLabel: '首页' },
      {
        href: '/member/booking',
        label: '预约订场',
        desc: '20片场地可视化选场支付',
        icon: Grid3x3,
        tab: true,
        tabLabel: '订场',
      },
      {
        href: '/member/events',
        label: '赛事报名',
        desc: '瑞士积分赛双人组合报名',
        icon: Trophy,
        tab: true,
        tabLabel: '赛事',
      },
      {
        href: '/member/wallet',
        label: '账户中心',
        desc: '五类账户流水与推荐奖励',
        icon: Wallet,
        tab: true,
        tabLabel: '账户',
      },
      { href: '/member/orders', label: '我的订单', desc: '签到码、退款与消费记录', icon: Receipt },
      { href: '/member/training', label: '培训课程', desc: '课包购买与消课进度', icon: GraduationCap },
      { href: '/member/games', label: '球局广场', desc: '主理人球局与拼场', icon: Users },
      { href: '/member/shop', label: '场馆商城', desc: '商品分类、库存与购买', icon: Store },
      { href: '/member/coupons', label: '我的券包', desc: '体验券与联盟权益券', icon: Ticket },
    ],
  },
  {
    role: 'staff',
    label: '员工 / 教练端',
    short: '员工',
    home: '/staff',
    accent: 'primary',
    items: [
      {
        href: '/staff',
        label: '值班工作台',
        desc: '今日任务与场地占用',
        icon: LayoutGrid,
        tab: true,
        tabLabel: '工作台',
      },
      { href: '/staff/checkin', label: '订场核销', desc: '扫码签到放行', icon: QrCode, tab: true, tabLabel: '核销' },
      {
        href: '/staff/event',
        label: '赛事控制台',
        desc: '签到、编排轮次与录分',
        icon: Trophy,
        tab: true,
        tabLabel: '赛务',
      },
      {
        href: '/staff/courts',
        label: '场地看板',
        desc: '20片场地实时状态',
        icon: MapPinned,
        tab: true,
        tabLabel: '看板',
      },
      { href: '/staff/training', label: '教练消课', desc: '课时签到与确认收入', icon: GraduationCap },
      { href: '/staff/academics', label: '培训教务', desc: '课表、请假、补课与反馈', icon: ClipboardList },
      { href: '/staff/inventory', label: '商品作业', desc: '销售、领用与库存预警', icon: PackageSearch },
    ],
  },
  {
    role: 'merchant',
    label: '主理人 / 商户端',
    short: '商户',
    home: '/merchant',
    accent: 'gold',
    items: [
      {
        href: '/merchant',
        label: '商户概览',
        desc: '归因成交与结算状态',
        icon: GaugeCircle,
        tab: true,
        tabLabel: '概览',
      },
      {
        href: '/merchant/redeem',
        label: '券码核销',
        desc: '短码核销与重复拦截',
        icon: QrCode,
        tab: true,
        tabLabel: '核销',
      },
      {
        href: '/merchant/coupons',
        label: '权益券管理',
        desc: '创建券模板与发行量',
        icon: BadgePercent,
        tab: true,
        tabLabel: '券管理',
      },
      { href: '/merchant/games', label: '我的球局', desc: '球局开局与收益', icon: Users, tab: true, tabLabel: '球局' },
      { href: '/merchant/hosts', label: '主理人中心', desc: '申请、等级、权限与异常', icon: UserCog },
    ],
  },
  {
    role: 'admin',
    label: '老板 / 管理后台',
    short: '后台',
    home: '/admin',
    accent: 'primary',
    items: [
      {
        href: '/admin',
        label: '经营驾驶舱',
        desc: '现金贡献、场地效率与漏斗',
        icon: GaugeCircle,
        tab: true,
        tabLabel: '驾驶舱',
      },
      {
        href: '/admin/orders',
        label: '订单与流水',
        desc: '四要素全量流水台账',
        icon: ListOrdered,
        tab: true,
        tabLabel: '流水',
      },
      {
        href: '/admin/alliance',
        label: '联盟对账',
        desc: '券码追踪与商户结算',
        icon: Coins,
        tab: true,
        tabLabel: '对账',
      },
      {
        href: '/admin/members',
        label: '会员与账户',
        desc: '五类账户与人工调整',
        icon: Users,
        tab: true,
        tabLabel: '会员',
      },
      { href: '/admin/venue', label: '场地经营', desc: '时段结构与利用率', icon: MapPinned },
      { href: '/admin/events', label: '赛事管理', desc: '比分修正与积分排行', icon: Trophy },
      { href: '/admin/training', label: '培训核算', desc: '20%合同口径与退费', icon: GraduationCap },
      { href: '/admin/inventory', label: '商品库存', desc: 'SKU、采购、代销与盘点', icon: PackageSearch },
      { href: '/admin/hosts', label: '主理人管理', desc: '申请审核、等级与异常', icon: UserCog },
      { href: '/admin/approvals', label: '审批中心', desc: '退款与敏感操作审批', icon: ClipboardList },
      { href: '/admin/permissions', label: '权限与脱敏', desc: '操作权限矩阵与数据保护', icon: ShieldCheck },
      { href: '/admin/data', label: '数据与治理', desc: '导出、备份、迁出与注销', icon: Database },
      { href: '/admin/params', label: '参数中心', desc: '价格与规则参数版本', icon: Settings2 },
      { href: '/admin/audit', label: '审计日志', desc: '敏感操作留痕', icon: ScrollText },
    ],
  },
]

export const navByRole = (role: RoleKey): RoleNav => ROLE_NAV.find((r) => r.role === role)!

export const tabsByRole = (role: RoleKey): NavItem[] => navByRole(role).items.filter((i) => i.tab)

export const roleFromPath = (path: string): RoleKey => {
  if (path.startsWith('/staff')) return 'staff'
  if (path.startsWith('/merchant')) return 'merchant'
  if (path.startsWith('/admin')) return 'admin'
  return 'member'
}

/** 角色图标，用于角色切换器 */
export const ROLE_ICON: Record<RoleKey, LucideIcon> = {
  member: CalendarCheck,
  staff: ClipboardCheck,
  merchant: BadgePercent,
  admin: ShieldCheck,
}
