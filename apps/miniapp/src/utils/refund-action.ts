export { canExecuteDirectly as canDirectRefund } from './admin-execution'

export function directRefundFeedback(status?: string) {
  if (status === 'SUCCEEDED') return '退款已完成'
  if (status === 'APPROVED' || status === 'PROCESSING') return '退款处理中，无需再次审核'
  if (status === 'FAILED') return '退款失败，请查看退款记录'
  return '请查看退款记录确认处理结果'
}
