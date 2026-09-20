export type StatusDomain = 'general' | 'work' | 'risk' | 'training' | 'refund'

const labels: Record<string, string> = {
  PENDING_PAYMENT: '待支付', PAID: '已支付', CONFIRMED: '已确认', CHECKED_IN: '已签到',
  COMPLETED: '已完成', CANCELLED: '已取消', REFUNDING: '退款中', REFUNDED: '已退款',
  OPEN: '报名中', REGISTRATION: '报名中', RUNNING: '进行中', ISSUED: '待领取',
  CLAIMED: '已领取', REDEEMED: '已核销', ACTIVE: '有效', PENDING: '待处理',
  REFUND_PENDING: '退款待审核', REQUESTED: '待审核', SUCCEEDED: '已完成',
  FULL: '已满员', IN_PROGRESS: '进行中', PARTIALLY_REFUNDED: '部分退款',
  WAITLISTED: '候补中', REGISTERED: '已报名', REJECTED: '未通过',
  FAILED: '处理失败', EXPIRED: '已过期', DISABLED: '已停用', DRAFT: '草稿',
  LOCKED: '已锁定', REVIEWING: '复核中', RESOLVED: '已解决', DISMISSED: '已排除',
  SUCCESS: '成功', VOID: '已作废', POSTED: '已过账', SETTLED: '已结算',
  SCHEDULED: '未开始', CONTACTING: '跟进中', APPLIED: '待审核', APPROVED: '已批准',
  PROCESSING: '处理中', PUBLISHED: '已发布', PENDING_CONFIRMATION: '待复核',
  CLOSED: '已关闭', ATTENDED: '已到场', ABSENT: '缺席', LEAVE: '请假',
  CONVERTED: '已转化', ASSESSED: '已评估', NEW: '待跟进', LOST: '已结束',
}
const contextual: Partial<Record<StatusDomain, Record<string, string>>> = {
  work: { OPEN: '待处理', CONTACTING: '跟进中' },
  risk: { OPEN: '待处理', HIGH: '高风险', MEDIUM: '中风险', LOW: '低风险' },
  refund: { APPROVED: '已批准', PROCESSING: '退款处理中', SUCCEEDED: '退款成功', FAILED: '退款失败', REJECTED: '已驳回' },
}

export function statusLabel(value?: string, domain: StatusDomain = 'general') {
  if (!value) return '—'
  return contextual[domain]?.[value] || labels[value] || '状态待确认'
}

/** Some existing work-item APIs prefix descriptions with an account state. */
export function workItemDescription(description?: string) {
  return (description || '').replace(/^([A-Z_]+)(?=\s*·)/, value => contextual.work?.[value] || labels[value] || value)
}
