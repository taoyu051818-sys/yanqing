import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick, ref, type EffectScope } from 'vue'
const hooks = vi.hoisted(() => ({ back: undefined as (() => boolean) | undefined, hide: undefined as (() => void) | undefined, show: undefined as (() => void) | undefined, unmount: undefined as (() => void) | undefined }))
vi.mock('@dcloudio/uni-app', () => ({ onBackPress: (cb: any) => { hooks.back = cb }, onShow: (cb: any) => { hooks.show = cb }, onHide: (cb: any) => { hooks.hide = cb } }))
vi.mock('vue', async importOriginal => ({ ...await importOriginal<typeof import('vue')>(), onUnmounted: (cb: any) => { hooks.unmount = cb } }))
import { useUnsavedForm } from './use-unsaved-form'
let scope: EffectScope
let native: any
beforeEach(() => {
  scope = effectScope()
  native = { enableAlertBeforeUnload:vi.fn(), disableAlertBeforeUnload:vi.fn(), showModal:vi.fn().mockResolvedValue({ confirm:false }), navigateBack:vi.fn() }
  vi.stubGlobal('uni', native)
})
afterEach(() => { hooks.unmount?.(); scope.stop(); vi.unstubAllGlobals() })
function form() {
  const name = ref(''), editing = ref(false)
  const guard = scope.run(() => useUnsavedForm(() => name.value, () => editing.value))!
  return { name, editing, ...guard }
}
describe('未保存表单退出保护', () => {
  it('列表状态与打开表单初始值不触发提醒，用户编辑后才触发', async () => {
    const f = form(); f.name.value = '从服务器载入'; f.editing.value = true
    expect(f.dirty.value).toBe(false)
    f.name.value = '用户修改'; await nextTick()
    expect(f.dirty.value).toBe(true)
    expect(native.enableAlertBeforeUnload).toHaveBeenCalled()
    f.markSaved(); await nextTick()
    expect(f.dirty.value).toBe(false)
    expect(hooks.back?.()).toBe(false)
  })
  it('连续点击返回只弹出一次，取消后保留数据和当前页面', async () => {
    const f = form(); f.editing.value = true; f.name.value = '未保存'
    expect(hooks.back?.()).toBe(true); expect(hooks.back?.()).toBe(true)
    expect(native.showModal).toHaveBeenCalledTimes(1)
    await Promise.resolve(); await Promise.resolve()
    expect(native.navigateBack).not.toHaveBeenCalled()
    expect(f.name.value).toBe('未保存')
    expect(f.dirty.value).toBe(true)
  })
  it('明确放弃后只返回一次，不再次拦截程序返回', async () => {
    native.showModal.mockResolvedValue({ confirm:true })
    const f = form(); f.editing.value = true; f.name.value = '未保存'
    expect(hooks.back?.()).toBe(true)
    await vi.waitFor(() => expect(native.navigateBack).toHaveBeenCalledTimes(1))
    expect(hooks.back?.()).toBe(false)
  })
  it('表单隐藏时释放系统退出提示，回到表单时恢复', async () => {
    const f = form(); f.editing.value = true; f.name.value = '未保存'; await nextTick()
    hooks.hide?.(); expect(native.disableAlertBeforeUnload).toHaveBeenCalled()
    const calls = native.enableAlertBeforeUnload.mock.calls.length
    hooks.show?.(); expect(native.enableAlertBeforeUnload).toHaveBeenCalledTimes(calls + 1)
  })
})
