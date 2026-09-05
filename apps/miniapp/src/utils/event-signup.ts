export function participantPhone(value: unknown): string {
  return typeof value === 'string' ? value.replace(/[\s-]/g, '').replace(/^\+?86(?=1\d{10}$)/, '') : ''
}

export function participantError(name: string, phone: string): string {
  if (!name.trim()) return '请填写选手姓名'
  if (name.trim().length > 40) return '姓名最多40个字'
  if (!/^1[3-9]\d{9}$/.test(participantPhone(phone))) return '请填写11位联系电话'
  return ''
}

export function eventSignupPath(id: string, invite = ''): string {
  return '/pages/event-signup/index?id=' + encodeURIComponent(id) + (invite ? '&invite=' + encodeURIComponent(invite) : '')
}

const pendingInviteKey = (actorId: string, eventId: string) => 'yanqing:event-team-invite:' + actorId + ':' + eventId
export function rememberTeamInvite(actorId: string, eventId: string, invite: { partnerInviteCode: string; expiresAt: string }) {
  if (actorId && eventId) uni.setStorageSync(pendingInviteKey(actorId, eventId), invite)
}
export function forgetTeamInvite(actorId: string, eventId: string) {
  if (actorId && eventId) uni.removeStorageSync(pendingInviteKey(actorId, eventId))
}
export function pendingTeamInvite(actorId: string, eventId: string): string {
  if (!actorId || !eventId) return ''
  const stored = uni.getStorageSync(pendingInviteKey(actorId, eventId))
  if (stored && /^EP_[A-Za-z0-9_-]{17,97}$/.test(stored.partnerInviteCode) && new Date(stored.expiresAt).getTime() > Date.now()) return stored.partnerInviteCode
  forgetTeamInvite(actorId, eventId)
  return ''
}
