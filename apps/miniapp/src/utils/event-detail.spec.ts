import { describe, expect, it } from 'vitest'
import { eventDetailPath, eventShareTitle, eventSignupOpen, parseEventId } from './event-detail'
const event = { id: 'event-1', name: '周末积分赛', status: 'OPEN', startsAt: '2099-01-01T10:00:00+08:00', registrationEndsAt: '2099-01-01T09:00:00+08:00' }
describe('event share journey', () => {
  it('shares a specific public detail instead of a signup form or partner invitation', () => {
    expect(eventDetailPath(event.id, true)).toBe('/pages/event-detail/index?id=event-1&from=share')
    expect(eventShareTitle(event)).toContain('邀你参加')
    expect(eventDetailPath(event.id, true)).not.toMatch(/invite=|token=|orderId=/)
  })
  it('rejects malformed shared event ids', () => {
    for (const id of ['../event', 'event&invite=x', '%2f', ['event-1'], '', 'x'.repeat(129)]) expect(parseEventId(id)).toBe('')
  })
  it('keeps results shareable after registration closes', () => {
    expect(eventShareTitle({ ...event, status: 'COMPLETED', standings: [{ name: '冠军队', finalRank: 1 }] })).toContain('冠军队夺冠')
    expect(eventShareTitle({ ...event, status: 'CANCELLED' })).not.toContain('邀你参加')
  })
  it('allows open and full events only before both deadlines', () => {
    expect(eventSignupOpen(event)).toBe(true)
    expect(eventSignupOpen({ ...event, status: 'FULL' })).toBe(true)
    for (const status of ['COMPLETED', 'CANCELLED', 'DRAFT', 'IN_PROGRESS']) expect(eventSignupOpen({ ...event, status })).toBe(false)
    expect(eventSignupOpen(event, new Date(event.registrationEndsAt).getTime())).toBe(false)
    expect(eventSignupOpen({ ...event, startsAt: '2000-01-01' })).toBe(false)
  })
})
