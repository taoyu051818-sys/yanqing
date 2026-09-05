export type AppRole =
  | 'MEMBER' | 'COACH' | 'FRONT_DESK' | 'HOST' | 'MERCHANT'
  | 'FINANCE' | 'EVENT_MANAGER' | 'ADMIN' | 'SUPER_ADMIN'

export interface SessionUser {
  id: string
  displayName: string
  avatarUrl?: string
  hasReferrer?: boolean
  primaryRole?: AppRole
  roles: Array<AppRole | { role: AppRole; merchant?: { id: string; name: string } }>
  accounts?: Account[]
  memberProfile?: Record<string, unknown>
}

export interface Account { id: string; type: string; balance: number; frozenBalance: number }
export type MemberPrivacyScope = 'FRONT_DESK_LIMITED' | 'COACH_ASSIGNED' | 'FINANCE' | 'ADMIN'
export interface MemberProfileSummary extends Record<string, unknown> {
  level?: string
  tags?: string[]
  visitCount?: number
  lastVisitAt?: string | null
  membershipExpiresAt?: string | null
}
export interface MemberDirectoryItem {
  id: string
  displayName: string
  avatarUrl?: string | null
  phone?: string | null
  status?: string
  level?: string
  memberProfile?: MemberProfileSummary | null
  privacyScope: MemberPrivacyScope
}
export interface MemberDirectory {
  items: MemberDirectoryItem[]
  total: number
  page?: number
  pageSize?: number
}
export interface Member360View {
  member: Omit<MemberDirectoryItem, 'privacyScope'>
  accounts: Account[]
  paymentSummary?: {
    storedValueAvailableCents: number
    badmintonCoinAvailable: number
  }
  recentOrders: Array<Record<string, any>>
  recentTraining: Array<Record<string, any>>
  recentGames: Array<Record<string, any>>
  recentEvents: Array<Record<string, any>>
  recentCoupons: Array<Record<string, any>>
  privacyScope: MemberPrivacyScope
  financialsRedacted: boolean
  accountTypesLimited: boolean
}
export interface ApiEnvelope<T> { code: number; message: string; data: T; requestId?: string }
export interface CourtAvailability {
  date: string
  courts: Array<{ id: string; name: string; usage: string; enabled: boolean }>
  slots: Array<{ id: string; label: string; startMinutes: number; endMinutes: number; period?: 'EARLY' | 'DAYTIME' | 'PRIME'; enabled: boolean; price?: { priceCents: number; newcomerPriceCents?: number | null } }>
  bookings: Array<{ courtId: string; startsAt: string; endsAt: string; status: string; usage: string }>
  closures: Array<{ courtId: string; startsAt: string; endsAt: string; status: 'ACTIVE' | 'CANCELLED' }>
}

export type WorkItemKind =
  | 'ACCOUNT_ADJUSTMENT_REVIEW'
  | 'CUSTOMER_LEAD_SLA'
  | 'HOST_APPLICATION_REVIEW'
  | 'DATA_ERASURE_REVIEW'
  | 'REFUND_REVIEW'
  | 'TRAINING_CONSUME_CORRECTION_REVIEW'
  | 'TRAINING_TRIAL_CHECK_IN'
  | 'TRAINING_TRIAL_ASSESSMENT'
  | 'TRAINING_TRIAL_DECISION'
  | 'YOUTH_TRAINING_RULE_REVIEW'
  | 'TRAINING_SESSION_OPERATION'
  | 'TRAINING_ATTENDANCE'
  | 'EVENT_SCORE'
  | 'EVENT_PRIZE_RECEIPT'
  | 'ALLIANCE_SETTLEMENT'
  | 'TRAINING_SETTLEMENT'
  | 'CONSIGNMENT_SETTLEMENT'
  | 'LOW_STOCK'
  | 'GAME_OPERATION'
  | 'ORDER_FULFILLMENT'

export interface WorkItem {
  id: string
  kind: WorkItemKind
  objectType: string
  objectId: string
  status: string
  priority: number
  title: string
  description: string
  ownerRoles: string[]
  createdAt: string
  dueAt?: string
  amountCents?: number
  action: string
  metadata?: Record<string, unknown>
}
