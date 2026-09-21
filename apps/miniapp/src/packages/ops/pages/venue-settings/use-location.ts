import { computed, onScopeDispose, ref, type Ref } from 'vue'
import { captureAuthSession, isAuthSessionCurrent } from '../../../../services/auth-session'

import { locationFailure } from './location-error'

type LocationDraft = { address: string; latitude: string; longitude: string }

export function useVenueLocation(form: Ref<LocationDraft>, canEdit: () => boolean) {
  const choosing = ref(false),
    locationMessage = ref('')
  const needsLocationSettings = ref(false),
    privacyVisible = ref(false)
  const privacyContractName = ref('《用户隐私保护指引》')
  let resumeAfterPrivacy: (() => void) | undefined
  const hasLocation = computed(() => form.value.latitude !== '' && form.value.longitude !== '')
  let sequence = 0
  function resetLocationRequest() {
    sequence++
    choosing.value = false
    locationMessage.value = ''
    needsLocationSettings.value = false
    privacyVisible.value = false
    resumeAfterPrivacy = undefined
  }
  onScopeDispose(resetLocationRequest)

  function useTextAddress() {
    if (!canEdit() || choosing.value || privacyVisible.value) return
    form.value.latitude = ''
    form.value.longitude = ''
    locationMessage.value = ''
    needsLocationSettings.value = false
  }
  function changeAddress(address: string) {
    if (!canEdit() || choosing.value || privacyVisible.value || address === form.value.address) return
    const hadLocation = hasLocation.value
    form.value.address = address
    useTextAddress()
    if (hadLocation) locationMessage.value = '地址已修改，原定位已清除。需要导航时请重新选点。'
  }
  function chooseLocation() {
    if (!canEdit() || choosing.value || privacyVisible.value) return
    locationMessage.value = ''
    needsLocationSettings.value = false
    // uni-app substitutes process.env.UNI_PLATFORM in each target build.
    // The H5 acceptance build has no map key; don't open an unusable web map.
    if (process.env.UNI_PLATFORM !== 'mp-weixin') {
      locationMessage.value = '请在微信小程序中使用地图选点，也可以直接填写文字地址。'
      return
    }
    const run = ++sequence,
      owner = captureAuthSession()
    const current = () => run === sequence && canEdit() && isAuthSessionCurrent(owner)
    const finish = () => {
      if (run === sequence) choosing.value = false
    }
    function failed(cause?: { errMsg?: string }) {
      if (current()) {
        const failure = locationFailure(cause)
        locationMessage.value = failure.message
        needsLocationSettings.value = failure.settings
      }
      finish()
    }
    function openMap() {
      if (!current()) {
        finish()
        return
      }
      choosing.value = true
      try {
        uni.chooseLocation({
          ...(hasLocation.value
            ? { latitude: Number(form.value.latitude), longitude: Number(form.value.longitude) }
            : {}),
          success(result) {
            if (!current()) return
            const { latitude, longitude } = result
            if (
              !Number.isFinite(latitude) ||
              !Number.isFinite(longitude) ||
              Math.abs(latitude) > 90 ||
              Math.abs(longitude) > 180
            ) {
              locationMessage.value = '未获取到有效位置，请重新选点或填写文字地址。'
              return
            }
            const address = result.address?.trim() || '',
              name = result.name?.trim() || ''
            const label = address && name && !address.includes(name) ? `${address} ${name}` : address || name
            if (!label) {
              locationMessage.value = '所选位置没有地址，请重新选点或填写文字地址。'
              return
            }
            form.value.address = label.slice(0, 300)
            form.value.latitude = String(latitude)
            form.value.longitude = String(longitude)
          },
          fail(cause) {
            failed(cause)
          },
          complete: finish,
        })
      } catch (cause) {
        failed(cause as { errMsg?: string })
      }
    }
    function checkPrivacy(afterAgreement = false) {
      if (!current()) {
        finish()
        return
      }
      choosing.value = true
      // Older WeChat versions predate this API and use native authorization.
      if (typeof uni.getPrivacySetting !== 'function') {
        openMap()
        return
      }
      try {
        uni.getPrivacySetting({
          success(result) {
            if (!current()) {
              finish()
              return
            }
            if (!result.needAuthorization) {
              openMap()
              return
            }
            finish()
            if (afterAgreement) {
              locationMessage.value = '尚未完成隐私授权，可重新点击地图选点，也可以填写文字地址。'
              return
            }
            privacyContractName.value = result.privacyContractName || '《用户隐私保护指引》'
            resumeAfterPrivacy = () => checkPrivacy(true)
            privacyVisible.value = true
          },
          fail: failed,
        })
      } catch (cause) {
        failed(cause as { errMsg?: string })
      }
    }
    checkPrivacy()
  }
  function declinePrivacy() {
    resetLocationRequest()
    locationMessage.value = '已取消地图选点，可继续填写文字地址。'
  }
  function agreePrivacy() {
    if (!privacyVisible.value) return
    const resume = resumeAfterPrivacy
    privacyVisible.value = false
    resumeAfterPrivacy = undefined
    resume?.()
  }
  function openLocationSettings() {
    if (!canEdit() || choosing.value || !needsLocationSettings.value) return
    const run = ++sequence,
      owner = captureAuthSession()
    const current = () => run === sequence && canEdit() && isAuthSessionCurrent(owner)
    choosing.value = true
    const finish = () => {
      if (run === sequence) choosing.value = false
    }
    try {
      uni.openSetting({
        success(result) {
          if (!current()) return
          needsLocationSettings.value = !result.authSetting['scope.userLocation']
          locationMessage.value = needsLocationSettings.value
            ? '尚未允许位置授权，可继续填写文字地址。'
            : '位置授权已开启，请点击地图选点。'
        },
        fail() {
          if (current())
            locationMessage.value = '授权设置暂时无法打开，可从小程序右上角“…”进入设置，或直接填写文字地址。'
        },
        complete: finish,
      })
    } catch {
      if (current()) locationMessage.value = '授权设置暂时无法打开，可直接填写文字地址。'
      finish()
    }
  }
  return {
    choosing,
    hasLocation,
    locationMessage,
    needsLocationSettings,
    privacyVisible,
    privacyContractName,
    agreePrivacy,
    declinePrivacy,
    openLocationSettings,
    chooseLocation,
    useTextAddress,
    changeAddress,
    resetLocationRequest,
  }
}
