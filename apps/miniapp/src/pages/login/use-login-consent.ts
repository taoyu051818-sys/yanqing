import { ref } from 'vue'

/** One explicit consent and one cancellable attempt per visit. Never persist a checked box. */
export function useLoginConsent(logout: () => void, finish: () => void, leave: () => void) {
  const agreed = ref(false)
  const error = ref('')
  const pending = ref(false)
  let generation = 0

  async function login(authorize: () => Promise<unknown>) {
    if (pending.value) return
    error.value = ''
    if (!agreed.value) {
      error.value = '请先阅读并自主勾选同意协议，也可以选择暂不登录。'
      return
    }
    const attempt = ++generation
    pending.value = true
    try {
      await authorize()
      if (attempt !== generation) return
      pending.value = false
      finish()
    } catch (cause: any) {
      if (attempt === generation) error.value = cause?.message || '登录未完成，请重试或继续浏览。'
    } finally {
      if (attempt === generation) pending.value = false
    }
  }
  function abandon() {
    generation++
    if (pending.value) {
      pending.value = false
      // The store also invalidates requests that have not saved their token yet.
      logout()
    }
  }
  function cancel() {
    abandon()
    leave()
  }
  return { agreed, error, pending, login, cancel, abandon }
}
