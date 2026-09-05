import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mockRequest } from './router'
import { mockLogin, updateMockProfile } from './core'
import { saveOrders } from './venue'
const storage = new Map<string, any>()
vi.stubGlobal('uni', {
  getStorageSync: (key: string) => storage.get(key) ?? '',
  setStorageSync: (key: string, value: unknown) => storage.set(key, value),
  removeStorageSync: (key: string) => storage.delete(key),
})
describe('member journey mock parity', () => {
  beforeEach(() => storage.clear())
  it('supports server-side status filters and pagination without dropping old orders', async () => {
    const { user } = mockLogin('MEMBER')
    saveOrders(Array.from({ length: 25 }, (_, index) => ({ id: `journey-${index}`, memberId: user.id, businessType: 'GOODS', title: '测试订单', status: index < 22 ? 'PAID' : 'PENDING', createdAt: new Date(Date.now() - index * 1000).toISOString() })))
    const pending: any = await mockRequest('GET', '/orders', { status: 'PENDING', pageSize: 1 })
    expect(pending.total).toBe(3)
    expect(pending.items).toHaveLength(1)
    expect(pending.items[0].status).toBe('PENDING')
    const second: any = await mockRequest('GET', '/orders', { status: 'PAID', page: 2, pageSize: 20 })
    expect(second.total).toBe(22)
    expect(second.items).toHaveLength(2)
  })
  it('can log in again after changing a nickname, but still rejects a disabled identity', () => {
    const { user } = mockLogin('MEMBER')
    updateMockProfile('旅程测试昵称')
    expect(mockLogin('MEMBER').user.displayName).toBe('旅程测试昵称')
    storage.set('yanqing_mock_governance_users', [{ id: user.id, status: 'DISABLED' }])
    expect(() => mockLogin('MEMBER')).toThrow('停用')
  })
})
