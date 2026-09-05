import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
const endpoints = vi.hoisted(() => ({ uploadMyAvatar: vi.fn(), updateMyProfile: vi.fn() }))
vi.mock('../services/api', () => ({ endpoints }))
vi.mock('../services/http', () => ({ isMockMode: false }))
import { useSessionStore } from './session'
vi.stubGlobal('uni', { getStorageSync: () => '', setStorageSync: vi.fn(), removeStorageSync: vi.fn() })
const user = { id: 'member', displayName: '球友', roles: ['MEMBER'], avatarUrl: '/uploads/avatars/new.jpg' }

describe('uploaded profile refresh', () => {
  beforeEach(() => { vi.clearAllMocks(); setActivePinia(createPinia()) })
  it('publishes the uploaded avatar immediately, before the nickname request finishes', async () => {
    let finish!: (value: any) => void
    endpoints.uploadMyAvatar.mockResolvedValue(user)
    endpoints.updateMyProfile.mockImplementation(() => new Promise(resolve => { finish = resolve }))
    const session = useSessionStore()
    const saving = session.updateWechatProfile('新昵称', 'wxfile://new.jpg')
    await vi.waitFor(() => expect(session.user?.avatarUrl).toBe(user.avatarUrl))
    expect(session.loading).toBe(true)
    finish({ ...user, displayName: '新昵称' })
    await saving
    expect(session.user).toMatchObject({ avatarUrl: user.avatarUrl, displayName: '新昵称' })
    expect(session.loading).toBe(false)
  })
  it('keeps an already uploaded avatar if the separate nickname save fails', async () => {
    endpoints.uploadMyAvatar.mockResolvedValue(user)
    endpoints.updateMyProfile.mockRejectedValue(new Error('稍后重试'))
    const session = useSessionStore()
    await expect(session.updateWechatProfile('新昵称', 'wxfile://new.jpg')).rejects.toThrow('稍后重试')
    expect(session.user?.avatarUrl).toBe(user.avatarUrl)
    expect(session.loading).toBe(false)
  })
})
