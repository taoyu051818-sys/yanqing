import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useOperationTask, validateTaskField } from './operation-task'
vi.mock('vue', async original => ({ ...await original<typeof import('vue')>(), onUnmounted: vi.fn() }))
const storage = new Map<string, unknown>()
vi.stubGlobal('document', { querySelector: () => null })
vi.stubGlobal('uni', { getStorageSync: (key: string) => storage.get(key), pageScrollTo: vi.fn() })
describe('modal operation task', () => {
  beforeEach(() => { vi.clearAllMocks(); storage.clear(); storage.set('yanqing_actor_id', 'operator-a') })
  it.each(['-1', '1.111', '1e3', 'NaN'])('rejects invalid money %s', value => {
    expect(validateTaskField({ key: 'amount', label: '金额', kind: 'money' }, value)).not.toBe('')
  })
  it('allows zero stock counts but rejects fractional quantities', () => {
    const field = { key: 'count', label: '盘点数量', kind: 'number' as const, min: 0, max: 8 }
    expect(validateTaskField(field, '0')).toBe('')
    expect(validateTaskField(field, '1.5')).not.toBe('')
    expect(validateTaskField(field, '9')).not.toBe('')
  })
  it('does not default a choice, nor silently replace an unfinished task', () => {
    const task = useOperationTask(), submit = vi.fn()
    task.start({ title: '核销', description: '', confirmText: '确认', fields: [{ key: 'reason', label: '原因', kind: 'choices', options: [{ value: 'a', label: '到场' }] }], submit })
    expect(task.state.values.reason).toBe('')
    task.start({ title: '另一笔', description: '', confirmText: '', fields: [], submit })
    expect(task.state.title).toBe('核销')
  })
  it('retains values on server rejection and permits correction and retry', async () => {
    const task = useOperationTask(), submit = vi.fn().mockRejectedValueOnce(new Error('状态已变化，请重新核对')).mockResolvedValue('处理成功')
    task.start({ title: '核销', description: '', confirmText: '确认', fields: [{ key: 'reason', label: '说明', min: 2 }], submit })
    task.state.values.reason = '已现场核查'
    await task.submit()
    expect(task.state.open).toBe(true)
    expect(task.state.values.reason).toBe('已现场核查')
    expect(task.state.error).toContain('状态已变化')
    await task.submit()
    expect(task.state.result).toBe('处理成功')
  })
  it('blocks duplicate clicks and an identity change before commit', async () => {
    const task = useOperationTask()
    let resolve!: (value: string) => void
    const submit = vi.fn(() => new Promise<string>(done => { resolve = done }))
    task.start({ title: '审核', description: '', confirmText: '', fields: [], submit })
    const first = task.submit()
    await task.submit()
    expect(submit).toHaveBeenCalledTimes(1)
    resolve('完成'); await first
    task.start({ title: '第二笔', description: '', confirmText: '', fields: [], submit })
    storage.set('yanqing_actor_id', 'operator-b')
    await task.submit()
    expect(submit).toHaveBeenCalledTimes(1)
    expect(task.state.error).toContain('登录身份已变化')
  })
  it('opens and focuses validation inside the dialog without moving the background page', async () => {
    const task = useOperationTask(), submit = vi.fn()
    task.start({ title: '批准', description: '', confirmText: '确认批准', fields: [{ key: 'reason', label: '复核依据', min: 2 }], submit })
    await task.submit()
    expect(task.state.focusKey).toBe('reason')
    expect(task.state.scrollTarget).toBe('task-field-reason')
    expect(uni.pageScrollTo).not.toHaveBeenCalled()
    expect(submit).not.toHaveBeenCalled()
  })
  it('cancels without submitting and cannot submit after closing', async () => {
    const task = useOperationTask(), submit = vi.fn()
    task.start({ title: '批准', description: '', confirmText: '确认', fields: [], submit })
    task.cancel(); await task.submit()
    expect(task.state.open).toBe(false)
    expect(submit).not.toHaveBeenCalled()
  })
  it('keeps the dialog open during submission and dismisses the completed result explicitly', async () => {
    const task = useOperationTask()
    let finish!: (value: string) => void
    task.start({ title: '批准', description: '', confirmText: '确认', fields: [], submit: () => new Promise(done => { finish = done }) })
    const pending = task.submit(); task.cancel()
    expect(task.state.open).toBe(true)
    finish('已批准'); await pending
    expect(task.state.result).toBe('已批准')
    task.cancel(); expect(task.state.result).toBe('')
  })
  it('revalidates a dynamic option before submitting', async () => {
    const task = useOperationTask(), submit = vi.fn()
    task.start({ title: '订场', description: '', confirmText: '', fields: [{ key: 'slot', label: '时段', kind: 'choices', initial: 'old', optionsFor: () => [] }], submit })
    await task.submit()
    expect(submit).not.toHaveBeenCalled()
    expect(task.state.errors.slot).toBe('请重新选择时段')
  })
})
