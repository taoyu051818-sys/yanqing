import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick, reactive, type EffectScope } from 'vue'
import type { AppRole } from '../../types/domain'
import { endpoints } from '../../services/api'
import { useWorkspaceData } from './use-workspace-data'

const state = vi.hoisted(() => ({
  session: {} as { user: { id: string }; roles: AppRole[]; isOperator: boolean },
  dispose: () => {},
}))
vi.mock('vue', async () => ({
  ...(await vi.importActual<object>('vue')),
  onUnmounted: (callback: () => void) => { state.dispose = callback },
}))
vi.mock('../../stores/session', () => ({ useSessionStore: () => state.session }))
vi.mock('../../services/api', () => ({ endpoints: { dashboard: vi.fn(), workItems: vi.fn() } }))
let scope: EffectScope
const mount = () => {
  scope = effectScope()
  return scope.run(useWorkspaceData)!
}
beforeEach(() => {
  vi.resetAllMocks()
  state.session = reactive({ user: { id: 'admin-a' }, roles: ['SUPER_ADMIN'] as AppRole[], isOperator: true })
})
afterEach(() => { state.dispose(); scope?.stop() })

describe('经营首页的数据边界', () => {
  it('展示实际收款和预约小时比例，零值不误作缺失', async () => {
    vi.mocked(endpoints.dashboard).mockResolvedValue({
      collections: { grossPaymentCents: 0 },
      venue: { utilizationRate: 0, bookingCount: 0 },
      revenue: { realizedRevenueCents: 9900 },
      totalOrderCents: 60000,
    })
    const data = mount()
    expect(data.metrics.value[0].value).toBe('—')
    await data.loadData()
    expect(data.metrics.value[0]).toMatchObject({ value: '¥0.00', note: '含充值与培训预收' })
    expect(data.metrics.value[1]).toMatchObject({ label: '场地预约率', value: '0%' })
    expect(data.metrics.value[2].value).toBe('0')
  })

  it('从近七天返回今天，迟到的七天响应不能覆盖今天', async () => {
    let finishWeek!: (result: Record<string, unknown>) => void
    vi.mocked(endpoints.dashboard).mockReturnValueOnce(new Promise(resolve => { finishWeek = resolve }))
    vi.mocked(endpoints.dashboard).mockResolvedValueOnce({ collections: { grossPaymentCents: 2000 } })
    const data = mount()
    data.days.value = 7
    const week = data.loadData()
    data.days.value = 1
    await data.loadData()
    finishWeek({ collections: { grossPaymentCents: 90000 } })
    await week
    expect(data.metrics.value[0].value).toBe('¥20.00')
    const [weekQuery, dayQuery] = vi.mocked(endpoints.dashboard).mock.calls.map(([query]) => query!)
    expect(new Date(dayQuery.periodStart).getTime() - new Date(weekQuery.periodStart).getTime()).toBe(6 * 86400000)
  })

  it('摘要失败和待办失败独立展示，重试后恢复且不将失败当零收入', async () => {
    vi.mocked(endpoints.dashboard).mockRejectedValueOnce(new Error('offline'))
    vi.mocked(endpoints.workItems).mockResolvedValue([{ id:'work-1', title:'到场点名' }])
    const data = mount()
    await Promise.all([data.loadData(), data.loadWork()])
    expect(data.dataError.value).toBeTruthy()
    expect(data.metrics.value[0].value).toBe('—')
    expect(data.workItems.value[0].id).toBe('work-1')
    expect(data.loadError.value).toBe('')
    vi.mocked(endpoints.dashboard).mockResolvedValue({ collections: { grossPaymentCents: 2300 } })
    await data.loadData()
    expect(data.dataError.value).toBe('')
    expect(data.metrics.value[0].value).toBe('¥23.00')
  })

  it('切换到前台后清除经营金额，并丢弃旧账号迟到响应', async () => {
    let finish!: (result: Record<string, unknown>) => void
    vi.mocked(endpoints.dashboard).mockReturnValueOnce(new Promise(resolve => { finish = resolve }))
    const data = mount()
    const pending = data.loadData()
    state.session.user.id = 'frontdesk-b'
    state.session.roles = ['FRONT_DESK']
    await nextTick()
    finish({ collections: { grossPaymentCents: 80000 } })
    await pending
    await data.loadData()
    expect(data.dashboard.value).toBeNull()
    expect(data.metrics.value[0].value).toBe('—')
    expect(endpoints.dashboard).toHaveBeenCalledTimes(1)
    expect(data.dataLoading.value).toBe(false)
  })
})
