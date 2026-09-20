interface RefundOrder { id: string; refunds?: { id: string; status: string }[] }
/** Counts are applications in loaded orders, never the paginated order total. */
export function refundQueueSummary(orders: RefundOrder[], totalOrders: number, loading: boolean, error: string) {
  if (loading) return { label:'正在同步退款申请…', coverage:'', missing:'', empty:'' }
  if (error) return { label:'退款申请未同步', coverage:'', missing:'', empty:'' }
  const refunds = [...new Map(orders.flatMap(order => order.refunds || []).map(refund => [refund.id, refund])).values()]
  const pending = refunds.filter(refund => ['REQUESTED', 'REFUND_PENDING'].includes(refund.status)).length
  const processing = refunds.filter(refund => ['APPROVED', 'PROCESSING'].includes(refund.status)).length
  const failed = refunds.filter(refund => refund.status === 'FAILED').length
  const missing = orders.filter(order => !order.refunds?.length).length
  const hasMore = orders.length < totalOrders
  return {
    label:missing && !refunds.length ? '退款明细不完整，申请数量暂不可用。' : `已加载申请：待审核 ${pending} 笔 · 处理中 ${processing} 笔 · 失败 ${failed} 笔`,
    coverage:hasMore ? `已核对 ${orders.length} / ${totalOrders} 笔待退款订单，继续加载可查看其余申请。` : '',
    missing:missing ? `${missing} 笔订单未返回退款明细，请刷新核对。` : '',
    empty:missing ? '退款明细不完整，暂不能确认是否还有待处理申请。' : hasMore ? '已加载订单中暂无待处理申请，请继续加载。' : '当前没有待处理的退款申请。',
  }
}
