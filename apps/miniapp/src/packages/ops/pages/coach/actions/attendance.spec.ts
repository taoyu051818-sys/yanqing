import { expect, it, vi } from 'vitest'
import { computed, ref } from 'vue'
import { useCoachAttendanceActions } from './attendance'
const { scheduleTrainingMakeup } = vi.hoisted(() => ({ scheduleTrainingMakeup: vi.fn(async () => ({})) }))
vi.mock('../../../../../services/api', () => ({ endpoints: { scheduleTrainingMakeup } }))
function setup(enrollments: any[], lessons: any[]) {
  let task: any
  const load = vi.fn(async () => {})
  const actions = useCoachAttendanceActions({ activeStudents: computed(() => enrollments.filter(e => e.status === 'ACTIVE')), enrollments: ref(enrollments), lessons: ref(lessons), session: { roles: ['COACH'], user: { id: 'coach' } }, task: { start: (value: unknown) => { task = value } }, load, errorMessage: ref('') } as any)
  return { actions, load, task: () => task }
}
it('retains completed enrollment history without treating it as a new attendance candidate', () => {
  const enrollment = { id: 'enrollment', classId: 'class', status: 'COMPLETED', attendances: [{ id: 'attendance', sessionId: 'past', status: 'ATTENDED', consumedSessions: 1 }] }
  const { actions } = setup([enrollment], [])
  expect(actions.studentsFor({ id: 'past', classId: 'class', status: 'COMPLETED' } as any)).toEqual([enrollment])
  expect(actions.studentsFor({ id: 'future', classId: 'class', status: 'SCHEDULED' } as any)).toEqual([])
})
it('offers only a later scheduled lesson in the same class with available target attendance', async () => {
  const source = { id: 'source', classId: 'class', status: 'SCHEDULED', startsAt: '2026-10-01T08:00:00Z' }
  const target = { id: 'target', classId: 'class', status: 'SCHEDULED', startsAt: '2026-10-02T08:00:00Z' }
  const enrollment = { id: 'enrollment', classId: 'class', status: 'ACTIVE', attendances: [{ sessionId: 'source', status: 'MAKEUP_REQUIRED' }, { sessionId: 'target', status: 'PENDING' }] }
  const { actions, task, load } = setup([enrollment], [source, target, { ...target, id: 'other', classId: 'other' }, { ...target, id: 'ended', status: 'COMPLETED' }])
  actions.scheduleMakeup(source as any, enrollment as any)
  expect(task().fields[0].options.map((option: any) => option.value)).toEqual(['target'])
  await task().submit({ makeupSessionId: 'target', reason: '协商后补课' })
  expect(scheduleTrainingMakeup).toHaveBeenCalledWith('source', { enrollmentId: 'enrollment', makeupSessionId: 'target', reason: '协商后补课' }); expect(load).toHaveBeenCalled()
})
