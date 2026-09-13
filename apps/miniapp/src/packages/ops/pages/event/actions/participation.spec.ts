import { expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { useEventParticipationActions } from './participation'
const { checkInEventTeam } = vi.hoisted(() => ({ checkInEventTeam: vi.fn(async () => ({})) }))
vi.mock('../../../../../services/api', () => ({ endpoints: { checkInEventTeam } }))
it.each([-45, 45])('lets the server evaluate its configured60 minute window at offset %s', async offset => {
  const start = Date.now() - offset * 60000; let task: any
  const actions = useEventParticipationActions({ eventDetail: ref({ id: 'event', status: 'OPEN', startsAt: new Date(start).toISOString() }), currentRound: ref(0), hasAnyRole: () => true, SCORE_ROLES: ['EVENT_MANAGER'], task: { start: (value: unknown) => { task = value } }, errorMessage: ref(''), load: vi.fn() } as any)
  actions.checkIn({ id: 'team', status: 'PAID', name: '队伍', playerAName: '甲', playerBName: '乙' } as any)
  expect(task).toBeDefined(); await task.submit({})
  expect(checkInEventTeam).toHaveBeenLastCalledWith('event', 'team', {})
})
