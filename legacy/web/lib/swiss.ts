import type { EventMatch, EventPair, SwissEvent } from './types'

/** 排名规则：积分 → 净胜分 → 胜场 → 种子序 */
export const rankPairs = (pairs: EventPair[]): EventPair[] =>
  [...pairs].sort(
    (a, b) => b.points - a.points || b.scoreDiff - a.scoreDiff || b.wins - a.wins || a.seed - b.seed,
  )

export const BYE_ID = 'BYE'

/** 生成下一轮对阵：同分区内两两配对，尽量避免重复对手；奇数组时最低排名轮空计1分 */
export const buildNextRound = (event: SwissEvent): { matches: EventMatch[]; byePairId?: string } => {
  const round = event.currentRound + 1
  const playing = event.pairs.filter((p) => p.checkedIn)
  const ranked = rankPairs(playing)
  const pool = [...ranked]
  let byePairId: string | undefined

  if (pool.length % 2 === 1) {
    // 从最低排名开始，找一个还未轮空过的组合
    for (let i = pool.length - 1; i >= 0; i--) {
      if (!pool[i].opponents.includes(BYE_ID)) {
        byePairId = pool[i].id
        pool.splice(i, 1)
        break
      }
    }
    if (!byePairId) {
      byePairId = pool[pool.length - 1].id
      pool.pop()
    }
  }

  const matches: EventMatch[] = []
  let court = 1
  while (pool.length > 0) {
    const a = pool.shift()!
    let idx = pool.findIndex((p) => !a.opponents.includes(p.id))
    if (idx === -1) idx = 0
    const b = pool.splice(idx, 1)[0]
    matches.push({
      id: `${event.id}-R${round}-T${court}`,
      round,
      court: `${court}号场`,
      pairAId: a.id,
      pairBId: b.id,
      scoreA: null,
      scoreB: null,
      confirmed: false,
      corrected: false,
    })
    court++
  }
  return { matches, byePairId }
}

/** 根据全部已确认比分重算积分、胜负、净胜分与对手表 */
export const recomputeStandings = (event: SwissEvent): EventPair[] => {
  const base: Record<string, EventPair> = {}
  event.pairs.forEach((p) => {
    base[p.id] = { ...p, points: 0, wins: 0, losses: 0, scoreDiff: 0, opponents: [] }
  })
  // 轮空记录保留在 opponents 中（BYE），并计 1 分
  event.pairs.forEach((p) => {
    const byeCount = p.opponents.filter((o) => o === BYE_ID).length
    if (byeCount > 0) {
      base[p.id].points += byeCount
      base[p.id].opponents.push(...Array.from({ length: byeCount }, () => BYE_ID))
    }
  })
  event.matches.forEach((m) => {
    if (!m.confirmed || m.scoreA === null || m.scoreB === null) return
    const a = base[m.pairAId]
    const b = base[m.pairBId]
    if (!a || !b) return
    a.opponents.push(b.id)
    b.opponents.push(a.id)
    a.scoreDiff += m.scoreA - m.scoreB
    b.scoreDiff += m.scoreB - m.scoreA
    if (m.scoreA > m.scoreB) {
      a.points += 1
      a.wins += 1
      b.losses += 1
    } else {
      b.points += 1
      b.wins += 1
      a.losses += 1
    }
  })
  return Object.values(base)
}

/** 名次折算成人赛事积分 */
export const eventPointsForRank = (rank: number, total: number): number => {
  const ratio = 1 - (rank - 1) / Math.max(total, 1)
  return Math.max(6, Math.round(20 + 30 * ratio))
}

export const pairName = (p?: EventPair): string => (p ? `${p.playerA} / ${p.playerB}` : '轮空')
