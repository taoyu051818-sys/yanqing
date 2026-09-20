import { computed, onUnmounted, ref, watch } from 'vue'
import { onBackPress, onHide, onShow } from '@dcloudio/uni-app'

/** Protect a page-owned form; completed saves explicitly establish a new baseline. */
export function useUnsavedForm(snapshot: () => unknown, enabled: () => boolean = () => true) {
  const baseline = ref(JSON.stringify(snapshot()))
  const dirty = computed(() => enabled() && JSON.stringify(snapshot()) !== baseline.value)
  let visible = true, leaving = false, confirming = false
  const markSaved = () => { baseline.value = JSON.stringify(snapshot()) }
  watch(enabled, () => markSaved(), { flush:'sync' })
  function updateNativeGuard() {
    // #ifdef MP-WEIXIN
    if (visible && dirty.value) uni.enableAlertBeforeUnload?.({ message:'还有未保存的内容，离开后将丢失。' })
    else uni.disableAlertBeforeUnload?.({})
    // #endif
  }
  watch(dirty, updateNativeGuard)
  onShow(() => { visible = true; updateNativeGuard() })
  onHide(() => { visible = false; updateNativeGuard() })
  onBackPress(() => {
    if (!dirty.value || leaving) return false
    if (!confirming) {
      confirming = true
      void uni.showModal({ title:'放弃修改？', content:'已填写的内容尚未保存。', confirmText:'放弃修改', cancelText:'继续编辑' }).then(result => {
        if (result.confirm) { leaving = true; uni.navigateBack({ fail:() => { leaving = false } }) }
      }).catch(() => {}).finally(() => { confirming = false })
    }
    return true
  })
  // #ifdef H5
  function beforeUnload(event: BeforeUnloadEvent) { if (dirty.value) { event.preventDefault(); event.returnValue = '' } }
  if (typeof window !== 'undefined') window.addEventListener('beforeunload', beforeUnload)
  // #endif
  onUnmounted(() => {
    visible = false; updateNativeGuard()
    // #ifdef H5
    if (typeof window !== 'undefined') window.removeEventListener('beforeunload', beforeUnload)
    // #endif
  })
  return { dirty, markSaved }
}
