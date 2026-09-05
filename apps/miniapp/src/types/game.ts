export interface GameDetail {
  id: string
  title: string
  level: string
  status: string
  startsAt: string
  endsAt: string | null
  capacity: number
  feeCents: number
  newcomerOnly: boolean
  description: string | null
  host: { displayName: string; avatarUrl: string | null } | null
  courtNames: string[]
  occupiedCount: number
  confirmedCount: number
  pendingCount: number
  waitlistCount: number
}

export interface GameParticipants {
  participants: Array<{ displayName: string; avatarUrl: string | null; isMe: boolean }>
  myRegistration: {
    id: string
    status: string
    order: { id: string; status: string } | null
    waitlistPosition: number | null
  } | null
}
