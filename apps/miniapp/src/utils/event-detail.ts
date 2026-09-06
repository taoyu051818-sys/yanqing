export const parseEventId = (value: unknown): string =>
  typeof value === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(value) ? value : ''

export const eventDetailPath = (id: string, shared = false) =>
  `/pages/event-detail/index?id=${encodeURIComponent(parseEventId(id))}${shared ? '&from=share' : ''}`

export function eventShareTitle(event: { name: string; status: string; totalRounds?: number; standings?: Array<{ name: string; finalRank?: number }> }) {
  const champion = event.status === 'COMPLETED' && event.standings?.find(team => team.finalRank === 1)
  if (champion) return `${event.name}冠军榜｜${champion.name}夺冠`
  return `${event.name}｜${['OPEN', 'FULL'].includes(event.status) ? '邀你参加固定双打积分赛' : '查看积分赛详情'}`
}

export function eventSignupOpen(event: { status: string; registrationEndsAt: string; startsAt: string }, now = Date.now()) {
  return ['OPEN', 'FULL'].includes(event.status) && new Date(event.registrationEndsAt).getTime() > now && new Date(event.startsAt).getTime() > now
}
