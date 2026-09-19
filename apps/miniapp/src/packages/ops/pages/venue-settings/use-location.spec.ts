import { effectScope, ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useVenueLocation } from './use-location'

let options: UniApp.ChooseLocationOptions, token = 'admin-session'
let scope: ReturnType<typeof effectScope>
const choose = vi.fn((value: UniApp.ChooseLocationOptions) => { options = value })
function setup(address = '原地址', latitude = '', longitude = '') {
  scope = effectScope()
  const form = ref({ address, latitude, longitude })
  const editable = ref(true)
  const actions = scope.run(() => useVenueLocation(form, () => editable.value))!
  return { form, editable, ...actions }
}
beforeEach(() => {
  token = 'admin-session'; choose.mockClear(); vi.stubEnv('UNI_PLATFORM', 'mp-weixin')
  vi.stubGlobal('uni', { chooseLocation: choose, getStorageSync: () => token })
})
afterEach(() => { scope?.stop(); vi.unstubAllEnvs(); vi.unstubAllGlobals() })

describe('optional venue location selection', () => {
  it('does not request location on entry; text-only address clears stale coordinates', () => {
    const state = setup('旧地址', '40.45', '115.97')
    expect(choose).not.toHaveBeenCalled()
    state.changeAddress('延庆某街道金羽球馆')
    expect(state.form.value).toEqual({ address: '延庆某街道金羽球馆', latitude: '', longitude: '' })
    expect(state.locationMessage.value).toContain('原定位已清除')
  })
  it('opens at the existing location, prevents double taps and fills address and coordinates', () => {
    const state = setup('旧地址', '40.45', '115.97')
    state.chooseLocation(); state.chooseLocation()
    expect(choose).toHaveBeenCalledTimes(1)
    expect(options).toMatchObject({ latitude: 40.45, longitude: 115.97 })
    options.success!({ name: '金羽球馆', address: '测试路1号', latitude: 40.5, longitude: 116 })
    options.complete!({ errMsg: 'chooseLocation:ok' })
    expect(state.form.value).toEqual({ address: '测试路1号 金羽球馆', latitude: '40.5', longitude: '116' })
    expect(state.choosing.value).toBe(false)
    state.useTextAddress()
    expect(state.form.value).toEqual({ address: '测试路1号 金羽球馆', latitude: '', longitude: '' })
  })
  it('cancel preserves the draft and permission denial allows text input without retrying', () => {
    const state = setup()
    state.chooseLocation(); options.fail!({ errMsg: 'chooseLocation:fail cancel' }); options.complete!({ errMsg: 'cancel' })
    expect(state.locationMessage.value).toBe('')
    expect(state.form.value.address).toBe('原地址')
    state.chooseLocation(); options.fail!({ errMsg: 'chooseLocation:fail auth deny' }); options.complete!({ errMsg: 'auth deny' })
    expect(state.locationMessage.value).toContain('文字地址')
    state.changeAddress('文字地址')
    expect(state.form.value.address).toBe('文字地址')
    expect(choose).toHaveBeenCalledTimes(2)
  })
  it.each(['reset', 'unmount', 'session', 'role'])('ignores late callbacks after %s', reason => {
    const state = setup(); state.chooseLocation()
    if (reason === 'reset') state.resetLocationRequest()
    if (reason === 'unmount') scope.stop()
    if (reason === 'session') token = 'different-session'
    if (reason === 'role') state.editable.value = false
    options.success!({ name: '不应写入', address: '旧请求', latitude: 40, longitude: 116 })
    expect(state.form.value).toEqual({ address: '原地址', latitude: '', longitude: '' })
  })
  it('rejects invalid results without replacing the saved draft', () => {
    const state = setup(); state.chooseLocation()
    options.success!({ name: '错误', address: '错误位置', latitude: NaN, longitude: 116 })
    expect(state.form.value.address).toBe('原地址')
    expect(state.hasLocation.value).toBe(false)
    expect(state.locationMessage.value).toContain('有效位置')
  })
  it('offers text input on H5 without opening an unconfigured map', () => {
    vi.stubEnv('UNI_PLATFORM', 'h5')
    const state = setup(); state.chooseLocation()
    expect(choose).not.toHaveBeenCalled()
    expect(state.locationMessage.value).toContain('微信小程序')
    state.changeAddress('简单文字地址')
    expect(state.form.value.address).toBe('简单文字地址')
  })
})
