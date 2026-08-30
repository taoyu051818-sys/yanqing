export type AppRole =
  | 'MEMBER' | 'COACH' | 'FRONT_DESK' | 'HOST' | 'MERCHANT'
  | 'FINANCE' | 'EVENT_MANAGER' | 'ADMIN' | 'SUPER_ADMIN'

export interface SessionUser {
  id: string
  displayName: string
  avatarUrl?: string
  referrerId?: string | null
  primaryRole?: AppRole
  roles: Array<AppRole | { role: AppRole; merchant?: { id: string; name: string } }>
  accounts?: Account[]
  memberProfile?: Record<string, unknown>
}

export interface Account { id: string; type: string; balance: number; frozenBalance: number }
export interface ApiEnvelope<T> { code: number; message: string; data: T; requestId?: string }
export interface CourtAvailability {
  date: string
  courts: Array<{ id: string; code?: string; number?: number; name: string; usage: string; enabled: boolean }>
  slots: Array<{ id: string; code: string; label: string; startMinutes: number; endMinutes: number; price?: { priceCents: number; newcomerPriceCents?: number | null } }>
  bookings: Array<{ courtId: string; startsAt: string; endsAt: string; status: string; usage: string }>
  closures: Array<{ id: string; courtId: string; startsAt: string; endsAt: string; reason: string; status: 'ACTIVE' | 'CANCELLED' }>
}

export type WorkItemKind =
  | 'REFUND_REVIEW'
  | 'TRAINING_ATTENDANCE'
  | 'EVENT_SCORE'
  | 'ALLIANCE_SETTLEMENT'
  | 'TRAINING_SETTLEMENT'
  | 'LOW_STOCK'
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
