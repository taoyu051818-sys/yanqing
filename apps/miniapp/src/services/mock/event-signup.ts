import { mockUser } from './core'
import { getEventDetail, getEventPartnerInvites, getGovernanceUsers, saveEventPartnerInvites } from './state'
import { participantError, participantPhone } from '../../utils/event-signup'

export function assertMockEventContacts(detail: any, phones: string[], userIds: string[] = []) {
  const contacts = phones.filter(Boolean)
  if (!contacts.length) return
  if (new Set(contacts).size !== contacts.length) throw new Error('两位选手不能使用相同的联系电话')
  const ids = [...userIds, ...getGovernanceUsers().filter((user: any) => contacts.includes(user.phone)).map((user: any) => user.id)]
  if ((detail.teams || []).some((team: any) => !['CANCELLED', 'REFUNDED'].includes(team.status) &&
    ([team.playerAPhone, team.playerBPhone].some(phone => contacts.includes(phone)) ||
      [team.playerAUserId, team.playerBUserId].some(id => id && ids.includes(id))))) {
    throw new Error('其中一位选手已报名本赛事或正在候补，请勿重复提交')
  }
}
function assertContact(name: string, phone: string) {
  const error = participantError(name, phone)
  if (error) throw new Error(error)
}
function assertOpen(detail: any) {
  if (!['OPEN', 'FULL'].includes(detail.status) || new Date(detail.registrationEndsAt).getTime() <= Date.now() || new Date(detail.startsAt).getTime() <= Date.now()) throw new Error('赛事报名已截止或不在报名期')
}
export function routeMockTeamInvites(method: string, url: string, data: any) {
  const match = url.match(/^\/events\/([^/]+)\/team-invites(?:\/(preview|context|accept))?$/)
  if (!match || method !== 'POST') return { handled: false }
  const detail = getEventDetail(match[1])
  if (!detail) throw new Error('赛事不存在')
  const action = match[2] || 'create'
  const actor = mockUser()
  if (action !== 'preview' && (!uni.getStorageSync('yanqing_access_token') ||
    !actor.roles.some(role => (typeof role === 'string' ? role : role.role) === 'MEMBER'))) throw new Error('请登录会员账号')
  const book = getEventPartnerInvites()
  if (action === 'create') {
    assertOpen(detail)
    if (data.consent !== true) throw new Error('请确认同意报名信息使用说明')
    const name = String(data.name || '').trim(), playerAName = String(data.playerAName || '').trim(), phone = participantPhone(data.playerAPhone)
    if (!name || name.length > 80) throw new Error('请填写80字以内的队伍名称')
    if (!['MEN_DOUBLES', 'WOMEN_DOUBLES', 'MIXED_DOUBLES'].includes(data.category)) throw new Error('请选择参赛组别')
    assertContact(playerAName, phone)
    assertMockEventContacts(detail, [phone], [actor.id])
    if ((detail.teams || []).some((team: any) => team.captainId === actor.id && !['CANCELLED', 'REFUNDED'].includes(team.status))) throw new Error('你已提交本赛事报名或候补')
    const now = new Date().toISOString()
    book.forEach((item: any) => { if (item.eventId === detail.id && item.captainId === actor.id && !item.consumedAt) item.revokedAt = now })
    const partnerInviteCode = 'EP_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2)
    const expiresAt = new Date(Math.min(Date.now() + 86_400_000, new Date(detail.registrationEndsAt).getTime(), new Date(detail.startsAt).getTime())).toISOString()
    book.push({ id: partnerInviteCode, eventId: detail.id, captainId: actor.id, captain: { displayName: actor.displayName, avatarUrl: actor.avatarUrl }, teamName: name, category: data.category, playerAName, playerAPhone: phone, partnerInviteCode, expiresAt, createdAt: now })
    saveEventPartnerInvites(book)
    return { handled: true, value: { partnerInviteCode, expiresAt } }
  }
  const invite = book.find((item: any) => item.captainId && item.eventId === detail.id && item.partnerInviteCode === data.partnerInviteCode && !item.revokedAt)
  if (!invite) throw new Error('搭档邀请无效或已撤回，请好友重新分享')
  if (action === 'accept') {
    if (data.consent !== true) throw new Error('请确认同意组队')
    const name = String(data.playerBName || '').trim(), phone = participantPhone(data.playerBPhone)
    assertContact(name, phone)
    if (invite.captainId === actor.id) throw new Error('不能接受自己发出的搭档邀请')
    if (invite.partnerId === actor.id && invite.acceptedAt) {
      if (invite.playerBName !== name || invite.playerBPhone !== phone) throw new Error('已确认的信息不能覆盖，请队长重新发起邀请')
    } else {
      if (invite.partnerId || invite.consumedAt) throw new Error('这份邀请已由其他搭档确认')
      assertOpen(detail)
      if (new Date(invite.expiresAt).getTime() <= Date.now()) throw new Error('邀请已过期')
      assertMockEventContacts(detail, [invite.playerAPhone, phone], [invite.captainId, actor.id])
      Object.assign(invite, { partnerId: actor.id, partnerDisplayName: actor.displayName, partnerAvatarUrl: actor.avatarUrl, playerBName: name, playerBPhone: phone, acceptedAt: new Date().toISOString() })
      saveEventPartnerInvites(book)
    }
  }
  const role = action === 'preview' ? 'VISITOR' : actor.id === invite.captainId ? 'CAPTAIN' : actor.id === invite.partnerId ? 'PARTNER' : 'VISITOR'
  const expired = new Date(invite.expiresAt).getTime() <= Date.now() || new Date(detail.registrationEndsAt).getTime() <= Date.now() || new Date(detail.startsAt).getTime() <= Date.now() || !['OPEN', 'FULL'].includes(detail.status)
  return { handled: true, value: {
    role, status: invite.consumedAt ? 'SUBMITTED' : expired ? 'EXPIRED' : invite.acceptedAt ? 'ACCEPTED' : 'PENDING',
    event: { id: detail.id, name: detail.name, startsAt: detail.startsAt, feeCents: detail.feeCents },
    captain: invite.captain, teamName: invite.teamName, category: invite.category, expiresAt: invite.expiresAt,
    ...(role !== 'VISITOR' ? { playerAName: invite.playerAName, playerBName: invite.playerBName, partner: invite.partnerId ? { displayName: invite.partnerDisplayName, avatarUrl: invite.partnerAvatarUrl } : null } : {}),
  } }
}
