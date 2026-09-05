import type { GameDetail, GameParticipants } from '../types/game'

export const parseGameId = (value: unknown): string =>
  typeof value === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(value) ? value : ''

export const gameDetailPath = (id: string, shared = false) =>
  `/pages/game-detail/index?id=${encodeURIComponent(parseGameId(id))}${shared ? '&from=share' : ''}`

export const gameLevelLabel = (level?: string) => ({
  BEGINNER: '新手友好', BASIC: '基础', INTERMEDIATE: '进阶', ADVANCED: '高水平',
  RECREATIONAL: '休闲', ALL_LEVELS: '不限水平',
}[level || ''] || '不限水平')

export function gameShareTitle(game: Pick<GameDetail, 'title' | 'status' | 'capacity'> & { occupiedCount?: number; _count?: { registrations?: number } }) {
  if (!['OPEN', 'FULL'].includes(game.status)) return `${game.title}｜查看球局详情`
  const remaining = Math.max(0, game.capacity - Number(game.occupiedCount ?? game._count?.registrations ?? 0))
  return game.status === 'FULL' || remaining === 0
    ? `${game.title}｜已满员，可加入候补`
    : `${game.title}｜还差${remaining}位球友，一起来打球`
}

export function gameAction(game: GameDetail, mine: GameParticipants['myRegistration'], authenticated: boolean, now = Date.now()) {
  if (!authenticated) return { kind: 'login', label: '登录查看我的报名' }
  const closed = !['OPEN', 'FULL'].includes(game.status) || new Date(game.startsAt).getTime() <= now
  if (mine?.order?.id && (closed || !['CANCELLED', 'REFUNDED'].includes(mine.status))) return { kind: 'order', label: mine.order.status === 'PENDING' ? '去支付 / 取消订单' : '查看我的订单' }
  if (mine?.status === 'WAITLISTED') return { kind: 'none', label: '已加入候补' }
  if (mine && ['REGISTERED', 'PAID', 'CHECKED_IN', 'COMPLETED'].includes(mine.status)) return { kind: 'none', label: '已报名，请勿重复提交' }
  if (closed) {
    return { kind: 'none', label: game.status === 'CANCELLED' ? '球局已取消' : '报名已结束' }
  }
  return { kind: 'join', label: game.status === 'FULL' || game.occupiedCount >= game.capacity || game.waitlistCount > 0 ? '加入候补' : '报名这场球局' }
}
