import { getMockVenueCourts } from '../../venue'
import { getMockVenueSettings } from '../../venue-settings'
import { newId, ok, requireMockRole } from '../../policies/common'
import type { MockRouteResult, MockRouteOptions } from '../route-contract'
export async function handleVenueSettings(method: string, url: string, data: any, _options: MockRouteOptions): Promise<MockRouteResult> {
  const edit = url.match(/^\/venues\/courts\/([^/]+)$/)
  if (!['/venues/profile', '/venues/settings', '/venues/courts'].includes(url) && !edit) return { handled: false }
  const profile = () => ({ ...getMockVenueSettings(), courtCount: getMockVenueCourts().filter(c => c.enabled).length })
  if (url === '/venues/profile' && method === 'GET') {
    const { revision: _revision, ...value } = profile()
    return { handled: true, value: ok(value) }
  }
  requireMockRole('ADMIN', 'SUPER_ADMIN')
  if (url === '/venues/settings' && method === 'GET') return { handled: true, value: ok({ ...profile(), courts: getMockVenueCourts().map((c, i) => ({ ...c, zone: c.zone || 'EAST', usage: c.usage === 'PUBLIC' ? 'RETAIL' : c.usage, sortOrder: c.sortOrder ?? i + 1 })) }) }
  if (url === '/venues/settings' && method === 'POST') {
    if ((data.revision || '') !== profile().revision) throw new Error('球馆设置已被修改，请重新加载后再保存')
    if (!Number.isInteger(data.opensAtHour) || !Number.isInteger(data.closesAtHour) || data.opensAtHour < 0 || data.closesAtHour > 24 || data.opensAtHour >= data.closesAtHour) throw new Error('营业时间范围无效')
    if (typeof data.name !== 'string' || data.name.trim().length < 2) throw new Error('请填写球馆名称')
    if ((data.latitude == null) !== (data.longitude == null) || (data.latitude != null && (!Number.isFinite(data.latitude) || !Number.isFinite(data.longitude) || Math.abs(data.latitude) > 90 || Math.abs(data.longitude) > 180))) throw new Error('经纬度无效')
    const value = { name: data.name.trim(), address: String(data.address || '').trim(), contactPhone: String(data.contactPhone || '').trim(), latitude: data.latitude ?? null, longitude: data.longitude ?? null, opensAtHour: data.opensAtHour, closesAtHour: data.closesAtHour, revision: newId('venue-settings') }
    uni.setStorageSync('yanqing_mock_venue_settings', value)
    return { handled: true, value: ok(profile()) }
  }
  if ((url === '/venues/courts' && method === 'POST') || (edit && method === 'PATCH')) {
    const courts = getMockVenueCourts()
    if (!data.name?.trim() || !['RETAIL', 'TRAINING', 'MEMBER_BLOCK', 'MAINTENANCE'].includes(data.usage) || typeof data.enabled !== 'boolean') throw new Error('场地名称、用途或状态无效')
    let saved
    if (edit) {
      saved = courts.find(c => c.id === edit[1]); if (!saved) throw new Error('场地不存在')
      Object.assign(saved, { name: data.name.trim(), usage: data.usage, enabled: data.enabled, sortOrder: data.sortOrder })
    } else {
      if (!/^[A-Z0-9][A-Z0-9_-]{0,31}$/.test(data.code || '')) throw new Error('场地编号无效')
      if (courts.some(c => c.code === data.code)) throw new Error('场地编号已存在')
      saved = { ...data, id: newId('court'), name: data.name.trim() }; courts.push(saved)
    }
    uni.setStorageSync('yanqing_mock_venue_courts', courts)
    return { handled: true, value: ok(saved) }
  }
  return { handled: false }
}
