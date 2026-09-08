export interface BossDailyMetrics {
  orderCount: number
  venueOrderCount: number
  assistedVenueOrderCount: number
  pendingOrderCount: number
  pendingBacklogCount: number
  cancelledOrderCount: number
  refundedOrderCount: number
  refundRequestedOrderCount: number
  paidCents: number
  wechatPaidCents: number
  refundedCents: number
  venueRevenueCents: number
}
export interface BossSlot {
  id: string
  label: string
  startMinutes: number
  endMinutes: number
  availableMinutes: number
  occupiedMinutes: number
  emptyMinutes: number
  utilizationRate: number | null
}
export interface BossVenueSummary {
  availableMinutes: number
  occupiedMinutes: number
  utilizationRate: number | null
  slots: BossSlot[]
  emptiestSlots: BossSlot[]
}
export interface BossActivity<TDate = string> {
  id: string
  kind: 'GAME' | 'EVENT'
  name: string
  status: string
  startsAt: TDate
  registrationEndsAt: TDate
  capacityPeople: number
  confirmedPeople: number
  unpaidPeople: number
  reservedPeople: number
  remainingPeople: number
  waitlistPeople: number
  collectedCents: number
}
export interface BossRiskEvent<TDate = string> {
  id: string
  ruleCode: string
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'
  status: 'OPEN' | 'REVIEWING' | 'RESOLVED' | 'DISMISSED'
  summary: string
  objectType: string
  objectId: string | null
  orderId: string | null
  evidence: unknown
  createdAt: TDate
  lastSeenAt: TDate | null
}
export interface BossThresholds {
  largeOrderCents: number
  largeRechargeCents: number
  frequentRefundCount: number
  paymentStuckMinutes: number
  overdueOrderMinutes: number
  lowUtilizationPercent: number
  nearFullPercent: number
  lowSignupPercent: number
  signupLeadHours: number
}
export interface BossSummary<TDate = string> {
  date: string
  timezone: string
  capturedAt: string
  daily: BossDailyMetrics
  venue: BossVenueSummary
  activities: BossActivity<TDate>[]
  activityCount: number
  activitiesAsOf: string
  definitions: Record<string, string>
  events: BossRiskEvent<TDate>[]
  eventCount: number
  eventsTruncated: boolean
  monitor: {
    lastSucceededAt: string | null
    error: string | null
    intervalMinutes: number
    thresholds: BossThresholds
  }
  aiConfigured: boolean
}
export interface BossBriefing {
  date: string
  text: string
  source: 'PENDING' | 'FACTS' | 'AI'
  model: string | null
  generatedAt: string | null
  message?: string
}
