import { computed, onScopeDispose, ref, watch } from 'vue'
import { VenueErrorCode } from '@yanqing/shared'
import { endpoints } from '../../../../services/api'
import { captureAuthSession, isAuthSessionCurrent } from '../../../../services/auth-session'
import { useSessionStore } from '../../../../stores/session'
import type { VenueCourt, VenueSettings } from '../../../../types/venue-settings'
import { useSettingsMutation, type LoadResult, type MutationResult } from './use-mutation'
export const hourLabel = (n: number) => `${String(n).padStart(2, '0')}:00`
export const usages = [{ value: 'RETAIL', label: '普通订场' }, { value: 'MEMBER_BLOCK', label: '会员预留' }, { value: 'TRAINING', label: '培训专用' }, { value: 'MAINTENANCE', label: '维护中' }] as const
const message = (cause: unknown, fallback: string) => cause instanceof Error ? cause.message : fallback
const formFrom = (value: VenueSettings) => ({
  name: value.name, address: value.address, contactPhone: value.contactPhone,
  latitude: value.latitude == null ? '' : String(value.latitude),
  longitude: value.longitude == null ? '' : String(value.longitude),
  opensAtHour: value.opensAtHour ?? 7, closesAtHour: value.closesAtHour ?? 24,
})
export function useVenueSettings() {
  const session = useSessionStore()
  const allowed = computed(() => session.roles.some(role => role === 'ADMIN' || role === 'SUPER_ADMIN'))
  const loading = ref(false), error = ref(''), courtError = ref(''), courtConflict = ref(false)
  const data = ref<VenueSettings | null>(null)
  const form = ref({ name: '', address: '', contactPhone: '', latitude: '', longitude: '', opensAtHour: 7, closesAtHour: 24 })
  const confirmation = ref(false), court = ref<VenueCourt | null>(null), deletingCourt = ref<VenueCourt | null>(null)
  let sequence = 0, alive = true
  const mutation = useSettingsMutation(() => allowed.value, () => { sequence++; loading.value = false })
  const { saving } = mutation
  onScopeDispose(() => { alive = false; sequence++ })
  function clear() {
    sequence++; mutation.invalidate(); loading.value = false
    data.value = null; court.value = null; deletingCourt.value = null; confirmation.value = false
    error.value = ''; courtError.value = ''; courtConflict.value = false
  }
  watch(() => session.user?.id, clear)
  watch(allowed, value => { if (!value) clear() })

  async function fetchSettings(preserveForm: boolean): Promise<LoadResult> {
    if (!alive || !allowed.value) return 'inactive'
    const run = ++sequence, owner = captureAuthSession()
    const current = () => alive && run === sequence && allowed.value && isAuthSessionCurrent(owner)
    loading.value = true; error.value = ''
    try {
      const value = await endpoints.venueSettings()
      if (!current()) return 'inactive'
      if (preserveForm && data.value) data.value = { ...data.value, courts: value.courts, courtCount: value.courtCount }
      else { data.value = value; form.value = formFrom(value) }
      return 'loaded'
    } catch (cause) {
      if (!current()) return 'inactive'
      error.value = message(cause, '设置加载失败，请重试'); return 'failed'
    } finally { if (alive && run === sequence) loading.value = false }
  }
  function load(preserveForm = false): Promise<LoadResult> {
    return saving.value ? Promise.resolve('busy') : fetchSettings(preserveForm)
  }
  function resetForm() { if (data.value) form.value = formFrom(data.value); error.value = '' }
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
  const refreshFailed = () => { error.value = '操作已保存，但页面刷新失败，请重新加载后继续。' }
  async function save(): Promise<MutationResult> {
    if (!data.value) return 'inactive'
    if (saving.value || loading.value) return 'busy'
    error.value = validate(); if (error.value) return 'failed'
    const f = { ...form.value }
    const command = { ...f, name: f.name.trim(), address: f.address.trim(), contactPhone: f.contactPhone.trim(), latitude: f.latitude.trim() ? Number(f.latitude) : null, longitude: f.longitude.trim() ? Number(f.longitude) : null, revision: data.value.revision }
    return mutation.run({
      write: () => endpoints.saveVenueSettings(command),
      committed: () => { confirmation.value = false; data.value = null },
      refresh: () => fetchSettings(false),
      failed: cause => { error.value = message(cause, '保存失败，请重试') },
      refreshFailed, successMessage: '球馆设置已保存',
    })
  }
  function editCourt(value?: VenueCourt) {
    if (saving.value || loading.value) return
    courtError.value = ''; courtConflict.value = false
    court.value = value ? { ...value } : { id: '', updatedAt: '', code: '', name: '', zone: 'EAST', usage: 'RETAIL', enabled: true, sortOrder: (data.value?.courts.length || 0) + 1 }
  }
  async function reloadCourt() {
    if (!court.value?.id || saving.value || loading.value) return
    const draft = court.value
    const result = await load(true)
    if (result === 'inactive' || court.value !== draft) return
    if (result !== 'loaded') { courtError.value = error.value; return }
    const latest = data.value?.courts.find(item => item.id === draft.id)
    if (latest) editCourt(latest)
    else { court.value = null; error.value = '场地不存在或已删除' }
  }
  async function saveCourt(): Promise<MutationResult> {
    if (!court.value) return 'inactive'
    if (saving.value || loading.value) return 'busy'
    if (courtConflict.value) return 'failed'
    const c = { ...court.value }
    courtError.value = !c.name.trim() ? '请填写场地名称' : !/^[A-Z0-9][A-Z0-9_-]{0,31}$/.test(c.code.trim()) ? '编号请用大写字母、数字、下划线或横线' : !Number.isInteger(Number(c.sortOrder)) || Number(c.sortOrder) < 0 || Number(c.sortOrder) > 10000 ? '排序需为0至10000的整数' : ''
    if (courtError.value) return 'failed'
    const fields = { code: c.code.trim(), zone: c.zone, name: c.name.trim(), enabled: c.enabled, usage: c.usage, sortOrder: Number(c.sortOrder) }
    return mutation.run({
      write: () => c.id ? endpoints.updateVenueCourt(c.id, { ...fields, revision: c.updatedAt }) : endpoints.createVenueCourt(fields),
      committed: () => { court.value = null; data.value = null },
      refresh: () => fetchSettings(false),
      failed: cause => {
        courtError.value = message(cause, '保存失败，请重试')
        courtConflict.value = !!cause && typeof cause === 'object' && 'businessCode' in cause && cause.businessCode === VenueErrorCode.COURT_REVISION_CONFLICT
      },
      refreshFailed, successMessage: '场地已保存',
    })
  }
  function confirmDeleteCourt(value: VenueCourt) {
    if (saving.value || loading.value) return
    courtError.value = ''; deletingCourt.value = value
  }
  async function deleteCourt(): Promise<MutationResult> {
    if (!deletingCourt.value) return 'inactive'
    if (saving.value || loading.value) return 'busy'
    const id = deletingCourt.value.id
    courtError.value = ''
    return mutation.run({
      write: () => endpoints.deleteVenueCourt(id),
      committed: () => { deletingCourt.value = null; data.value = null },
      refresh: () => fetchSettings(false),
      failed: cause => { courtError.value = message(cause, '删除失败，请重试') },
      refreshFailed, successMessage: '场地已删除',
    })
  }
  return { session, allowed, data, form, loading, saving, error, courtError, courtConflict, court, confirmation, load, resetForm, confirmSave, save, editCourt, reloadCourt, saveCourt, deletingCourt, confirmDeleteCourt, deleteCourt }
}
