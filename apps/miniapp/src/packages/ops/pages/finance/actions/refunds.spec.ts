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

it.each(['ADMIN','SUPER_ADMIN'])('%s confirms an existing refund without entering another review reason', async role => {
  let definition: any;
  approveRefund.mockClear(); approveRefund.mockResolvedValue({status:'PROCESSING'});
  const actions=useFinanceRefundsActions({task:{start:(value:unknown)=>{definition=value}},load:vi.fn(),actionError:ref(''),canFinanceAction:computed(()=>true),session:{roles:['MEMBER',role]}} as any);
  actions.approveRefund({id:'refund-existing',amountCents:5000,reason:'会员取消预约',order:{orderNo:'YQ'}});
  expect(definition.fields).toEqual([]); expect(definition.successFeedback).toBe('toast');
  expect(await definition.submit({})).toContain('无需再次审核');
  expect(approveRefund).toHaveBeenCalledTimes(1);
  expect(approveRefund).toHaveBeenCalledWith('refund-existing',{reason:'管理员确认退款：会员取消预约'});
});
