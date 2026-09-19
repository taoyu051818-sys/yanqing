import { effectScope, nextTick, reactive } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { VenueCourt } from '../../../../types/venue-settings'
const api = vi.hoisted(() => ({ deleteVenueCourt: vi.fn(), venueSettings: vi.fn(), updateVenueCourt: vi.fn(), createVenueCourt: vi.fn(), saveVenueSettings: vi.fn() }))
vi.mock('../../../../services/api', () => ({ endpoints: api }))
let session: { roles: string[]; user: { id: string } }, token = 'admin'
vi.mock('../../../../stores/session', () => ({ useSessionStore: () => session }))
import { useVenueSettings } from './use-settings'
const original: VenueCourt = { id: 'court', name: '场地', code: 'C1', zone: 'EAST', usage: 'RETAIL', enabled: true, sortOrder: 1, updatedAt: '2026-09-19T00:00:00.000Z' }
const profile = () => ({ name: '测试球馆', address: '', contactPhone: '', latitude: null, longitude: null, opensAtHour: 7, closesAtHour: 24, revision: 'r1', courts: [{ ...original }], courtCount: 1 })
let scope: ReturnType<typeof effectScope>
function setup() { scope = effectScope(); return scope.run(useVenueSettings)! }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done }); return { promise, resolve } }
beforeEach(() => {
  vi.resetAllMocks(); token = 'admin'; session = reactive({ roles: ['ADMIN'], user: { id: 'admin' } })
  vi.stubGlobal('uni', { getStorageSync: () => token, showToast: vi.fn(), navigateBack: vi.fn() })
  api.venueSettings.mockImplementation(async () => profile())
})
afterEach(() => { scope?.stop(); vi.unstubAllGlobals() })
describe('venue settings mutation lifecycle', () => {
  it.each(['unmount', 'session', 'role'])('ignores delete completion after %s', async reason => {
    const pending = deferred<void>(); api.deleteVenueCourt.mockReturnValue(pending.promise)
    const state = setup(); state.confirmDeleteCourt(original)
    const completion = state.deleteCourt().then(done => { if (done === 'saved') uni.navigateBack() })
    if (reason === 'unmount') scope.stop()
    if (reason === 'session') token = 'other'
    if (reason === 'role') session.roles = ['MEMBER']
    await nextTick(); pending.resolve(); await completion
    expect(api.venueSettings).not.toHaveBeenCalled(); expect(uni.showToast).not.toHaveBeenCalled(); expect(uni.navigateBack).not.toHaveBeenCalled()
  })
  it('does not navigate or toast if unmounted during the refresh after deletion', async () => {
    const refresh = deferred<ReturnType<typeof profile>>(); api.venueSettings.mockReturnValue(refresh.promise)
    const state = setup(); state.confirmDeleteCourt(original)
    const completion = state.deleteCourt().then(done => { if (done === 'saved') uni.navigateBack() })
    await vi.waitFor(() => expect(api.venueSettings).toHaveBeenCalledOnce())
    scope.stop(); refresh.resolve(profile()); await completion
    expect(state.data.value).toBeNull(); expect(uni.showToast).not.toHaveBeenCalled(); expect(uni.navigateBack).not.toHaveBeenCalled()
  })
  it('refreshes and permits one navigation when deletion completes on the active page', async () => {
    const state = setup(); state.confirmDeleteCourt(original)
    if ((await state.deleteCourt()) === 'saved') uni.navigateBack()
    expect(api.deleteVenueCourt).toHaveBeenCalledWith('court'); expect(api.venueSettings).toHaveBeenCalledOnce()
    expect(uni.showToast).toHaveBeenCalledOnce(); expect(uni.navigateBack).toHaveBeenCalledOnce()
  })
  it('submits the read revision and preserves a rejected draft', async () => {
    api.updateVenueCourt.mockRejectedValue(Object.assign(new Error('数据版本已更新'), { businessCode: 'COURT_REVISION_CONFLICT' }))
    const state = setup(); await state.load(); state.editCourt(original); state.court.value!.name = '改名'
    await state.saveCourt()
    expect(api.updateVenueCourt).toHaveBeenCalledWith('court', expect.objectContaining({ revision: original.updatedAt, name: '改名' }))
    expect(state.court.value?.name).toBe('改名'); expect(state.courtError.value).toContain('数据版本已更新'); expect(state.courtConflict.value).toBe(true); expect(uni.showToast).not.toHaveBeenCalled()
  })
  it('explicit reload replaces the stale draft and uses the new revision on retry', async () => {
    const state = setup(); await state.load(); state.editCourt(original); state.court.value!.name = '旧草稿'
    const updatedAt = '2026-09-19T01:00:00.000Z'
    api.venueSettings.mockResolvedValue({ ...profile(), courts: [{ ...original, enabled: false, usage: 'MAINTENANCE', updatedAt }] })
    await state.reloadCourt()
    expect(state.court.value).toMatchObject({ name: original.name, enabled: false, usage: 'MAINTENANCE', updatedAt })
    state.court.value!.name = '重新改名'; await state.saveCourt()
    expect(api.updateVenueCourt).toHaveBeenCalledWith('court', expect.objectContaining({ name: '重新改名', enabled: false, usage: 'MAINTENANCE', revision: updatedAt }))
  })
  it.each(['saveCourt', 'save'] as const)('ignores late %s completion after unmount', async action => {
    const pending = deferred<void>(); api.updateVenueCourt.mockReturnValue(pending.promise); api.saveVenueSettings.mockReturnValue(pending.promise)
    const state = setup(); await state.load(); state.editCourt(original)
    const completion = state[action](); scope.stop(); pending.resolve(); expect(await completion).toBe('inactive')
    expect(api.venueSettings).toHaveBeenCalledTimes(1); expect(uni.showToast).not.toHaveBeenCalled()
  })
  it('a previous account request cannot clear the saving flag of a new operation', async () => {
    const old = deferred<void>(), current = deferred<void>(); api.deleteVenueCourt.mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise)
    const state = setup(); state.confirmDeleteCourt(original); const first = state.deleteCourt()
    session.user = { id: 'other' }; token = 'other'; await nextTick()
    state.confirmDeleteCourt(original); const second = state.deleteCourt()
    old.resolve(); expect(await first).toBe('inactive'); expect(state.saving.value).toBe(true)
    current.resolve(); expect(await second).toBe('saved'); expect(state.saving.value).toBe(false)
  })
  it.each(['saveCourt', 'save', 'deleteCourt'] as const)('distinguishes committed %s from a failed refresh', async action => {
    const state = setup(); await state.load(); state.editCourt(original); state.confirmDeleteCourt(original)
    api.venueSettings.mockRejectedValue(new Error('网络断开'))
    expect(await state[action]()).toBe('saved-refresh-failed')
    expect(state.error.value).toContain('操作已保存'); expect(state.saving.value).toBe(false)
    expect(uni.showToast).not.toHaveBeenCalled(); expect(state.data.value).toBeNull()
    // No stale detail/confirmation is left behind to submit the same operation again.
    expect(await state[action]()).toBe('inactive')
    api.venueSettings.mockResolvedValue(profile()); expect(await state.load()).toBe('loaded')
  })
  it('stays busy through refresh and cannot start a second mutation', async () => {
    const refresh = deferred<ReturnType<typeof profile>>()
    const state = setup(); state.confirmDeleteCourt(original)
    api.venueSettings.mockReturnValue(refresh.promise)
    const pending = state.deleteCourt(); await vi.waitFor(() => expect(api.venueSettings).toHaveBeenCalledOnce())
    expect(state.saving.value).toBe(true); expect(await state.load()).toBe('busy')
    state.confirmDeleteCourt(original); expect(await state.deleteCourt()).toBe('inactive')
    expect(api.deleteVenueCourt).toHaveBeenCalledOnce(); refresh.resolve(profile()); expect(await pending).toBe('saved')
  })
  it('keeps the conflict recovery action after reload fails, independently of message text', async () => {
    const state = setup(); await state.load(); state.editCourt(original)
    api.updateVenueCourt.mockRejectedValue(Object.assign(new Error('Version mismatch'), { businessCode: 'COURT_REVISION_CONFLICT' }))
    await state.saveCourt(); expect(state.courtConflict.value).toBe(true)
    api.venueSettings.mockRejectedValue(new Error('连接中断')); await state.reloadCourt()
    expect(state.courtConflict.value).toBe(true); expect(state.courtError.value).toBe('连接中断')
    await state.saveCourt(); expect(api.updateVenueCourt).toHaveBeenCalledOnce()
  })

})
