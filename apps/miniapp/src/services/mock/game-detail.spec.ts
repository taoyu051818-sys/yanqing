import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mockRequest } from './router'
import { getAuditLogs, getGames, getVenueBookings, saveGames, saveVenueBookings } from './state'
import { getOrders } from './venue'

const storage = new Map<string, unknown>()
vi.stubGlobal('uni', {
  getStorageSync: (key: string) => storage.get(key) ?? '',
  setStorageSync: (key: string, value: unknown) => storage.set(key, value),
  removeStorageSync: (key: string) => storage.delete(key),
})
const request = <T = any>(method: string, url: string, data: any = {}) => mockRequest<T>(method, url, data)
const login = () => request('POST', '/auth/dev-login', { role: 'MEMBER' })

describe('game detail mock parity and registration journey', () => {
  beforeEach(() => { storage.clear() })

  it('serves a shared game before login, but never a member roster or private metadata', async () => {
    const games = getGames()
    Object.assign(games[0], { hostId: 'secret-host', rewardRule: { rate: 15 }, cancelReason: '内部备注' })
    saveGames(games)
    saveVenueBookings([{ id: 'secret-booking', gameId: 'game-weekend', courtId: 'court-1', memberId: 'secret-member', note: '内部安排' }])
    const detail = await request('GET', '/games/game-weekend')
    expect(detail).toMatchObject({ id: 'game-weekend', occupiedCount: 4, confirmedCount: 4, pendingCount: 0, waitlistCount: 0 })
    expect(detail.courtNames).toHaveLength(1)
    expect(JSON.stringify(detail)).not.toMatch(/secret|内部|rewardRule|userId|myRegistration|registrations|orderId/)
    await expect(request('GET', '/games/game-weekend/participants')).rejects.toMatchObject({ statusCode: 401 })
  })

  it('returns a terminal cancelled state, and rejects drafts and unknown IDs', async () => {
    const game = getGames()[0]
    saveGames([{ ...game, id: 'draft', status: 'DRAFT' }, { ...game, id: 'cancelled', status: 'CANCELLED', registrations: [] }])
    await expect(request('GET', '/games/draft')).rejects.toMatchObject({ statusCode: 404 })
    await expect(request('GET', '/games/missing')).rejects.toMatchObject({ statusCode: 404 })
    await expect(request('GET', '/games/cancelled')).resolves.toMatchObject({ status: 'CANCELLED', confirmedCount: 0 })
  })

  it('links registration → own pending order → payment → confirmed roster, without leaking other members', async () => {
    await login()
    const before = await request('GET', '/games/game-weekend/participants')
    expect(before.myRegistration).toBeNull()
    expect(before.participants).toHaveLength(4)
    for (const person of before.participants) expect(Object.keys(person).sort()).toEqual(['avatarUrl', 'displayName', 'isMe'])
    const command = { sourceChannel: 'MINI_PROGRAM', creationIdempotencyKey: 'detail-game-create-1' }
    const order = await request('POST', '/games/game-weekend/register', command)
    expect(await request('POST', '/games/game-weekend/register', command)).toMatchObject({ id: order.id })
    expect(getOrders().filter(item => item.id === order.id)).toHaveLength(1)
    expect(await request('GET', '/games/game-weekend')).toMatchObject({ occupiedCount: 5, confirmedCount: 4, pendingCount: 1 })
    expect((await request('GET', '/games/game-weekend/participants')).myRegistration).toMatchObject({ status: 'REGISTERED', order: { id: order.id, status: 'PENDING' } })
    await request('POST', `/orders/${order.id}/pay`, { channel: 'CASH_PRINCIPAL', idempotencyKey: 'detail-game-pay-1' })
    const after = await request('GET', '/games/game-weekend/participants')
    expect(after.participants).toHaveLength(5)
    expect(after.participants.find((person: any) => person.isMe)).toEqual({ displayName: '延庆会员小林', avatarUrl: null, isMe: true })
    expect(after.myRegistration).toMatchObject({ status: 'PAID', order: { id: order.id, status: 'PAID' } })
    expect(await request('GET', '/games/game-weekend')).toMatchObject({ occupiedCount: 5, confirmedCount: 5, pendingCount: 0 })
    await expect(request('POST', '/games/game-weekend/register', { creationIdempotencyKey: 'different-command' })).rejects.toThrow('已经报名')
  })

  it('shows the actual FIFO position when full, with no payment order before promotion', async () => {
    await login()
    const games = getGames()
    games[0].capacity = 4
    games[0].status = 'FULL'
    games[0].registrations.push({ id: 'waiting-earlier', userId: 'earlier-member', displayName: '不公开的候补', status: 'WAITLISTED', createdAt: new Date(Date.now() - 60000).toISOString() })
    saveGames(games)
    const count = getOrders().length
    expect(await request('POST', '/games/game-weekend/register', { creationIdempotencyKey: 'detail-waitlist-1' })).toMatchObject({ status: 'WAITLISTED', waitlistPosition: 2 })
    const detail = await request('GET', '/games/game-weekend/participants')
    expect(detail.myRegistration).toMatchObject({ status: 'WAITLISTED', order: null, waitlistPosition: 2 })
    expect(JSON.stringify(detail.participants)).not.toContain('不公开的候补')
    expect(getOrders()).toHaveLength(count)
  })

  it('cancels an unpaid registration, preserves the game courts, promotes FIFO and updates all read views', async () => {
    await login()
    const order = await request('POST', '/games/game-weekend/register', { creationIdempotencyKey: 'cancel-detail-create' })
    const games = getGames()
    games[0].capacity = 5
    games[0].status = 'FULL'
    games[0].registrations.push({ id: 'wait-next', userId: 'next-member', displayName: '候补球友', status: 'WAITLISTED', createdAt: new Date().toISOString() })
    saveGames(games)
    const courts = [{ id: 'game-court', gameId: 'game-weekend', courtId: 'court-1', status: 'CONFIRMED' }]
    saveVenueBookings(courts)
    const data = { idempotencyKey: 'cancel-detail-1', reason: '临时有事' }
    await expect(request('POST', `/orders/${order.id}/cancel`, data)).resolves.toMatchObject({ status: 'CANCELLED' })
    expect(getVenueBookings()).toEqual(courts)
    expect((await request('GET', '/games/game-weekend/participants')).myRegistration).toMatchObject({ status: 'CANCELLED', order: { id: order.id, status: 'CANCELLED' } })
    expect(await request('GET', '/games/game-weekend')).toMatchObject({ occupiedCount: 5, confirmedCount: 4, pendingCount: 1, waitlistCount: 0 })
    expect(getGames()[0].registrations.find((row: any) => row.id === 'wait-next')).toMatchObject({ status: 'REGISTERED' })
    const ordersBeforeReplay = getOrders().length
    await request('POST', `/orders/${order.id}/cancel`, data)
    expect(getOrders()).toHaveLength(ordersBeforeReplay)
    expect(getAuditLogs().some(item => item.action === 'GAME_ORDER_CANCELLED_BY_USER')).toBe(true)
  })
})
