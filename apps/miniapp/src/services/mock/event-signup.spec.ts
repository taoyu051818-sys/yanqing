import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mockRequest } from './router'
import { getOrders } from './venue'
import { getEventDetail, getEventPartnerInvites, getGovernanceUsers, saveEventDetail, saveEventPartnerInvites } from './state'
import { participantError, participantPhone, eventSignupPath, rememberTeamInvite, pendingTeamInvite } from '../../utils/event-signup'
import { rememberLoginReturn, consumeLoginReturn } from '../../utils/member-navigation'

const storage = new Map<string, any>()
vi.stubGlobal('uni', { getStorageSync: (key: string) => storage.get(key) ?? '', setStorageSync: (key: string, value: any) => storage.set(key, value), removeStorageSync: (key: string) => storage.delete(key) })
const request = (url: string, data: any = {}, method = 'POST') => mockRequest<any>(method, url, data)
const login = (role: string) => request('/auth/dev-login', { role })
const eventId = 'event-open-partner'
const base = '/events/' + eventId
const manual = { registrationMode: 'MANUAL', name: '完整代填队', playerAName: '选手甲', playerAPhone: '13810000001', playerBName: '选手乙', playerBPhone: '13810000002', category: 'MIXED_DOUBLES', captainPlays: true, consent: true }
const createInvite = () => request(base + '/team-invites', { name: manual.name, playerAName: manual.playerAName, playerAPhone: manual.playerAPhone, category: manual.category, consent: true })
const accept = (partnerInviteCode: string) => request(base + '/team-invites/accept', { partnerInviteCode, playerBName: manual.playerBName, playerBPhone: manual.playerBPhone, consent: true })

describe('member doubles form and mock closed loop', () => {
  beforeEach(async () => { storage.clear(); await login('MEMBER') })
  it('validates phones and deep-links through login without contact parameters', () => {
    expect(participantPhone('+86 138-1000-0001')).toBe('13810000001')
    expect(participantError('张三', '123')).toContain('11位')
    const path = eventSignupPath(eventId, 'EP_opaque_only_token_123456')
    rememberLoginReturn(path)
    expect(consumeLoginReturn()).toBe(path)
    expect(path).not.toMatch(/Phone|Name|138100/)
  })
  it('restores pending invitations only for the same account and event until expiry', () => {
    const code = 'EP_opaque_only_token_123456'
    rememberTeamInvite('captain', eventId, { partnerInviteCode: code, expiresAt: new Date(Date.now() + 100000).toISOString() })
    expect(pendingTeamInvite('captain', eventId)).toBe(code)
    expect(pendingTeamInvite('other-user', eventId)).toBe('')
    expect(pendingTeamInvite('captain', 'other-event')).toBe('')
    rememberTeamInvite('captain', eventId, { partnerInviteCode: code, expiresAt: new Date(0).toISOString() })
    expect(pendingTeamInvite('captain', eventId)).toBe('')
  })
  it('registers two guest participants with one payer and no new account', async () => {
    const usersBefore = getGovernanceUsers().length
    const order = await request(base + '/register', { ...manual, captainPlays: false, creationIdempotencyKey: 'manual-guest-command' })
    expect(order).toMatchObject({ status: 'PENDING', businessType: 'EVENT' })
    expect(getOrders().find(item => item.id === order.id)?.memberId).toBe('user-member')
    const team = getEventDetail(eventId).teams.find((item: any) => item.orderId === order.id)
    expect(team).toMatchObject({ playerAName: manual.playerAName, playerBName: manual.playerBName, playerBUserId: null, captainPlays: false })
    expect(team.playerAUserId).toBeFalsy()
    expect(getGovernanceUsers()).toHaveLength(usersBefore)
    const replay = await request(base + '/register', { ...manual, captainPlays: false, creationIdempotencyKey: 'manual-guest-command' })
    expect(replay.id).toBe(order.id)
    await expect(request(base + '/register', { ...manual, playerBPhone: '13810000009', captainPlays: false, creationIdempotencyKey: 'manual-guest-command' })).rejects.toThrow('幂等键')
  })
  it('requires contacts, consent and prevents duplicates from a different submitting account', async () => {
    await expect(request(base + '/register', { ...manual, playerBPhone: '' })).rejects.toThrow('11位')
    await expect(request(base + '/register', { ...manual, consent: false })).rejects.toThrow('同意')
    await request(base + '/register', manual)
    await login('HOST')
    await expect(request(base + '/register', { ...manual, playerAName: '另一个队长', playerAPhone: '13810000003' })).rejects.toThrow('重复')
  })
  it('cancelled unpaid team releases its participant contacts for a fresh signup', async () => {
    const first = await request(base + '/register', manual)
    await request(base + '/registration/cancel', { reason: '行程变化', idempotencyKey: 'cancel-manual-test' })
    const second = await request(base + '/register', { ...manual, creationIdempotencyKey: 'fresh-manual-entry' })
    expect(second.id).not.toBe(first.id)
  })
  it('invitation preview is safe and does not auto-accept', async () => {
    const created = await createInvite()
    storage.delete('yanqing_access_token')
    const view = await request(base + '/team-invites/preview', { partnerInviteCode: created.partnerInviteCode })
    expect(view).toMatchObject({ role: 'VISITOR', status: 'PENDING', captain: { displayName: '延庆会员小林' } })
    expect(JSON.stringify(view)).not.toMatch(/playerAName|playerBName|Phone|captainId|partnerId|138100/)
    expect(getEventPartnerInvites().find((item: any) => item.partnerInviteCode === created.partnerInviteCode)?.partnerId).toBeFalsy()
  })
  it('share → explicit acceptance → captain submits → pending payment', async () => {
    const created = await createInvite()
    await expect(accept(created.partnerInviteCode)).rejects.toThrow('自己')
    await login('HOST')
    expect(await accept(created.partnerInviteCode)).toMatchObject({ role: 'PARTNER', status: 'ACCEPTED' })
    expect(await accept(created.partnerInviteCode)).toMatchObject({ role: 'PARTNER', status: 'ACCEPTED' })
    await login('COACH')
    await expect(accept(created.partnerInviteCode)).rejects.toThrow('其他搭档')
    await login('MEMBER')
    const view = await request(base + '/team-invites/context', { partnerInviteCode: created.partnerInviteCode })
    expect(view).toMatchObject({ role: 'CAPTAIN', status: 'ACCEPTED', playerBName: manual.playerBName })
    const order = await request(base + '/register', { registrationMode: 'INVITE', name: manual.name, category: manual.category, partnerInviteCode: created.partnerInviteCode })
    expect(order).toMatchObject({ status: 'PENDING' })
    const team = getEventDetail(eventId).teams.find((item: any) => item.orderId === order.id)
    expect(team).toMatchObject({ playerAUserId: 'user-member', playerBUserId: 'user-host', playerBPhone: manual.playerBPhone })
    expect(await request(base + '/team-invites/context', { partnerInviteCode: created.partnerInviteCode })).toMatchObject({ status: 'SUBMITTED' })
  })
  it('stale or unaccepted invitations cannot create an order', async () => {
    const created = await createInvite()
    await expect(request(base + '/register', { registrationMode: 'INVITE', name: manual.name, category: manual.category, partnerInviteCode: created.partnerInviteCode })).rejects.toThrow('尚未确认')
    const book = getEventPartnerInvites()
    book[book.length - 1].expiresAt = new Date(0).toISOString()
    saveEventPartnerInvites(book)
    await login('HOST')
    await expect(accept(created.partnerInviteCode)).rejects.toThrow('过期')
  })
  it('public event detail and member registration never include phones', async () => {
    await request(base + '/register', manual)
    expect(JSON.stringify(await request(base + '/registration/me', {}, 'GET'))).not.toMatch(/playerAPhone|playerBPhone|138100/)
    expect(JSON.stringify(await request(base, {}, 'GET'))).not.toMatch(/playerAPhone|playerBPhone|138100/)
  })
  it('a full event accepts both contacts into waitlist without charging', async () => {
    const detail = getEventDetail(eventId)
    detail.teams = Array.from({ length: 24 }, (_, index) => ({ id: 'existing-' + index, name: '已付队' + index, status: 'PAID', playerAUserId: 'existing-A-' + index, playerBUserId: 'existing-B-' + index, captainId: 'existing-A-' + index }))
    detail.status = 'FULL'
    saveEventDetail(detail)
    expect(await request(base + '/register', manual)).toMatchObject({ status: 'WAITLISTED' })
    expect(getEventDetail(eventId).teams.find((team: any) => team.name === manual.name)?.orderId).toBeNull()
  })
})
