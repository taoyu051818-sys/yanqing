import { PURCHASE_HOLD_MS } from '../orders/pending-order-policy.js'

type GameWindow = {
  status: string
  startsAt: Date | string
  endsAt: Date | string
}
type Registration = { status: string; game: GameWindow }

export function gameRegistrationOpen(
  game: GameWindow | null | undefined,
  now = new Date(),
): boolean {
  if (!game || !['OPEN', 'FULL'].includes(game.status)) return false
  const start = +new Date(game.startsAt),
    end = +new Date(game.endsAt)
  return (
    Number.isFinite(start) &&
    Number.isFinite(end) &&
    start > +now &&
    end > start
  )
}

export function gamePaymentUnavailable(
  registration: Registration | null | undefined,
  createdAt: Date | string,
  now = new Date(),
): string {
  if (!registration || registration.status !== 'REGISTERED')
    return '球局报名席位当前不可支付'
  if (!gameRegistrationOpen(registration.game, now))
    return '球局已截止报名或已关闭，不能支付'
  const created = +new Date(createdAt)
  if (!Number.isFinite(created) || created + PURCHASE_HOLD_MS <= +now)
    return '球局支付保留期已过，请重新报名'
  return ''
}
