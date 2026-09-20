import { beforeEach, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { useEventLoadingActions } from './loading'
const api = vi.hoisted(() => ({ managedEvents:vi.fn(), managedEvent:vi.fn() }))
vi.mock('../../../../../services/api', () => ({ endpoints:api }))
beforeEach(() => { vi.clearAllMocks() })
it('an unavailable requested event never falls back to another event', async () => {
  const detail = ref<any>({ id:'old-event' }), selected = ref('missing-event'), error = ref('')
  const controller = useEventLoadingActions({ selectedEventId:selected, loading:ref(false), errorMessage:error,
    session:{ hydrate:async () => {} }, mayViewEvent:ref(true), eventList:ref([]), eventDetail:detail,
    prizeAwards:ref([]), inventoryItems:ref([]), causeMessage:(cause: Error) => cause.message,
  } as any)
  api.managedEvents.mockResolvedValue([{ id:'other-event', status:'OPEN' }])
  await expect(controller.load('missing-event')).rejects.toThrow('未找到该赛事')
  expect(detail.value).toBeNull(); expect(selected.value).toBe('missing-event')
  expect(api.managedEvent).not.toHaveBeenCalled()
  expect(controller.preferredEvent([{ id:'other-event', status:'OPEN' } as any])?.id).toBe('other-event')
})
