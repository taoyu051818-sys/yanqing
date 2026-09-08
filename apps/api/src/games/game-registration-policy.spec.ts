import { describe, expect, it } from 'vitest'
import {
  gamePaymentUnavailable,
  gameRegistrationOpen,
} from './game-registration-policy.js'
import { pendingPaymentDeadline } from '../orders/pending-order-policy.js'

const now = new Date('2026-09-08T12:00:00+08:00')
const game = {
  status: 'OPEN',
  startsAt: new Date(+now + 300000),
  endsAt: new Date(+now + 3600000),
}
describe('game registration time policy', () => {
  it.each(['OPEN', 'FULL'])('accepts %s before the start', (status) => {
    expect(gameRegistrationOpen({ ...game, status }, now)).toBe(true)
    expect(
      gamePaymentUnavailable(
        { status: 'REGISTERED', game: { ...game, status } },
        now,
        now,
      ),
    ).toBe('')
  })
  it.each(['DRAFT', 'IN_PROGRESS', 'CANCELLED', 'COMPLETED'])(
    'rejects %s even with future dates',
    (status) => {
      expect(gameRegistrationOpen({ ...game, status }, now)).toBe(false)
    },
  )
  it.each([new Date(+now - 1), now, new Date('invalid')])(
    'rejects elapsed and invalid starts',
    (startsAt) => {
      expect(gameRegistrationOpen({ ...game, startsAt }, now)).toBe(false)
    },
  )
  it('rejects missing or expired reservations and invalid time ordering', () => {
    expect(gamePaymentUnavailable(null, now, now)).not.toBe('')
    expect(gamePaymentUnavailable({ status: 'PAID', game }, now, now)).not.toBe(
      '',
    )
    expect(
      gamePaymentUnavailable(
        { status: 'REGISTERED', game },
        new Date(+now - 900000),
        now,
      ),
    ).not.toBe('')
    expect(gameRegistrationOpen({ ...game, endsAt: game.startsAt }, now)).toBe(
      false,
    )
  })
  it('caps the displayed and enforced hold at game start including historical orders', () => {
    const order = { status: 'PENDING', businessType: 'GAME', createdAt: now }
    expect(
      pendingPaymentDeadline({ ...order, gameRegistration: { game } }),
    ).toEqual(game.startsAt)
    expect(
      pendingPaymentDeadline({
        ...order,
        parameterSnapshot: { gameStartsAt: game.startsAt.toISOString() },
      }),
    ).toEqual(game.startsAt)
    expect(
      pendingPaymentDeadline({
        ...order,
        gameRegistration: {
          game: { ...game, startsAt: new Date(+now + 3600000) },
        },
      }),
    ).toEqual(new Date(+now + 900000))
    expect(+pendingPaymentDeadline(order)!).toBe(0)
  })
})
