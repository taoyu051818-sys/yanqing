import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mockRequest } from './router'
import { resetCatalogState } from './state'
const storage = new Map<string, unknown>()
vi.stubGlobal('uni', { getStorageSync: (key: string) => storage.get(key) ?? '', setStorageSync: (key: string, value: unknown) => storage.set(key, value), removeStorageSync: (key: string) => storage.delete(key) })
const request = (method: string, url: string, data = {}): Promise<any> => mockRequest(method, url, data)
describe('venue settings and public booking', () => {
  beforeEach(() => { storage.clear(); resetCatalogState() })
  it('allows public venue info but restricts editing', async () => {
    expect(await request('GET', '/venues/profile')).toMatchObject({ courtCount: 20, opensAtHour: 7, closesAtHour: 24 })
    await expect(request('GET', '/venues/settings')).rejects.toThrow()
    await request('POST', '/auth/dev-login', { role: 'FRONT_DESK' })
    await expect(request('GET', '/venues/settings')).rejects.toThrow()
  })
  it('saves hours, court state and name, and preserves unavailable assisted resources', async () => {
    await request('POST', '/auth/dev-login', { role: 'ADMIN' })
    const before = await request('GET', '/venues/settings')
    await request('POST', '/venues/settings', { ...before, name: '测试羽球馆', address: '测试路1号', latitude: 40, longitude: 116, opensAtHour: 6, closesAtHour: 22 })
    const normal = await request('GET', '/venues/availability', { date: '2030-01-01' })
    expect(normal.slots[0]).toMatchObject({ startMinutes: 360, enabled: true })
    expect(normal.slots[0].price).toBeUndefined()
    expect(normal.slots.at(-1).endMinutes).toBe(1320)
    await expect(request('POST', '/venues/settings', { ...before, opensAtHour: 8, closesAtHour: 20 })).rejects.toThrow('已被修改')
    await request('PATCH', '/venues/courts/court-1', { name: '比赛场', usage: 'RETAIL', enabled: false, sortOrder: 1 })
    expect((await request('GET', '/venues/profile')).courtCount).toBe(19)
    expect((await request('GET', '/venues/availability', { date: '2030-01-01' })).courts.some((c: any) => c.id === 'court-1')).toBe(false)
    const assisted = await request('GET', '/venues/availability/assisted', { date: '2030-01-01' })
    expect(assisted.courts.find((c: any) => c.id === 'court-1')).toMatchObject({ name: '比赛场', enabled: false })
    expect(assisted.slots.find((s: any) => s.startMinutes === 1380).enabled).toBe(false)
    const dto = { code: 'C21', name: '新场地', usage: 'RETAIL', zone: 'EAST', enabled: true, sortOrder: 21 }
    await request('POST', '/venues/courts', dto)
    await expect(request('POST', '/venues/courts', dto)).rejects.toThrow('已存在')
    expect((await request('GET', '/venues/profile')).courtCount).toBe(20)
  })
})
