import { computed, onScopeDispose, ref, type Ref } from 'vue'
import { captureAuthSession, isAuthSessionCurrent } from '../../../../services/auth-session'

type LocationDraft = { address: string; latitude: string; longitude: string }

export function useVenueLocation(form: Ref<LocationDraft>, canEdit: () => boolean) {
  const choosing = ref(false), locationMessage = ref('')
  const hasLocation = computed(() => form.value.latitude !== '' && form.value.longitude !== '')
  let sequence = 0
  function resetLocationRequest() { sequence++; choosing.value = false; locationMessage.value = '' }
  onScopeDispose(resetLocationRequest)

  function useTextAddress() {
    if (!canEdit() || choosing.value) return
    form.value.latitude = ''; form.value.longitude = ''; locationMessage.value = ''
  }
  function changeAddress(address: string) {
    if (!canEdit() || choosing.value || address === form.value.address) return
    const hadLocation = hasLocation.value
    form.value.address = address
    useTextAddress()
    if (hadLocation) locationMessage.value = '地址已修改，原定位已清除。需要导航时请重新选点。'
  }
  function chooseLocation() {
    if (!canEdit() || choosing.value) return
    locationMessage.value = ''
    // uni-app substitutes process.env.UNI_PLATFORM in each target build.
    // The H5 acceptance build has no map key; don't open an unusable web map.
    if (process.env.UNI_PLATFORM !== 'mp-weixin') {
      locationMessage.value = '请在微信小程序中使用地图选点，也可以直接填写文字地址。'
      return
    }
    const run = ++sequence, owner = captureAuthSession()
    const current = () => run === sequence && canEdit() && isAuthSessionCurrent(owner)
    choosing.value = true
    try {
      uni.chooseLocation({
        ...(hasLocation.value ? { latitude: Number(form.value.latitude), longitude: Number(form.value.longitude) } : {}),
        success(result) {
          if (!current()) return
          const { latitude, longitude } = result
          if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
            locationMessage.value = '未获取到有效位置，请重新选点或填写文字地址。'; return
          }
          const address = result.address?.trim() || '', name = result.name?.trim() || ''
          const label = address && name && !address.includes(name) ? `${address} ${name}` : address || name
          if (!label) { locationMessage.value = '所选位置没有地址，请重新选点或填写文字地址。'; return }
          form.value.address = label.slice(0, 300)
          form.value.latitude = String(latitude); form.value.longitude = String(longitude)
        },
        fail(cause) {
          if (current() && !/cancel/i.test(cause.errMsg || '')) locationMessage.value = '地图暂时无法打开或未获授权，可直接填写文字地址。'
        },
        complete() { if (run === sequence) choosing.value = false },
      })
    } catch {
      if (current()) locationMessage.value = '地图暂时无法打开，可直接填写文字地址。'
      if (run === sequence) choosing.value = false
    }
  }
  return { choosing, hasLocation, locationMessage, chooseLocation, useTextAddress, changeAddress, resetLocationRequest }
}
