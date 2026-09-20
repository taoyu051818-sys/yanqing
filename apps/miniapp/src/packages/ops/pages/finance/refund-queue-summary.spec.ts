import { expect, it } from 'vitest'
import { refundQueueSummary } from './refund-queue-summary'
it('counts refund applications independently of order count and states the loaded scope', () => {
  const summary = refundQueueSummary([{ id:'order-1', refunds:[{ id:'r1', status:'REQUESTED' }, { id:'r2', status:'PROCESSING' }, { id:'r3', status:'FAILED' }, { id:'r4', status:'SUCCEEDED' }] }], 21, false, '')
  expect(summary.label).toBe('已加载申请：待审核 1 笔 · 处理中 1 笔 · 失败 1 笔')
  expect(summary.coverage).toContain('1 / 21 笔待退款订单')
})
it('does not turn missing details or an incomplete page into a global empty state', () => {
  const incomplete = refundQueueSummary([{ id:'order-1' }, { id:'order-2' }], 2, false, '')
  expect(incomplete.label).not.toContain('0')
  expect(incomplete.missing).toContain('2 笔订单未返回退款明细')
  expect(incomplete.empty).toContain('暂不能确认')
  expect(refundQueueSummary([{ id:'o', refunds:[{id:'r',status:'SUCCEEDED'}] }], 21, false, '').empty).toContain('继续加载')
  expect(refundQueueSummary([], 0, false, '').empty).toBe('当前没有待处理的退款申请。')
})
it('never displays zero applications while loading or after a failed request', () => {
  for (const summary of [refundQueueSummary([],0,true,''), refundQueueSummary([],0,false,'网络错误')]) {
    expect(summary.label).not.toContain('0')
    expect(summary.empty).toBe('')
  }
})
