import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'

// Exercise the compiled WeChat branch without injecting platform environment
// variables. This catches build-time substitutions that source mocks conceal.
const root = process.env.UNI_OUTPUT_DIR || fileURLToPath(new URL('../dist/build/mp-weixin/', import.meta.url))
const app = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8'))
assert(app.requiredPrivateInfos?.includes('chooseLocation'), 'Missing chooseLocation declaration')
let calls = 0, pending, privacyRequired = true
const vendor = {
  ref: value => ({ value }), computed: getter => ({ get value() { return getter() } }), onScopeDispose() {},
  index: { chooseLocation(options) { calls++; pending = options }, getPrivacySetting(options) { options.success({ needAuthorization: privacyRequired }) } },
}
const module = { exports: {} }
vm.runInNewContext(fs.readFileSync(path.join(root, 'packages/ops/pages/venue-settings/use-location.js'), 'utf8'), {
  exports: module.exports, module,
  require(name) {
    if (name.endsWith('/common/vendor.js')) return vendor
    if (name === './location-error.js') return { locationFailure: () => ({message: '', settings: false}) }
    if (name.endsWith('/services/auth-session.js')) return { captureAuthSession: () => ({}), isAuthSessionCurrent: () => true }
    throw new Error('Unexpected bundle dependency: ' + name)
  },
})
const form = { value: { address: '', latitude: '', longitude: '' } }
const state = module.exports.useVenueLocation(form, () => true)
assert.equal(calls, 0, 'Must not open a map on page entry')
state.chooseLocation()
assert.equal(calls, 0, 'Must wait for privacy consent')
assert.equal(state.privacyVisible.value, true)
privacyRequired = false
state.agreePrivacy()
assert.equal(calls, 1, 'WeChat bundle must reach the native location API after consent')
pending.success({ name: '测试球馆', address: '测试路1号', latitude: 40.5, longitude: 116 })
pending.complete({ errMsg: 'chooseLocation:ok' })
assert.deepEqual(form.value, { address: '测试路1号 测试球馆', latitude: '40.5', longitude: '116' })
assert.equal(state.choosing.value, false)
console.log('PASS compiled WeChat location: user-triggered native call and address/coordinate fill')

const dialog = fs.readFileSync(path.join(root, 'packages/ops/pages/venue-settings/LocationPrivacyDialog.wxml'), 'utf8')
assert(dialog.includes('agreePrivacyAuthorization') && dialog.includes('bindagreeprivacyauthorization'), 'Consent must use WeChat native agreement event')
