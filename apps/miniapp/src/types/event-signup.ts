export type DoublesCategory = 'MEN_DOUBLES' | 'WOMEN_DOUBLES' | 'MIXED_DOUBLES'
export interface TeamInviteView {
  role: 'CAPTAIN' | 'PARTNER' | 'VISITOR'
  status: 'PENDING' | 'ACCEPTED' | 'SUBMITTED' | 'EXPIRED'
  event: { id: string; name: string; startsAt: string; feeCents: number }
  captain: { displayName: string; avatarUrl?: string | null }
  partner?: { displayName: string; avatarUrl?: string | null } | null
  teamName: string
  category: DoublesCategory
  expiresAt: string
  playerAName?: string
  playerBName?: string
}
