import { beforeEach, expect, it, vi } from 'vitest'
import { computed, ref } from 'vue'
import { useFinanceAllianceActions } from './alliance'
const { revise } = vi.hoisted(() => ({ revise: vi.fn() }))
vi.mock('../../../../../services/api', () => ({ endpoints: { reviseAllianceSettlement: revise } }))
const storage = new Map()
beforeEach(() => { storage.clear(); vi.clearAllMocks(); vi.stubGlobal('uni', { getStorageSync: (key: string) => storage.get(key), setStorageSync: (key: string, value: unknown) => storage.set(key, value), removeStorageSync: (key: string) => storage.delete(key) }) })
it('revises only a finance draft, using the same command key after a lost response', async () => {
  let task: any; const load = vi.fn()
  const actions = useFinanceAllianceActions({ businessPeriod: () => ({}), task: { start: (value: unknown) => { task = value } }, load, runAction: vi.fn(), merchants: ref([]), canFinanceAction: computed(() => true), canMerchantAction: computed(() => false) } as any)
  actions.reviseSettlement({ id: 'settlement', status: 'CONFIRMED' }); expect(task).toBeUndefined()
  actions.reviseSettlement({ id: 'settlement', status: 'DRAFT', attributedGrossProfitCents: 1500 })
  revise.mockRejectedValueOnce(new Error('回包丢失')).mockResolvedValueOnce({ status: 'DRAFT' })
  await expect(task.submit({ profit: '20.50', reason: '凭证更正' })).rejects.toThrow('回包丢失')
  await task.submit({ profit: '20.50', reason: '凭证更正' })
  expect(revise.mock.calls[0]).toEqual(revise.mock.calls[1]); expect(revise.mock.calls[1][1]).toMatchObject({ attributedGrossProfitCents: 2050, reason: '凭证更正' }); expect(load).toHaveBeenCalledOnce()
})
