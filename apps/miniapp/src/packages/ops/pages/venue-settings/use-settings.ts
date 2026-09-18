import { computed, ref, watch } from 'vue'
import { endpoints } from '../../../../services/api'
import { captureAuthSession, isAuthSessionCurrent } from '../../../../services/auth-session'
import { useSessionStore } from '../../../../stores/session'
import type { VenueCourt, VenueSettings } from '../../../../types/venue-settings'
export const hourLabel = (n: number) => `${String(n).padStart(2, '0')}:00`
export const usages = [{ value: 'RETAIL', label: '普通订场' }, { value: 'MEMBER_BLOCK', label: '会员预留' }, { value: 'TRAINING', label: '培训专用' }, { value: 'MAINTENANCE', label: '维护中' }] as const
export function useVenueSettings() {
  const session = useSessionStore()
  const allowed = computed(() => session.roles.some(role => role === 'ADMIN' || role === 'SUPER_ADMIN'))
  const loading = ref(false), saving = ref(false), error = ref(''), courtError = ref('')
  const data = ref<VenueSettings | null>(null)
  const form = ref({ name: '', address: '', contactPhone: '', latitude: '', longitude: '', opensAtHour: 7, closesAtHour: 24 })
  const confirmation = ref(false)
  const court = ref<VenueCourt | null>(null)
  let sequence = 0
  function clear() { sequence++; data.value = null; court.value = null; confirmation.value = false; error.value = ''; loading.value = false }
  watch(() => session.user?.id, clear)
  watch(allowed, value => { if (!value) clear() })
  async function load(preserveForm = false) {
    if (!allowed.value || saving.value) return
    const run = ++sequence, owner = captureAuthSession()
    loading.value = true; error.value = ''
    try {
      const value = await endpoints.venueSettings()
      if (run !== sequence || !isAuthSessionCurrent(owner) || !allowed.value) return
      if (preserveForm && data.value) { data.value = { ...data.value, courts: value.courts, courtCount: value.courtCount }; return }
      data.value = value
      form.value = { name: value.name, address: value.address, contactPhone: value.contactPhone, latitude: value.latitude == null ? '' : String(value.latitude), longitude: value.longitude == null ? '' : String(value.longitude), opensAtHour: value.opensAtHour ?? 7, closesAtHour: value.closesAtHour ?? 24 }
    } catch (cause: any) { if (run === sequence && isAuthSessionCurrent(owner)) error.value = cause.message || '设置加载失败，请重试' }
    finally { if (run === sequence) loading.value = false }
  }
  function validate() {
    const f = form.value
    if (f.name.trim().length < 2) return '球馆名称至少填写2个字'
    if (!Number.isInteger(f.opensAtHour) || !Number.isInteger(f.closesAtHour) || f.opensAtHour >= f.closesAtHour) return '营业时间按整点设置，结束须晚于开始'
    const lat = f.latitude.trim(), lon = f.longitude.trim()
    if (Boolean(lat) !== Boolean(lon)) return '经纬度需一起填写或一起清空'
    if (lat && (!Number.isFinite(Number(lat)) || !Number.isFinite(Number(lon)) || Math.abs(Number(lat)) > 90 || Math.abs(Number(lon)) > 180)) return '请输入有效经纬度'
    return ''
  }
  function confirmSave() { error.value = validate(); if (!error.value && data.value && allowed.value) confirmation.value = true }
  async function save() {
    if (saving.value || !data.value || !allowed.value) return
    error.value = validate(); if (error.value) return
    const owner = captureAuthSession(); saving.value = true
    try {
      const f = form.value
      await endpoints.saveVenueSettings({ ...f, name: f.name.trim(), address: f.address.trim(), contactPhone: f.contactPhone.trim(), latitude: f.latitude.trim() ? Number(f.latitude) : null, longitude: f.longitude.trim() ? Number(f.longitude) : null, revision: data.value.revision })
      if (!isAuthSessionCurrent(owner)) return
      confirmation.value = false; saving.value = false
      await load(); uni.showToast({ title: '球馆设置已保存', icon: 'success' })
    } catch (cause: any) { if (isAuthSessionCurrent(owner)) error.value = cause.message || '保存失败，请重试' }
    finally { saving.value = false }
  }
  function editCourt(value?: VenueCourt) {
    courtError.value = ''
    court.value = value ? { ...value } : { id: '', code: '', name: '', zone: 'EAST', usage: 'RETAIL', enabled: true, sortOrder: (data.value?.courts.length || 0) + 1 }
  }
  async function saveCourt() {
    if (!court.value || saving.value || !allowed.value) return
    const c = court.value
    courtError.value = !c.name.trim() ? '请填写场地名称' : !c.id && !/^[A-Z0-9][A-Z0-9_-]{0,31}$/.test(c.code.trim()) ? '编号请用大写字母、数字、下划线或横线' : !Number.isInteger(Number(c.sortOrder)) || Number(c.sortOrder) < 0 || Number(c.sortOrder) > 10000 ? '排序需为0至10000的整数' : ''
    if (courtError.value) return
    const owner = captureAuthSession(); saving.value = true
    try {
      const fields = { name: c.name.trim(), enabled: c.enabled, usage: c.usage, sortOrder: Number(c.sortOrder) }
      if (c.id) await endpoints.updateVenueCourt(c.id, fields)
      else await endpoints.createVenueCourt({ ...fields, code: c.code.trim(), zone: c.zone })
      if (!isAuthSessionCurrent(owner)) return
      court.value = null; saving.value = false
      await load(true); uni.showToast({ title: '场地已保存', icon: 'success' })
    } catch (cause: any) { if (isAuthSessionCurrent(owner)) courtError.value = cause.message || '保存失败，请重试' }
    finally { saving.value = false }
  }
  return { session, allowed, data, form, loading, saving, error, courtError, court, confirmation, load, confirmSave, save, editCourt, saveCourt }
}
