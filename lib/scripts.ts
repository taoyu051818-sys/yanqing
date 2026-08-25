export type ScriptMode = 'quick' | 'full' | 'review'
export interface ScriptStep { id: string; title: string; talk: string; href: string; target?: string; role: string }
export interface DemoScript { id: ScriptMode; name: string; duration: string; desc: string; steps: ScriptStep[] }

export const DEMO_SCRIPTS: DemoScript[] = [
  {
    id: 'quick', name: '5 分钟核心版', duration: '5分钟', desc: '从会员订场到员工核销，快速展示核心价值',
    steps: [
      { id: 'q1', title: '会员经营入口', talk: '先看会员资产、快捷服务和今日推荐。', href: '/member', target: 'member-home', role: '会员' },
      { id: 'q2', title: '20 片场地订场', talk: '选择时段与场地并完成支付。', href: '/member/booking', target: 'court-grid', role: '会员' },
      { id: 'q3', title: '员工核销放行', talk: '订单生成签到码，员工核销后同步占场与流水。', href: '/staff/checkin', target: 'checkin-action', role: '员工' },
      { id: 'q4', title: '老板经营结果', talk: '最后查看收入结构、场地效率与业务贡献。', href: '/admin', target: 'admin-kpis', role: '老板' },
    ],
  },
  {
    id: 'full', name: '15 分钟完整闭环', duration: '15分钟', desc: '跑通订场、赛事、培训和联盟券四条闭环',
    steps: [
      { id: 'f1', title: '订场支付', talk: '完成场地选择和支付。', href: '/member/booking', target: 'court-grid', role: '会员' },
      { id: 'f2', title: '订场核销', talk: '员工扫码核销，生成实际到场。', href: '/staff/checkin', target: 'checkin-action', role: '员工' },
      { id: 'f3', title: '赛事报名', talk: '双人组合报名，观察成赛与候补规则。', href: '/member/events', target: 'event-register', role: '会员' },
      { id: 'f4', title: '瑞士制赛务', talk: '签到、编排、比分和排名自动联动。', href: '/staff/event', target: 'event-console', role: '员工' },
      { id: 'f5', title: '购课与教务', talk: '购课形成预收，查看合同与课表。', href: '/member/training', target: 'training-buy', role: '会员' },
      { id: 'f6', title: '消课确认收入', talk: '教练消课后按合同口径确认收入。', href: '/staff/training', target: 'consume-class', role: '教练' },
      { id: 'f7', title: '联盟券核销', talk: '商户核销唯一券码并记录归因成交。', href: '/merchant/redeem', target: 'redeem-code', role: '商户' },
      { id: 'f8', title: '联盟对账', talk: '老板确认结算与贡献。', href: '/admin/alliance', target: 'alliance-ledger', role: '老板' },
    ],
  },
  {
    id: 'review', name: '30 分钟需求评审版', duration: '30分钟', desc: '在完整闭环基础上覆盖库存、主理人、权限与数据治理',
    steps: [
      { id: 'r1', title: '经营驾驶舱', talk: '从经营结果总览开始，建立系统全局。', href: '/admin', target: 'admin-kpis', role: '老板' },
      { id: 'r2', title: '商品与库存', talk: '展示 SKU、采购、代销、领用、盘点和预警。', href: '/admin/inventory', target: 'inventory-list', role: '老板' },
      { id: 'r3', title: '主理人审核', talk: '审核申请、配置等级权限并处理异常报名。', href: '/admin/hosts', target: 'host-review', role: '老板' },
      { id: 'r4', title: '赛事细则', talk: '展示 24 人成赛、候补、让分、奖品和海报。', href: '/admin/events', target: 'event-rules', role: '老板' },
      { id: 'r5', title: '培训教务', talk: '演示课表、请假、补课、反馈和合同。', href: '/staff/academics', target: 'academic-list', role: '员工' },
      { id: 'r6', title: '退款审批', talk: '关键退款必须由有权限角色二次确认。', href: '/admin/approvals', target: 'approval-list', role: '老板' },
      { id: 'r7', title: '权限与脱敏', talk: '查看角色—操作权限与敏感字段保护。', href: '/admin/permissions', target: 'permission-matrix', role: '老板' },
      { id: 'r8', title: '导出与治理', talk: '结束于 Excel 导出、备份、迁出和匿名化。', href: '/admin/data', target: 'data-export', role: '老板' },
    ],
  },
]
