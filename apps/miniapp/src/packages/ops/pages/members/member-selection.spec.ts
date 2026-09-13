import { expect, it, vi } from 'vitest'
import * as vue from 'vue'
import { deferred, loadSfcScript } from '../../../../test-utils/sfc-script'

it('keeps the loaded customer, confirmation and adjustment target together despite out-of-order replies', async () => {
  const a = deferred(), b = deferred(); let task: any
  const create = vi.fn(async () => ({}))
  vi.stubGlobal('uni', { setStorageSync: vi.fn(), showToast: vi.fn() })
  const p = loadSfcScript(new URL('./index.vue', import.meta.url), ['selectMember', 'requestAccountAdjustment', 'selectedId', 'customer'], id => {
    if (id === 'vue') return vue
    if (id === '@dcloudio/uni-app') return { onLoad() {}, onShow() {} }
    if (id.endsWith('/services/api')) return { endpoints: { member360: (id: string) => id === 'a' ? a.promise : b.promise, createAccountAdjustment: create } }
    if (id.endsWith('/stores/session')) return { useSessionStore: () => ({ roles: ['ADMIN'], user: { id: 'admin' } }) }
    if (id.endsWith('/components/operation-task')) return { useOperationTask: () => ({ start: (value: unknown) => { task = value } }), reasonField: () => ({}) }
    if (id.endsWith('/utils/paged-list')) return { usePagedList: () => ({ items: vue.ref([]), total: vue.ref(0) }) }
    if (id.endsWith('/utils/format')) return { money: String }
    if (id.endsWith('/utils/pending-creation-key')) return { withPendingCreationKey: (_scope: unknown, _command: unknown, submit: (key: string) => unknown) => submit('adjustment-command') }
    if (id.endsWith('.vue') || id.includes('/utils/') || id.endsWith('/config/operations')) return {}
    throw new Error(id)
  })
  const memberA = { id: 'a', displayName: '会员 A' }, memberB = { id: 'b', displayName: '会员 B' }
  const shape = (member: unknown) => ({ member, accounts: [{ type: 'CASH_PRINCIPAL', balance: 10000 }] })
  const pendingA = p.selectMember(memberA), pendingB = p.selectMember(memberB)
  p.requestAccountAdjustment(); expect(task).toBeUndefined()
  b.resolve(shape(memberB)); await pendingB; a.resolve(shape(memberA)); await pendingA
  expect(p.customer.value.member.id).toBe('b'); p.requestAccountAdjustment()
  expect(task.description).toContain('会员 B')
  await task.submit({ accountType: 'CASH_PRINCIPAL', amount: '-20', reason: '凭证复核' })
  expect(create).toHaveBeenCalledWith('b', expect.objectContaining({ amount: -2000 }))
})
