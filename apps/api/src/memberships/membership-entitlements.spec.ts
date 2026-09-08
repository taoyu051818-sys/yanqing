import { describe, expect, it } from 'vitest';
import { projectMembershipEntitlement } from './membership-entitlements.js';
import type { MemberLevel } from '../generated/prisma/enums.js';

const day = 86400000,
  now = new Date('2026-09-08T00:00:00Z');
const interval = (level: MemberLevel, start: number, end: number) => ({
  startsAt: new Date(+now + start * day),
  endsAt: new Date(+now + end * day),
  product: { level },
});
describe('membership entitlement projection', () => {
  it('projects contiguous same-tier renewals through their combined expiry', () => {
    expect(
      projectMembershipEntitlement(
        [interval('GOLD', 10, 40), interval('GOLD', -10, 10)],
        now,
      ),
    ).toEqual({
      level: 'GOLD',
      membershipExpiresAt: new Date(+now + 40 * day),
    });
  });
  it('does not grant a future interval across a gap', () => {
    expect(
      projectMembershipEntitlement(
        [interval('GOLD', -10, 10), interval('GOLD', 11, 41)],
        now,
      ).membershipExpiresAt,
    ).toEqual(new Date(+now + 10 * day));
  });
  it('does not extend BLACK with the later expiry of an overlapping GOLD', () => {
    expect(
      projectMembershipEntitlement(
        [interval('BLACK', -10, 10), interval('GOLD', -10, 100)],
        now,
      ),
    ).toEqual({
      level: 'BLACK',
      membershipExpiresAt: new Date(+now + 10 * day),
    });
  });
  it('falls back to the remaining tier at the higher tier expiry boundary', () => {
    expect(
      projectMembershipEntitlement(
        [interval('BLACK', -10, 10), interval('GOLD', -10, 100)],
        new Date(+now + 10 * day),
      ),
    ).toEqual({
      level: 'GOLD',
      membershipExpiresAt: new Date(+now + 100 * day),
    });
  });
  it('does not activate a future tier early', () => {
    expect(
      projectMembershipEntitlement([interval('GOLD', 1, 31)], now),
    ).toEqual({ level: 'EXPERIENCE', membershipExpiresAt: null });
  });
  it('clears the expiry when no valid subscriptions remain', () => {
    expect(
      projectMembershipEntitlement([interval('GOLD', -30, 0)], now),
    ).toEqual({ level: 'EXPERIENCE', membershipExpiresAt: null });
  });
});
