import type { MemberLevel } from '../generated/prisma/enums.js'

/** Evaluate eligibility when the price is agreed, rather than using a stale tier. */
export function membershipEligibility(
  profile: { level: MemberLevel; membershipExpiresAt: Date | null } | null,
  at = new Date(),
) {
  const expiry = profile?.membershipExpiresAt
  const premium = Boolean(profile && ['GOLD', 'BLACK'].includes(profile.level))
  const active = Boolean(expiry && Number.isFinite(+expiry) && +expiry > +at)
  return {
    eligible: premium && active,
    level: profile?.level ?? null,
    expiresAt: expiry && Number.isFinite(+expiry) ? expiry.toISOString() : null,
    evaluatedAt: at.toISOString(),
    reason: !premium
      ? 'NOT_PREMIUM'
      : !expiry
        ? 'NO_VALIDITY'
        : !active
          ? 'EXPIRED'
          : 'ACTIVE',
  }
}
