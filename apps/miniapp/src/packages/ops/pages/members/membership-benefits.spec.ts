import { expect, it, vi } from 'vitest'
import * as vue from 'vue'
import { loadSfcScript } from '../../../../test-utils/sfc-script'
it('shows inherited benefits in Chinese and preserves their structured values when changing price', async () => {
  vi.stubGlobal('getCurrentPages', () => [{}, {}])
  const create = vi.fn(async () => ({}))
  vi.stubGlobal('uni', { pageScrollTo:vi.fn(), showModal:vi.fn(async () => ({confirm:true})), showToast:vi.fn(), setStorageSync:vi.fn(), navigateBack:vi.fn() })
  const p = loadSfcScript(new URL('./index.vue', import.meta.url), ['beginMembershipProductVersion','membershipProductForm','extraMembershipBenefits','createMembershipProductVersion'], id => {
    if(id==='vue') return vue
    if(id==='@dcloudio/uni-app') return { onLoad(){}, onShow(){} }
    if(id.endsWith('/services/api')) return { endpoints:{createMembershipProductVersion:create} }
    if(id.endsWith('/stores/session')) return { useSessionStore:()=>({ roles:['ADMIN'], user:{id:'admin'} }) }
    if(id.endsWith('/components/operation-task')) return {useOperationTask:()=>({})}
    if(id.endsWith('/composables/use-unsaved-form')) return {useUnsavedForm:()=>({markSaved:vi.fn()})}
    if(id.endsWith('/utils/paged-list')) return {usePagedList:()=>({items:vue.ref([]),total:vue.ref(0)})}
    if(id.endsWith('/utils/pending-creation-key')) return {withPendingCreationKey:(_scope:unknown,_data:unknown,submit:any)=>submit('ux-test-key')}
    if(id.endsWith('/utils/format')) return {money:String, today: () => '2026-09-22'}
    return {}
  })
  const source={id:'product-a',code:'MEMBER_GOLD',name:'金卡会员',level:'GOLD',priceCents:69900,durationDays:365,benefits:{booking:'提前14天订场',guest:'每月同行券',training:'体验课',additional:'原有其他权益',custom:'原有附加条款'}}
  p.beginMembershipProductVersion(source)
  expect(p.extraMembershipBenefits(source)).toContain('同行权益：每月同行券')
  expect(p.extraMembershipBenefits(source)).not.toContain('guest:')
  expect(p.membershipProductForm.additionalBenefit).toBe('原有其他权益')
  p.membershipProductForm.priceYuan='799';p.membershipProductForm.reason='调整新会员价格'
  await p.createMembershipProductVersion()
  expect(create).toHaveBeenCalledWith('product-a',expect.objectContaining({priceCents:79900,benefits:expect.objectContaining(source.benefits)}))
})
