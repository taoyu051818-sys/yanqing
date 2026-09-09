import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const storage = new Map<string, unknown>()
const requests: any[] = []
const uploads: any[] = []
const downloads: any[] = []
const relaunch = vi.fn()
const inviteCode = 'abcdefghijklmnopqrstuvwxyz_12345'
const member = (id = 'old-member') => ({ id, displayName: id, roles: ['MEMBER'], accounts: [], memberProfile: {}, hasReferrer: false })
let auth: typeof import('./auth-session')
let http: typeof import('./http')
let referral: typeof import('./referral-attribution')
let session: ReturnType<typeof import('../stores/session')['useSessionStore']>
function respond(options: any, status: number, data?: unknown) {
  options.success({ statusCode: status, data: status < 300 ? { code: 0, data } : { code: status, message: '隔离响应' }, header: {}, cookies: [] })
}

describe('session lifecycle across real transport callbacks', () => {
  beforeEach(async () => {
    vi.resetModules(); storage.clear(); requests.length = 0; uploads.length = 0; downloads.length = 0; relaunch.mockReset()
    vi.stubEnv('VITE_DATA_MODE', 'remote')
    vi.stubGlobal('uni', {
      getStorageSync: (key: string) => storage.get(key) ?? '',
      setStorageSync: (key: string, value: unknown) => storage.set(key, value),
      removeStorageSync: (key: string) => storage.delete(key),
      request: (options: any) => requests.push(options),
      uploadFile: (options: any) => uploads.push(options),
      downloadFile: (options: any) => downloads.push(options),
      reLaunch: relaunch,
      login: async () => ({ code: 'local-wechat-code' }),
    })
    const { createPinia, setActivePinia } = await import('pinia')
    setActivePinia(createPinia())
    auth = await import('./auth-session'); http = await import('./http'); referral = await import('./referral-attribution')
    auth.saveAuthSession('old-token', 'old-member')
    session = (await import('../stores/session')).useSessionStore()
    session.user = member() as never
  })
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals() })

  it('ignores a late 401 for an older session', async () => {
    const result = http.api.get('/auth/me')
    const rejected = expect(result).rejects.toBeInstanceOf(auth.AuthSessionChangedError)
    expect(requests[0].header.authorization).toBe('Bearer old-token')
    auth.saveAuthSession('new-token', 'new-member')
    respond(requests[0], 401)
    await rejected
    expect(auth.getAccessToken()).toBe('new-token')
    expect(storage.get('yanqing_actor_id')).toBe('new-member')
    expect(relaunch).not.toHaveBeenCalled()
  })
  it('ignores an old upload failure after a newer login', async () => {
    const result = http.upload('/auth/profile/avatar', 'wxfile://local', 'avatar')
    const rejected = expect(result).rejects.toBeInstanceOf(auth.AuthSessionChangedError)
    expect(uploads[0].header.authorization).toBe('Bearer old-token')
    auth.saveAuthSession('new-token', 'new-member')
    uploads[0].success({ statusCode: 401, data: JSON.stringify({ code: 401, message: '隔离旧请求' }) })
    await rejected
    expect(auth.getAccessToken()).toBe('new-token')
  })
  it('a 401 for the current session should still log out (control)', async () => {
    const result = http.api.get('/auth/me')
    const rejected = expect(result).rejects.toMatchObject({ statusCode: 401 })
    respond(requests[0], 401); await rejected
    expect(auth.getAccessToken()).toBe('')
  })
  it('discards successful hydration after logout', async () => {
    const refreshing = session.hydrate()
    session.logout()
    expect(session.user).toBeNull()
    respond(requests[0], 200, member())
    expect(await refreshing).toBe(false)
    expect(session.isAuthenticated).toBe(false)
    expect(session.user).toBeNull()
  })
  it('preserves a newer WeChat user when an old profile arrives', async () => {
    const refreshing = session.hydrate()
    session.logout()
    const loggingIn = session.loginWithWechat()
    await vi.waitFor(() => expect(requests).toHaveLength(2))
    respond(requests[1], 200, { accessToken: 'new-token', user: member('new-member') })
    await vi.waitFor(() => expect(requests).toHaveLength(3))
    respond(requests[2], 200, member('new-member'))
    await loggingIn
    expect(session.user?.id).toBe('new-member')
    respond(requests[0], 200, member())
    await refreshing
    expect(auth.getAccessToken()).toBe('new-token')
    expect(storage.get('yanqing_actor_id')).toBe('new-member')
    expect(session.user?.id).toBe('new-member')
  })
  it.each([409, 429, 500, 503])('retries a temporary %s binding failure after recovery', async status => {
    referral.captureReferralAttribution({ query: { invite: inviteCode } })
    const applying = session.applyPendingReferral()
    expect(requests[0].url).toContain('/members/me/referrer')
    expect(requests[0].data).toEqual({ inviteCode })
    respond(requests[0], status)
    expect(await applying).toBe('failed')
    expect(referral.pendingReferralInvite()).toBe(inviteCode)
    // The user opens a page again after the service has recovered.
    const refreshing = session.hydrate()
    respond(requests[1], 200, member())
    await vi.waitFor(() => expect(requests).toHaveLength(3))
    expect(requests[2].data).toEqual({ inviteCode })
    respond(requests[2], 200, {})
    await vi.waitFor(() => expect(requests).toHaveLength(4))
    respond(requests[3], 200, { ...member(), hasReferrer: true })
    expect(await refreshing).toBe(true)
    expect(session.user?.hasReferrer).toBe(true)
    expect(referral.pendingReferralInvite()).toBeNull()
  })
  it('a network failure keeps the invitation for retry (control)', async () => {
    referral.captureReferralAttribution({ query: { invite: inviteCode } })
    const applying = session.applyPendingReferral()
    requests[0].fail({ errMsg: 'request:fail' })
    expect(await applying).toBe('failed')
    expect(referral.pendingReferralInvite()).toBe(inviteCode)
  })
  it.each([400, 404])('discards terminal invitation errors (%s)', async (status) => {
    referral.captureReferralAttribution({ query: { invite: inviteCode } })
    const applying = session.applyPendingReferral()
    respond(requests[0], status)
    expect(await applying).toBe('failed')
    expect(referral.pendingReferralInvite()).toBeNull()
  })

  it('invalidates old requests even if the next login returns the same token', async () => {
    const result = http.api.get('/auth/me')
    const rejected = expect(result).rejects.toBeInstanceOf(auth.AuthSessionChangedError)
    auth.saveAuthSession('old-token', 'old-member')
    respond(requests[0], 401)
    await rejected
    expect(auth.getAccessToken()).toBe('old-token')
    expect(relaunch).not.toHaveBeenCalled()
  })

  it('does not send a nickname update after an obsolete avatar upload completes', async () => {
    const saving = session.updateWechatProfile('旧昵称', 'wxfile://old.jpg')
    const rejected = expect(saving).rejects.toBeInstanceOf(auth.AuthSessionChangedError)
    session.logout()
    uploads[0].success({ statusCode: 200, data: JSON.stringify({ code: 0, data: member() }) })
    await rejected
    expect(requests).toHaveLength(0)
    expect(session.user).toBeNull()
    expect(session.loading).toBe(false)
  })

  it('cancels native WeChat authorization when the user logs out', async () => {
    let authorize!: (value: any) => void
    uni.login = vi.fn(() => new Promise(resolve => { authorize = resolve })) as any
    const loggingIn = session.loginWithWechat()
    const rejected = expect(loggingIn).rejects.toBeInstanceOf(auth.AuthSessionChangedError)
    session.logout()
    authorize({ code: 'obsolete-code' })
    await rejected
    expect(requests).toHaveLength(0)
    expect(session.user).toBeNull()
  })

  it('an older login cannot win or dismiss the loading state of a newer login', async () => {
    const first = session.loginForDevelopment('MEMBER')
    const rejected = expect(first).rejects.toBeInstanceOf(auth.AuthSessionChangedError)
    const second = session.loginForDevelopment('ADMIN')
    respond(requests[0], 200, { accessToken: 'first-token', user: member('first') })
    await rejected
    expect(session.loading).toBe(true)
    respond(requests[1], 200, { accessToken: 'second-token', user: member('second') })
    await vi.waitFor(() => expect(requests).toHaveLength(3))
    respond(requests[2], 200, member('second'))
    await second
    expect(session.user?.id).toBe('second')
    expect(session.loading).toBe(false)
  })

  it('keeps the invitation when authentication expires during binding', async () => {
    referral.captureReferralAttribution({ query: { invite: inviteCode } })
    const applying = session.applyPendingReferral()
    respond(requests[0], 401)
    await applying
    expect(referral.pendingReferralInvite()).toBe(inviteCode)
    expect(session.user).toBeNull()
  })

  it('an old invalid-invitation response cannot erase a newly opened invitation', async () => {
    referral.captureReferralAttribution({ query: { invite: inviteCode } })
    const applying = session.applyPendingReferral()
    const nextInvite = 'another_invitation_1234567890'
    referral.captureReferralAttribution({ query: { invite: nextInvite } })
    respond(requests[0], 400)
    await applying
    expect(referral.pendingReferralInvite()).toBe(nextInvite)
  })

  it('does not continue referral binding under a different account', async () => {
    referral.captureReferralAttribution({ query: { invite: inviteCode } })
    const applying = session.applyPendingReferral()
    auth.saveAuthSession('new-token', 'new-member')
    respond(requests[0], 200, {})
    await applying
    expect(requests).toHaveLength(1)
    expect(referral.pendingReferralInvite()).toBe(inviteCode)
  })

  it('reconciles a successful binding when the following profile refresh fails', async () => {
    referral.captureReferralAttribution({ query: { invite: inviteCode } })
    const applying = session.applyPendingReferral()
    respond(requests[0], 200, {})
    await vi.waitFor(() => expect(requests).toHaveLength(2))
    respond(requests[1], 503)
    expect(await applying).toBe('failed')
    expect(referral.pendingReferralInvite()).toBe(inviteCode)
    const refreshing = session.hydrate()
    respond(requests[2], 200, { ...member(), hasReferrer: true })
    expect(await refreshing).toBe(true)
    expect(requests).toHaveLength(3)
    expect(referral.pendingReferralInvite()).toBeNull()
    expect(session.referralAttribution).toBe('already-bound')
  })

  it.each(['wechat', 'development'])('keeps the actual mock %s login working', async (kind) => {
    vi.resetModules()
    vi.stubEnv('VITE_DATA_MODE', 'mock')
    const { createPinia, setActivePinia } = await import('pinia')
    setActivePinia(createPinia())
    const mockSession = (await import('../stores/session')).useSessionStore()
    if (kind === 'wechat') await mockSession.loginWithWechat()
    else await mockSession.loginForDevelopment('ADMIN')
    expect(mockSession.isAuthenticated).toBe(true)
    expect(mockSession.user?.id).toBe(kind === 'wechat' ? 'user-member' : 'user-admin')
    expect(mockSession.loading).toBe(false)
  })

  it('discards reports downloaded for a previous account', async () => {
    const downloading = http.download('/reports/export')
    const rejected = expect(downloading).rejects.toBeInstanceOf(auth.AuthSessionChangedError)
    auth.saveAuthSession('new-token', 'new-member')
    downloads[0].success({ statusCode: 200, tempFilePath: 'wxfile://old-report.csv' })
    await rejected
  })

  it('classifies an obsolete network error as a session change', async () => {
    const fetching = http.api.get('/auth/me')
    const rejected = expect(fetching).rejects.toBeInstanceOf(auth.AuthSessionChangedError)
    session.logout()
    requests[0].fail({ errMsg: 'request:fail' })
    await rejected
    expect(relaunch).not.toHaveBeenCalled()
  })

  it('a delayed mock login cannot restore credentials after logout', async () => {
    vi.resetModules()
    vi.stubEnv('VITE_DATA_MODE', 'mock')
    const { createPinia, setActivePinia } = await import('pinia')
    setActivePinia(createPinia())
    const mockSession = (await import('../stores/session')).useSessionStore()
    const loggingIn = mockSession.loginForDevelopment('ADMIN')
    const rejected = expect(loggingIn).rejects.toThrow('登录状态已更新')
    mockSession.logout()
    await rejected
    expect(storage.has('yanqing_access_token')).toBe(false)
    expect(mockSession.user).toBeNull()
    expect(mockSession.loading).toBe(false)
  })
})
