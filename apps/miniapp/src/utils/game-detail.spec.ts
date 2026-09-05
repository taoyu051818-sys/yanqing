import { describe, expect, it } from 'vitest'
import type { GameDetail } from '../types/game'
import { gameAction, gameDetailPath, gameShareTitle, parseGameId } from './game-detail'

const game = { id: 'game-1', title: '周末双打', capacity: 6, status: 'OPEN', startsAt: '2099-01-01T10:00:00+08:00', occupiedCount: 4, waitlistCount: 0 } as GameDetail
const mine = (status: string, order: { id: string; status: string } | null = null) => ({ id: 'my-registration', status, order, waitlistPosition: null })

describe('game detail journey', () => {
  it('shares a canonical detail URL without account or payment identifiers', () => {
    expect(gameDetailPath('game-1', true)).toBe('/pages/game-detail/index?id=game-1&from=share')
    expect(gameShareTitle(game)).toContain('还差2位球友')
    expect(gameShareTitle({ ...game, occupiedCount: 6 })).toContain('候补')
    expect(gameShareTitle({ ...game, status: 'CANCELLED' })).not.toContain('一起来')
  })
  it('rejects malformed identifiers', () => {
    for (const id of ['../x', 'game&a=1', '%2f', ['game-1'], '', 'x'.repeat(129)]) expect(parseGameId(id)).toBe('')
  })
  it('requires explicit login and never enrolls a visitor automatically', () => {
    expect(gameAction(game, null, false).kind).toBe('login')
    expect(gameAction(game, null, true).label).toBe('报名这场球局')
  })
  it('opens the same pending order instead of creating another order', () => {
    expect(gameAction(game, mine('REGISTERED', { id: 'order-1', status: 'PENDING' }), true).kind).toBe('order')
    expect(gameAction(game, mine('PAID', { id: 'order-1', status: 'PAID' }), true).kind).toBe('order')
  })
  it('supports waitlist state, FIFO protection and historical re-enrollment', () => {
    expect(gameAction({ ...game, status: 'FULL' }, null, true).label).toBe('加入候补')
    expect(gameAction({ ...game, waitlistCount: 1 }, null, true).label).toBe('加入候补')
    expect(gameAction(game, mine('WAITLISTED'), true).kind).toBe('none')
    expect(gameAction(game, mine('CANCELLED', { id: 'old-order', status: 'CANCELLED' }), true).kind).toBe('join')
  })
  it('blocks closed and past games, while keeping an existing order accessible', () => {
    for (const status of ['CANCELLED', 'IN_PROGRESS', 'COMPLETED']) expect(gameAction({ ...game, status }, null, true).kind).toBe('none')
    expect(gameAction({ ...game, startsAt: '2000-01-01' }, null, true).kind).toBe('none')
    expect(gameAction({ ...game, status: 'CANCELLED' }, mine('CANCELLED', { id: 'order-1', status: 'REFUND_PENDING' }), true).kind).toBe('order')
  })
})
