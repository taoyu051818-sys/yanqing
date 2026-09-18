import { expect, it, vi } from 'vitest'
import * as vue from 'vue'
import { loadSfcScript } from '../../../../test-utils/sfc-script'

function page() {
  let onLoad: (options: any) => void = () => {}, onShow: () => Promise<void> = async () => {}
  const member360 = vi.fn(async (id: string) => ({ member: { id, displayName: '会员' }, accounts: [] }))
  const listLoad = vi.fn(async () => {})
  const session = { roles: ['ADMIN'], user: { id: 'operator' }, hydrate: vi.fn(async () => {}) }
  vi.stubGlobal('uni', { navigateTo: vi.fn(), setNavigationBarTitle: vi.fn(), setStorageSync: vi.fn(), showToast: vi.fn() })
  const state = loadSfcScript(new URL('./index.vue', import.meta.url), ['openMember', 'customer', 'membersLoaded', 'members', 'query'], id => {
    if (id === 'vue') return vue
    if (id === '@dcloudio/uni-app') return { onLoad: (fn: typeof onLoad) => { onLoad = fn }, onShow: (fn: typeof onShow) => { onShow = fn } }
    if (id.endsWith('/services/api')) return { endpoints: { member360, customerLeads: async () => ({ items: [] }), hostApplications: async () => [], manageRechargePlans: async () => [], manageMembershipProducts: async () => [] } }
    if (id.endsWith('/stores/session')) return { useSessionStore: () => session }
    if (id.endsWith('/components/operation-task')) return { useOperationTask: () => ({}), reasonField: () => ({}) }
    if (id.endsWith('/utils/paged-list')) return { usePagedList: () => ({ items: vue.ref([]), total: vue.ref(0), load: listLoad }) }
    if (id.endsWith('/config/operations')) return { hasOperationsAccess: () => true }
    if (id.endsWith('/utils/work-item-deep-link')) return { parseOpsDeepLinkQuery: () => ({}) }
    if (id.endsWith('/utils/format')) return { money: String }
    if (id.endsWith('.vue') || id.includes('/utils/')) return {}
    throw new Error(id)
  })
  return { openMember: state.openMember, customer: state.customer, query: state.query, members: state.members, member360, listLoad, session, start: (params: any) => { onLoad(params); return onShow() }, show: () => onShow() }
}
it('opens a separate detail route and loads only the requested member', async () => {
  const p = page()
  p.openMember({ id: 'member/a' })
  expect(uni.navigateTo).toHaveBeenCalledWith({ url: '/packages/ops/pages/members/index?memberId=member%2Fa' })
  await p.start({ memberId: 'member/a' })
  expect(p.member360).toHaveBeenCalledWith('member/a')
  expect(p.customer.value.member.id).toBe('member/a')
  expect(p.listLoad).not.toHaveBeenCalled()
})
it('retains loaded list and search on return, but reloads after identity changes', async () => {
  const p = page()
  await p.start({})
  p.query.value = '小王'
  p.members.value = [{ id: 'last-page-member' }]
  await p.show()
  expect(p.listLoad).toHaveBeenCalledTimes(1)
  expect(p.query.value).toBe('小王')
  expect(p.members.value[0].id).toBe('last-page-member')
  p.session.user.id = 'another-operator'
  await p.show()
  expect(p.listLoad).toHaveBeenCalledTimes(2)
})
