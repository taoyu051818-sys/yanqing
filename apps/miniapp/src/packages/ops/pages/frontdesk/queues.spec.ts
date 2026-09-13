import { beforeEach, expect, it, vi } from 'vitest'
import * as vue from 'vue'
import { loadSfcScript } from '../../../../test-utils/sfc-script'
import { usePagedList } from '../../utils/paged-list'
import { saveAuthSession } from '../../../../services/auth-session'
const storage = new Map()
beforeEach(() => { vi.stubGlobal('uni', { getStorageSync: (key: string) => storage.get(key), setStorageSync: (key: string, value: unknown) => storage.set(key, value), removeStorageSync: (key: string) => storage.delete(key), navigateTo: vi.fn(), showToast: vi.fn() }); saveAuthSession('admin', 'admin') })
function page(file: URL, names: string[], endpoints: any) {
  return loadSfcScript(file, names, id => {
    if (id === 'vue') return vue
    if (id === '@dcloudio/uni-app') return { onLoad() {}, onShow() {} }
    if (id.endsWith('/services/api')) return { endpoints }
    if (id.endsWith('/stores/session')) return { useSessionStore: () => ({ roles: ['ADMIN'], user: { id: 'admin' } }) }
    if (id.endsWith('/utils/paged-list')) return { usePagedList }
    if (id.endsWith('/components/operation-task')) return { useOperationTask: () => ({}) }
    if (id.includes('/actions/')) return new Proxy({}, { get: () => () => ({}) })
    if (id.endsWith('/utils/format')) return { today: () => '2026-09-12' }
    return {}
  })
}
it('queries all venue pages by status and keyword, and delegates coupon redemption to the merchant choice page', async () => {
  const adminOrders = vi.fn(async ({ page }: { page: number }) => ({ items: Array.from({ length: page === 1 ? 20 : 1 }, (_, index) => ({ id: String(page * 20 + index), businessType: 'VENUE', status: 'PAID' })), total: 21 }))
  const p = page(new URL('./index.vue', import.meta.url), ['orderQueue', 'orderStatus', 'orderKeyword', 'redeemCoupon'], { adminOrders })
  p.orderStatus.value = 'PAID'; p.orderKeyword.value = '  球友  '; await p.orderQueue.load(); await p.orderQueue.more()
  expect(p.orderQueue.items.value).toHaveLength(21)
  expect(adminOrders).toHaveBeenLastCalledWith({ page: 2, pageSize: 20, status: 'PAID', businessType: 'VENUE', keyword: '球友' })
  p.redeemCoupon(); expect(uni.navigateTo).toHaveBeenCalledWith({ url: '/packages/ops/pages/merchant/index?view=redeem' })
})
it('loads older refunds from a server-filtered paginated queue instead of filtering the first all-orders page', async () => {
  const adminOrders = vi.fn(async () => ({ items: [{ id: 'old-refund-order' }], total: 21 }))
  const p = page(new URL('../finance/index.vue', import.meta.url), ['refundQueue', 'refundKeyword'], { adminOrders })
  p.refundKeyword.value = 'YQ'; await p.refundQueue.load(); await p.refundQueue.more()
  expect(adminOrders).toHaveBeenLastCalledWith({ page: 2, pageSize: 20, status: 'REFUND_PENDING', keyword: 'YQ' })
})

import { readFileSync } from 'node:fs'
it('renders the real check-in button only for an unfulfilled, still-paid booking after partial refund', () => {
  const file = new URL('./index.vue', import.meta.url)
  const p = page(file, ['canCheckInBooking', 'canOpenCheckIn', 'bookingEnded', 'checkInActionLabel', 'orders', 'paidOrders'], {})
  const template = readFileSync(file, 'utf8').match(/<button\s[^>]*@tap="checkIn\(order\)"[^>]*>[\s\S]*?<\/button>/)![0]
  const render = vue.compile(template) as unknown as (context: Record<string, unknown>, cache: unknown[]) => vue.VNode
  const base = { id: 'partial', businessType: 'VENUE', status: 'PARTIALLY_REFUNDED', paidCents: 10000, refundedCents: 2000 }
  const booking = { status: 'CONFIRMED', startsAt: new Date().toISOString(), endsAt: new Date(Date.now() + 3600000).toISOString() }
  for (const [status, refundedCents, allowed] of [['CONFIRMED', 2000, true], ['CHECKED_IN', 2000, false], ['CONFIRMED', 10000, false]] as const) {
    const order = { ...base, refundedCents, bookings: [{ ...booking, status }] }
    const vnode = render({ ...p, onsiteAllowed: true, order, checkIn: vi.fn() }, [])
    expect(vnode.type === 'button').toBe(allowed)
    p.orders.value = [order]; expect(p.paidOrders.value.length).toBe(allowed ? 1 : 0)
    expect(order.status).toBe('PARTIALLY_REFUNDED')
  }
})
