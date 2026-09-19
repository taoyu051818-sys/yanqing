import { onScopeDispose, ref } from 'vue'
import { captureAuthSession, isAuthSessionCurrent } from '../../../../services/auth-session'

export type LoadResult = 'loaded' | 'failed' | 'inactive' | 'busy'
export type MutationResult = 'saved' | 'saved-refresh-failed' | 'failed' | 'inactive' | 'busy'
export const mutationCommitted = (result: MutationResult) => result === 'saved' || result === 'saved-refresh-failed'

/** A page-owned mutation stays busy until its refresh finishes. */
export function useSettingsMutation(allowed: () => boolean, beforeStart: () => void) {
  const saving = ref(false)
  let generation = 0, alive = true
  function invalidate() { generation++; saving.value = false }
  onScopeDispose(() => { alive = false; invalidate() })
  async function run(options: {
    write: () => Promise<unknown>
    committed: () => void
    refresh: () => Promise<LoadResult>
    failed: (error: unknown) => void
    refreshFailed: () => void
    successMessage: string
  }): Promise<MutationResult> {
    if (!alive || !allowed()) return 'inactive'
    if (saving.value) return 'busy'
    const id = ++generation, owner = captureAuthSession()
    const owns = () => alive && id === generation
    const current = () => owns() && allowed() && isAuthSessionCurrent(owner)
    saving.value = true; beforeStart()
    try {
      try { await options.write() }
      catch (error) {
        if (!current()) return 'inactive'
        options.failed(error); return 'failed'
      }
      if (!current()) return 'inactive'
      options.committed()
      // Persistence has succeeded. A failed refresh must never be reported as
      // a failed write, or encourage duplicate submissions.
      let refreshed: LoadResult
      try { refreshed = await options.refresh() }
      catch { refreshed = 'failed' }
      if (!current() || refreshed === 'inactive') return 'inactive'
      if (refreshed !== 'loaded') { options.refreshFailed(); return 'saved-refresh-failed' }
      uni.showToast({ title: options.successMessage, icon: 'success' })
      return 'saved'
    } finally {
      if (owns()) saving.value = false
    }
  }
  return { saving, run, invalidate }
}
