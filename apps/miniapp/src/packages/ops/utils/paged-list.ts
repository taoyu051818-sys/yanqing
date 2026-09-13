import { ref, watch, type Ref } from 'vue'
import { captureAuthSession, isAuthSessionCurrent, useAccessToken } from '../../../services/auth-session'

export type ListPage<T> = { items: T[]; total: number }
/** A filtered list owns its page sequence; stale pages never join a new query. */
export function usePagedList<T extends { id: string }>(fetchPage: (page: number, pageSize: number) => Promise<ListPage<T>>, pageSize = 20, queryKey: () => string = () => '') {
  const items = ref<T[]>([]) as Ref<T[]>
  const total = ref(0), page = ref(0), loading = ref(false), error = ref('')
  let generation = 0, loadedQueryKey = queryKey()
  watch(useAccessToken(), () => { generation++; items.value = []; total.value = 0; page.value = 0; loading.value = false; error.value = '' }, { flush: 'sync' })
  async function load(more = false) {
    if (more && loading.value) return
    if (more && loadedQueryKey !== queryKey()) more = false
    if (!more) loadedQueryKey = queryKey()
    const run = ++generation, owner = captureAuthSession(), nextPage = more ? page.value + 1 : 1
    const current = () => run === generation && isAuthSessionCurrent(owner)
    loading.value = true; error.value = ''
    if (!more) { items.value = []; total.value = 0; page.value = 0 }
    try {
      const result = await fetchPage(nextPage, pageSize)
      if (!current()) return
      items.value = [...new Map([...(more ? items.value : []), ...result.items].map(item => [item.id, item])).values()]
      total.value = result.total; page.value = nextPage
    } catch (cause: any) {
      if (current()) error.value = cause?.message || '列表同步失败，请重试'
      throw cause
    } finally { if (current()) loading.value = false }
  }
  const refresh = () => load().catch(() => undefined)
  const more = () => load(true).catch(() => undefined)
  return { items, total, page, loading, error, load, refresh, more }
}
