import { expect, it, vi } from 'vitest'
import { ref, computed } from 'vue'
import { useFinanceRefundsActions } from './refunds'
const { approveRefund } = vi.hoisted(() => ({ approveRefund: vi.fn() }))
vi.mock('../../../../../services/api', () => ({ endpoints: { approveRefund } }))
it.each(['SUCCEEDED', 'APPROVED', 'PROCESSING'])('reports persisted refund status %s without claiming premature completion', async status => {
  let task: any
  approveRefund.mockResolvedValue({ status })
  const actions = useFinanceRefundsActions({ task: { start: (value: unknown) => { task = value } }, load: vi.fn(), actionError: ref(''), canFinanceAction: computed(() => true), session: {} } as any)
  actions.approveRefund({ id: 'refund', amountCents: 100, order: { orderNo: 'YQ' } })
  const message = await task.submit({ reason: '独立复核' })
  expect(message).toContain(status === 'SUCCEEDED' ? '已完成' : '等待支付方同步')
})
