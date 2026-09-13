import { SHARE_CARD_IMAGES } from '../config/share'

const PENDING_INVITE_KEY = 'yanqing_pending_referral_invite'
const LEGACY_REFERRER_KEY = 'yanqing_pending_referrer_id'
const MIN_INVITE_CODE_LENGTH = 20
const MAX_INVITE_CODE_LENGTH = 128
const INVITE_CODE_PATTERN = /^[A-Za-z0-9_-]+$/

export type ReferralLaunchOptions = {
  path?: string
  query?: Record<string, unknown>
  scene?: unknown
}

const normalizedInviteCode = (value: unknown): string | null => {
  if (typeof value !== 'string') return null
  const normalized = value.trim()
  if (
    normalized.length < MIN_INVITE_CODE_LENGTH ||
    normalized.length > MAX_INVITE_CODE_LENGTH ||
    !INVITE_CODE_PATTERN.test(normalized)
  ) return null
  return normalized
}

// Dedicated referral parameters avoid collisions with event partner invitations.
const legacyReferralCode = (value: unknown) => {
  const code = normalizedInviteCode(value)
  // Current referral tokens are32 chars; EP partner tokens are27/35 chars.
  return code?.startsWith('EP_') && code.length !== 32 ? null : code
}
const inviteFromScene = (scene: unknown): string | null => {
  if (typeof scene !== 'string' || !scene) return null
  let decoded = scene
  try { decoded = decodeURIComponent(scene) } catch { return null }
  const match = decoded.match(/(?:^|[?&])(referralInvite|invite)=([^&]+)/)
  if (!match) return null
  try {
    const value = decodeURIComponent(match[2])
    return match[1] === 'referralInvite' ? normalizedInviteCode(value) : legacyReferralCode(value)
  } catch { return null }
}

export const referralInviteFromLaunchOptions = (options?: ReferralLaunchOptions): string | null => {
  const explicit = normalizedInviteCode(options?.query?.referralInvite)
  if (explicit) return explicit
  if (String(options?.path || '').replace(/^\//, '') === 'pages/event-signup/index') return null
  return legacyReferralCode(options?.query?.invite)
    ?? inviteFromScene(options?.query?.scene ?? options?.scene)
}

export const captureReferralAttribution = (
  options?: ReferralLaunchOptions,
): string | null => {
  // Remove the old raw-id cache during upgrade so a newer client can never
  // submit it as though it were an opaque invitation.
  uni.removeStorageSync(LEGACY_REFERRER_KEY)
  const inviteCode = referralInviteFromLaunchOptions(options)
  if (inviteCode) uni.setStorageSync(PENDING_INVITE_KEY, inviteCode)
  return inviteCode
}

export const pendingReferralInvite = (): string | null =>
  normalizedInviteCode(uni.getStorageSync(PENDING_INVITE_KEY))

export const clearPendingReferral = (expectedInvite?: string) => {
  if (expectedInvite && pendingReferralInvite() !== expectedInvite) return
  uni.removeStorageSync(PENDING_INVITE_KEY)
  uni.removeStorageSync(LEGACY_REFERRER_KEY)
}

export const referralShareQuery = (inviteCode: string) =>
  `referralInvite=${encodeURIComponent(inviteCode)}`

export const referralSharePath = (inviteCode: string) =>
  `/pages/home/index?${referralShareQuery(inviteCode)}`

export const referralSharePayload = (
  inviteCode: string,
  displayName?: string,
) => ({
  title: `${displayName || '好友'}邀请你使用延庆金羽小程序`,
  path: referralSharePath(inviteCode),
  imageUrl: SHARE_CARD_IMAGES.miniapp,
})
