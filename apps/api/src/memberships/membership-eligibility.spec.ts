import { describe, expect, it } from 'vitest'
import { membershipEligibility } from './membership-eligibility.js'
const now = new Date('2026-09-08T12:00:00+08:00')
describe('event membership eligibility', () => {
  it.each(['GOLD', 'BLACK'] as const)(
    'accepts an unexpired %s membership',
    (level) => {
      expect(
        membershipEligibility(
          { level, membershipExpiresAt: new Date(+now + 1) },
          now,
        ),
      ).toMatchObject({ eligible: true, reason: 'ACTIVE' })
    },
  )
  it.each([null, new Date(+now - 1), now, new Date('invalid')])(
    'rejects missing, expired and invalid validity',
    (membershipExpiresAt) => {
      expect(
        membershipEligibility({ level: 'GOLD', membershipExpiresAt }, now)
          .eligible,
      ).toBe(false)
    },
  )
  it.each(['EXPERIENCE', 'REGULAR'] as const)(
    'does not give premium pricing to %s',
    (level) => {
      expect(
        membershipEligibility(
          { level, membershipExpiresAt: new Date(+now + 1000) },
          now,
        ).eligible,
      ).toBe(false)
    },
  )
  it('handles a missing profile', () => {
    expect(membershipEligibility(null, now).eligible).toBe(false)
  })
})
