import { beforeEach, describe, expect, it, vi } from 'vitest'

const storage = new Map<string, unknown>()
const requestMock = vi.fn()
const reLaunchMock = vi.fn()
const uploadMock = vi.fn()

vi.stubGlobal('uni', {
  getStorageSync: (key: string) => storage.get(key) ?? '',
  setStorageSync: (key: string, value: unknown) => storage.set(key, value),
  removeStorageSync: (key: string) => storage.delete(key),
  request: requestMock,
  uploadFile: uploadMock,
  reLaunch: reLaunchMock,
})

describe('remote authentication transport', () => {
  beforeEach(() => {
    storage.clear()
    requestMock.mockReset()
    reLaunchMock.mockReset()
    uploadMock.mockReset()
    vi.resetModules()
    vi.stubEnv('VITE_DATA_MODE', 'remote')
  })

  it('clears the reactive and persisted session when the API returns 401', async () => {
    const auth = await import('./auth-session')
    auth.saveAuthSession('expired-token', 'member-1')
    const token = auth.useAccessToken()
    requestMock.mockImplementation((options: UniApp.RequestOptions) => {
      options.success?.({
        statusCode: 401,
        data: { code: 401, message: '登录已过期' },
        header: {},
        cookies: [],
      } as UniApp.RequestSuccessCallbackResult)
    })

    const { api } = await import('./http')
    await expect(api.get('/auth/me')).rejects.toMatchObject({ statusCode: 401 })

    expect(token.value).toBe('')
    expect(storage.has('yanqing_access_token')).toBe(false)
    expect(storage.has('yanqing_actor_id')).toBe(false)
    expect(reLaunchMock).toHaveBeenCalledWith({ url: '/pages/login/index' })
  })

  it('keeps a public detail page open when its optional roster session expires', async () => {
    const auth = await import('./auth-session')
    auth.saveAuthSession('expired-token', 'member-1')
    requestMock.mockImplementation((options: UniApp.RequestOptions) => options.success?.({ statusCode: 401, data: { code: 401, message: '登录已过期' }, header: {}, cookies: [] }))
    const { request } = await import('./http')
    await expect(request({ url: '/games/game-1/participants', method: 'GET', redirectOnUnauthorized: false })).rejects.toMatchObject({ statusCode: 401 })
    expect(auth.getAccessToken()).toBe('')
    expect(reLaunchMock).not.toHaveBeenCalled()
    expect(requestMock.mock.calls[0][0]).not.toHaveProperty('redirectOnUnauthorized')
  })

  it('omits absent GET parameters before native query serialization without dropping 0 or false', async () => {
    requestMock.mockImplementation((options) => options.success({ statusCode: 200, data: { code: 0, data: {} } }))
    const { api } = await import('./http')
    const original = { page: 1, status: undefined, businessType: null, count: 0, enabled: false, search: '' }
    await api.get('/orders', original)
    expect(requestMock.mock.calls[0][0].data).toEqual({ page: 1, count: 0, enabled: false, search: '' })
    expect(original).toHaveProperty('status', undefined)
    await api.patch('/auth/profile', { avatarUrl: null })
    expect(requestMock.mock.calls[1][0].data).toEqual({ avatarUrl: null })
  })

  it('turns the native enum validation array into readable feedback while retaining requestId', async () => {
    requestMock.mockImplementation((options) => options.success({ statusCode: 400, data: { code: 400, message: ['status must be one of the following values: PENDING, PAID'], requestId: 'req-filter' } }))
    const { api } = await import('./http')
    await expect(api.get('/orders')).rejects.toMatchObject({ message: '提交的信息有误，请检查后重试', statusCode: 400, requestId: 'req-filter' })
  })

  it('preserves the newly uploaded avatar response and resolves its public origin', async () => {
    vi.stubEnv('VITE_API_BASE_URL', 'https://api.example.test/api/v1')
    uploadMock.mockImplementation((options) => options.success({ statusCode: 201, data: JSON.stringify({ code: 0, data: { id: 'member', avatarUrl: '/uploads/avatars/new.jpg' } }) }))
    const { upload, resolveApiAssetUrl } = await import('./http')
    const user = await upload<{ avatarUrl: string }>('/auth/profile/avatar', 'wxfile://chosen.jpg', 'avatar')
    expect(resolveApiAssetUrl(user.avatarUrl)).toBe('https://api.example.test/uploads/avatars/new.jpg')
    expect(uploadMock.mock.calls[0][0]).toMatchObject({ name: 'avatar', filePath: 'wxfile://chosen.jpg' })
  })
})
