import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { deferred } from '../../test-utils/sfc-script'
import { useLoginConsent } from './use-login-consent'

function form() {
  const logout = vi.fn(), finish = vi.fn(), leave = vi.fn()
  return { ...useLoginConsent(logout, finish, leave), logout, finish, leave }
}
describe('voluntary login consent', () => {
  it('starts unchecked and never calls authorization without affirmative consent', async () => {
    const p = form(), authorize = vi.fn()
    expect(p.agreed.value).toBe(false)
    await p.login(authorize)
    expect(authorize).not.toHaveBeenCalled(); expect(p.error.value).toContain('自主勾选'); expect(p.finish).not.toHaveBeenCalled()
    p.cancel(); expect(p.leave).toHaveBeenCalledOnce(); expect(p.logout).not.toHaveBeenCalled()
  })
  it('allows one login after checking, and never carries consent to a new visit', async () => {
    const p = form(), response = deferred(), authorize = vi.fn(() => response.promise)
    p.agreed.value = true
    const first = p.login(authorize); await p.login(authorize)
    expect(authorize).toHaveBeenCalledOnce()
    response.resolve({}); await first
    expect(p.finish).toHaveBeenCalledOnce(); expect(p.pending.value).toBe(false)
    p.abandon(); expect(p.logout).not.toHaveBeenCalled()
    expect(form().agreed.value).toBe(false)
  })
  it.each(['cancel', 'abandon'] as const)('invalidates pending authorization on %s and ignores late completion', async action => {
    const p = form(), response = deferred()
    p.agreed.value = true
    const task = p.login(() => response.promise)
    p[action]()
    expect(p.logout).toHaveBeenCalledOnce(); expect(p.pending.value).toBe(false)
    response.resolve({}); await task
    expect(p.finish).not.toHaveBeenCalled(); expect(p.error.value).toBe('')
  })
  it('shows a failed authorization once and does not retry or prevent leaving', async () => {
    const p = form(), authorize = vi.fn(async () => { throw new Error('用户取消授权') })
    p.agreed.value = true; await p.login(authorize)
    expect(authorize).toHaveBeenCalledOnce(); expect(p.error.value).toBe('用户取消授权')
    p.cancel(); expect(p.leave).toHaveBeenCalledOnce()
  })
  it('wires visible consent, readable agreements, cancel and unload without automatic profile permissions', () => {
    const page = readFileSync(new URL('./index.vue', import.meta.url), 'utf8')
    const policy = readFileSync(new URL('./components/LoginAgreements.vue', import.meta.url), 'utf8')
    expect(page).toContain(':checked="agreed"'); expect(page).toContain('@change="changeConsent"')
    expect(page).toContain('onUnload(abandon)'); expect(page).toContain('@tap="cancel">暂不登录，继续浏览')
    expect(page).toContain('@close="agreement = null"'); expect(page).toContain("agreement = 'privacy'")
    expect(page).not.toMatch(/登录即表示同意|chooseAvatar|type="nickname"|getPhoneNumber/)
    expect(policy).toContain('不同意，继续浏览'); expect(policy).toContain('查询、更正与注销')
  })
})
