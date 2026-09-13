import { beforeEach, expect, it, vi } from 'vitest'
import { usePagedList } from './paged-list'
import { deferred } from '../../../test-utils/sfc-script'
import { saveAuthSession } from '../../../services/auth-session'
const storage = new Map<string, unknown>()
beforeEach(() => { storage.clear(); vi.stubGlobal('uni', { getStorageSync: (key: string) => storage.get(key) || '', setStorageSync: (key: string, value: unknown) => storage.set(key, value), removeStorageSync: (key: string) => storage.delete(key) }); saveAuthSession('a', 'a') })
it('loads the21st record and retains the server total across pages', async () => {
  const fetch = vi.fn(async (page: number) => ({ items: Array.from({ length: page === 1 ? 20 : 1 }, (_, index) => ({ id: String((page - 1) * 20 + index) })), total: 21 }))
  const list = usePagedList(fetch); await list.load(); expect(list.total.value).toBe(21); await list.load(true)
  expect(list.items.value).toHaveLength(21); expect(fetch).toHaveBeenLastCalledWith(2, 20)
})
it('does not append an old second page into a refreshed query', async () => {
  const late = deferred<{ items: { id: string }[]; total: number }>()
  const fetch = vi.fn().mockResolvedValueOnce({ items: [{ id: 'first' }], total: 2 }).mockReturnValueOnce(late.promise).mockResolvedValueOnce({ items: [{ id: 'new-query' }], total: 1 })
  const list = usePagedList(fetch); await list.load(); const pending = list.load(true); await list.load(); late.resolve({ items: [{ id: 'old-second' }], total: 2 }); await pending
  expect(list.items.value).toEqual([{ id: 'new-query' }]); expect(list.total.value).toBe(1)
})
it('starts at page one when a filter was edited before pressing load more', async () => {
  let keyword = 'old'
  const fetch = vi.fn(async () => ({ items: [{ id: keyword }], total: 21 }))
  const list = usePagedList(fetch, 20, () => keyword); await list.load(); keyword = 'new'; await list.more()
  expect(fetch).toHaveBeenLastCalledWith(1, 20); expect(list.items.value).toEqual([{ id: 'new' }])
})
