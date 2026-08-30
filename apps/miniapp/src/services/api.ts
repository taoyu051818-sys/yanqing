import { api, download } from "./http";
import type { CourtAvailability, SessionUser } from "../types/domain";

/**
 * The operator queue is intentionally a small, transport-level contract.
 * Keep optional fields so older APIs and the local mock can be consumed while
 * the server rolls out additional work-item metadata (for example group or
 * category). The page still treats the server response as the source of truth.
 */
export interface WorkItem {
  id: string;
  kind?: string;
  group?: string;
  category?: string;
  objectType?: string;
  objectId?: string;
  status?: string;
  priority?: number;
  title?: string;
  description?: string;
  ownerRoles?: string[];
  createdAt?: string;
  dueAt?: string;
  amountCents?: number;
  action?: string;
  metadata?: Record<string, unknown>;
}

export interface ReconciliationPeriod {
  id?: string;
  businessDate: string;
  status: "OPEN" | "REVIEW" | "LOCKED" | string;
  totals: Record<string, number>;
  exceptionCount: number;
  closedById?: string | null;
  closedAt?: string | null;
  detail?: Record<string, unknown>;
  blocked?: boolean;
  blockers?: Array<{ kind: string; count: number; message: string }>;
}

export interface CreateVenueBookingCommand {
  memberId?: string;
  date: string;
  courtId: string;
  slotId: string;
  sourceChannel: string;
  couponCode?: string;
  creationIdempotencyKey?: string;
}

export interface VenueClosure {
  id: string;
  courtId: string;
  startsAt: string;
  endsAt: string;
  reason: string;
  status: "ACTIVE" | "CANCELLED";
  creationIdempotencyKey: string;
  createdById: string;
  cancelledById?: string | null;
  cancelledAt?: string | null;
  cancelReason?: string | null;
  createdAt: string;
  updatedAt: string;
  court?: { id: string; code?: string; name: string; enabled?: boolean };
  createdBy?: { id: string; displayName: string };
  cancelledBy?: { id: string; displayName: string } | null;
}

export const endpoints = {
  wechatLogin: (code: string, displayName?: string, avatarUrl?: string) =>
    api.post<{ accessToken: string; user: SessionUser }>("/auth/wechat-login", {
      code,
      displayName,
      avatarUrl,
    }),
  devLogin: (role: string) =>
    api.post<{ accessToken: string; user: SessionUser }>("/auth/dev-login", {
      role,
    }),
  me: () => api.get<SessionUser>("/auth/me"),
  dashboard: () => api.get<Record<string, any>>("/dashboard"),
  reconciliationPeriod: (date: string) =>
    api.get<ReconciliationPeriod>(`/reconciliation/periods/${date}`),
  closeReconciliationPeriod: (date: string, data: object = {}) =>
    api.post<ReconciliationPeriod>(
      `/reconciliation/periods/${date}/close`,
      data,
    ),
  workItems: (limit = 50) => api.get<WorkItem[]>("/work-items", { limit }),
  availability: (date: string) =>
    api.get<CourtAvailability>("/venues/availability", { date }),
  venueClosures: (params: Record<string, any> = {}) =>
    api.get<VenueClosure[]>("/venues/closures", params),
  createVenueClosure: (data: object) =>
    api.post<VenueClosure>("/venues/closures", data),
  cancelVenueClosure: (id: string, reason: string) =>
    api.post<VenueClosure>(`/venues/closures/${id}/cancel`, { reason }),
  createBooking: (data: CreateVenueBookingCommand) =>
    api.post<Record<string, any>>("/venues/bookings", data),
  orders: () => api.get<{ items: any[]; total: number }>("/orders"),
  order: (id: string) => api.get<Record<string, any>>(`/orders/${id}`),
  payOrder: (id: string, data: object) => api.post(`/orders/${id}/pay`, data),
  refundOrder: (id: string, data: object) =>
    api.post(`/orders/${id}/refunds`, data),
  approveRefund: (refundId: string, data: object) =>
    api.post(`/orders/refunds/${refundId}/approve`, data),
  rejectRefund: (refundId: string, data: object = {}) =>
    api.post(`/orders/refunds/${refundId}/reject`, data),
  games: () => api.get<any[]>("/games"),
  createGame: (data: object) => api.post("/games", data),
  applyHost: () => api.post("/games/hosts/apply"),
  hostApplications: () => api.get<any[]>("/games/host-applications"),
  approveHost: (userId: string, data: object = {}) =>
    api.post(`/games/hosts/${userId}/approve`, data),
  rejectHost: (userId: string, reason: string) =>
    api.post(`/games/hosts/${userId}/reject`, { reason }),
  publishGame: (id: string, data: object = {}) =>
    api.post(`/games/${id}/publish`, data),
  registerGame: (id: string, creationIdempotencyKey?: string) =>
    api.post(`/games/${id}/register`, {
      sourceChannel: "MINI_PROGRAM",
      creationIdempotencyKey,
    }),
  promoteGameWaitlist: (id: string) =>
    api.post(`/games/${id}/promote-waitlist`),
  grantMaturedGameRewards: () => api.post("/games/rewards/grant-matured"),
  events: () => api.get<any[]>("/events"),
  event: (id: string) => api.get<Record<string, any>>(`/events/${id}`),
  createEvent: (data: object) => api.post("/events", data),
  publishEvent: (id: string, data: object = {}) =>
    api.post(`/events/${id}/publish`, data),
  registerEvent: (id: string, data: object) =>
    api.post(`/events/${id}/register`, {
      ...data,
      sourceChannel: "MINI_PROGRAM",
    }),
  trainingProducts: () => api.get<any[]>("/training/products"),
  createTrainingProduct: (data: object) =>
    api.post("/training/products", data),
  createTrainingClass: (data: object) => api.post("/training/classes", data),
  trainingStudents: () => api.get<any[]>("/training/students"),
  createTrainingStudent: (data: object) => api.post("/training/students", data),
  updateTrainingStudent: (studentId: string, data: object) =>
    api.patch(`/training/students/${studentId}`, data),
  trainingEnrollments: () => api.get<any[]>("/training/enrollments"),
  purchaseTraining: (data: object) => api.post("/training/purchase", data),
  createTrainingSession: (data: object) => api.post("/training/sessions", data),
  accountTransactions: () =>
    api.get<any[]>("/members/me/accounts/transactions"),
  referralRewards: () => api.get<any[]>("/referrals/me/rewards"),
  bindReferral: (referrerId: string) =>
    api.post<{ id: string; referrerId: string }>("/members/me/referrer", {
      referrerId,
    }),
  grantMaturedReferralRewards: () =>
    api.post("/referrals/rewards/grant-matured"),
  merchants: () => api.get<any[]>("/alliance/merchants"),
  createMerchant: (data: object) => api.post("/alliance/merchants", data),
  setMerchantStatus: (merchantId: string, data: object) =>
    api.post(`/alliance/merchants/${merchantId}/status`, data),
  couponTemplates: () => api.get<any[]>("/alliance/coupon-templates"),
  createCouponTemplate: (data: object) =>
    api.post("/alliance/coupon-templates", data),
  setCouponTemplateStatus: (templateId: string, data: object) =>
    api.post(`/alliance/coupon-templates/${templateId}/status`, data),
  generateCouponCodes: (templateId: string, data: object) =>
    api.post(`/alliance/coupon-templates/${templateId}/codes`, data),
  claimCoupon: (code: string) => api.post(`/alliance/coupons/${code}/claim`),
  myCoupons: () => api.get<any[]>("/alliance/coupons/me"),
  couponQr: (code: string) =>
    api.get<Record<string, any>>(`/alliance/coupons/${code}/qr`),
  redeemCoupon: (data: object) => api.post("/alliance/coupons/redeem", data),
  createAllianceSettlement: (data: object) =>
    api.post("/alliance/settlements", data),
  allianceSettlements: () => api.get<any[]>("/alliance/settlements"),
  submitAllianceSettlement: (id: string) =>
    api.post(`/alliance/settlements/${id}/submit`),
  confirmAllianceSettlement: (id: string) =>
    api.post(`/alliance/settlements/${id}/confirm`),
  disputeAllianceSettlement: (id: string, data: object) =>
    api.post(`/alliance/settlements/${id}/dispute`, data),
  settleAllianceSettlement: (id: string) =>
    api.post(`/alliance/settlements/${id}/settle`),
  inventory: () => api.get<any[]>("/inventory"),
  lowStock: () => api.get<any[]>("/inventory/low-stock"),
  inventorySuppliers: () => api.get<any[]>("/inventory/suppliers"),
  inventoryLocations: () => api.get<any[]>("/inventory/locations"),
  purchaseOrders: () => api.get<any[]>("/inventory/purchase-orders"),
  createPurchaseOrder: (data: object) =>
    api.post("/inventory/purchase-orders", data),
  submitPurchaseOrder: (id: string) =>
    api.post(`/inventory/purchase-orders/${id}/submit`),
  approvePurchaseOrder: (id: string) =>
    api.post(`/inventory/purchase-orders/${id}/approve`),
  receivePurchaseOrder: (id: string, data: object) =>
    api.post(`/inventory/purchase-orders/${id}/receive`, data),
  cancelPurchaseOrder: (id: string, reason: string) =>
    api.post(`/inventory/purchase-orders/${id}/cancel`, { reason }),
  stocktakes: () => api.get<any[]>("/inventory/stocktakes"),
  createStocktake: (data: object) => api.post("/inventory/stocktakes", data),
  startStocktake: (id: string) => api.post(`/inventory/stocktakes/${id}/start`),
  countStocktakeLine: (id: string, lineId: string, countedQuantity: number) =>
    api.post(`/inventory/stocktakes/${id}/lines/${lineId}/count`, {
      countedQuantity,
    }),
  submitStocktake: (id: string) =>
    api.post(`/inventory/stocktakes/${id}/submit`),
  postStocktake: (id: string, idempotencyKey: string) =>
    api.post(`/inventory/stocktakes/${id}/post`, { idempotencyKey }),
  inventoryOperations: () => api.get<any[]>("/inventory/operations"),
  createInventoryOperation: (data: object) =>
    api.post("/inventory/operations", data),
  submitInventoryOperation: (id: string) =>
    api.post(`/inventory/operations/${id}/submit`),
  approveInventoryOperation: (id: string) =>
    api.post(`/inventory/operations/${id}/approve`),
  postInventoryOperation: (id: string, idempotencyKey: string) =>
    api.post(`/inventory/operations/${id}/post`, { idempotencyKey }),
  cancelInventoryOperation: (id: string, reason: string) =>
    api.post(`/inventory/operations/${id}/cancel`, { reason }),
  adminOrders: () =>
    api.get<{ items: any[]; total: number }>("/orders/admin/all"),
  currentFrontDeskShift: () => api.get<any>("/operations/shifts/current"),
  frontDeskShiftHistory: (params: Record<string, any> = {}) =>
    api.get<any[]>("/operations/shifts/history", params),
  openFrontDeskShift: (openingCashCents: number) =>
    api.post("/operations/shifts/open", { openingCashCents }),
  closeFrontDeskShift: (id: string, data: object) =>
    api.post(`/operations/shifts/${id}/close`, data),
  reviewFrontDeskShiftVariance: (id: string, data: object) =>
    api.post(`/operations/shifts/${id}/review-variance`, data),
  adminEnrollments: () => api.get<any[]>("/training/admin/enrollments"),
  hostedGames: () => api.get<any[]>("/games/hosted/me"),
  checkInVenueOrder: (orderId: string) =>
    api.post(`/venues/orders/${orderId}/check-in`),
  checkInGame: (gameId: string, userId: string) =>
    api.post(`/games/${gameId}/check-in/${userId}`),
  completeGame: (gameId: string) => api.post(`/games/${gameId}/complete`),
  members: () => api.get<any>("/members"),
  member360: (id: string) => api.get<any>(`/members/${id}/360`),
  customerLeads: (params: Record<string, any> = {}) =>
    api.get<any>("/members/leads", params),
  createCustomerLead: (data: object) => api.post("/members/leads", data),
  claimCustomerLead: (id: string) => api.post(`/members/leads/${id}/claim`),
  assignCustomerLead: (id: string, ownerId: string) =>
    api.post(`/members/leads/${id}/assign`, { ownerId }),
  followUpCustomerLead: (id: string, data: object) =>
    api.post(`/members/leads/${id}/follow-ups`, data),
  convertCustomerLead: (id: string, memberId: string) =>
    api.post(`/members/leads/${id}/convert`, { memberId }),
  loseCustomerLead: (id: string, reason: string) =>
    api.post(`/members/leads/${id}/lost`, { reason }),
  archiveCustomerLead: (id: string, reason: string) =>
    api.post(`/members/leads/${id}/archive`, { reason }),
  accountAdjustments: (status = "REQUESTED") =>
    api.get<any[]>("/members/account-adjustments", { status }),
  createAccountAdjustment: (memberId: string, data: object) =>
    api.post(`/members/${memberId}/accounts/adjust`, data),
  approveAccountAdjustment: (requestId: string, reason: string) =>
    api.post(`/members/account-adjustments/${requestId}/approve`, { reason }),
  rejectAccountAdjustment: (requestId: string, reason: string) =>
    api.post(`/members/account-adjustments/${requestId}/reject`, { reason }),
  trainingFinancials: (periodStart: string, periodEnd: string) =>
    api.get<any>("/training/financial-summary", { periodStart, periodEnd }),
  trainingSettlements: (params: Record<string, any> = {}) =>
    api.get<any[]>("/training/settlements", params),
  createTrainingSettlement: (data: object) =>
    api.post("/training/settlements", data),
  submitTrainingSettlement: (id: string, data: object = {}) =>
    api.post(`/training/settlements/${id}/submit`, data),
  confirmTrainingSettlement: (id: string, data: object = {}) =>
    api.post(`/training/settlements/${id}/confirm`, data),
  settleTrainingSettlement: (id: string, data: object = {}) =>
    api.post(`/training/settlements/${id}/settle`, data),
  returnTrainingSettlement: (id: string, data: object) =>
    api.post(`/training/settlements/${id}/return`, data),
  voidTrainingSettlement: (id: string, data: object) =>
    api.post(`/training/settlements/${id}/void`, data),
  consumeTraining: (sessionId: string, data: object) =>
    api.post(`/training/sessions/${sessionId}/consume`, data),
  confirmTrainingConsume: (sessionId: string, data: object) =>
    api.post(`/training/sessions/${sessionId}/consume/confirm`, data),
  trainingConsumeCorrections: () =>
    api.get<any[]>("/training/consume-corrections"),
  requestTrainingConsumeCorrection: (data: object) =>
    api.post("/training/consume-corrections", data),
  approveTrainingConsumeCorrection: (id: string, data: object) =>
    api.post(`/training/consume-corrections/${id}/approve`, data),
  rejectTrainingConsumeCorrection: (id: string, data: object) =>
    api.post(`/training/consume-corrections/${id}/reject`, data),
  markTrainingAttendance: (sessionId: string, data: object) =>
    api.post(`/training/sessions/${sessionId}/attendance`, data),
  scheduleTrainingMakeup: (sessionId: string, data: object) =>
    api.post(`/training/sessions/${sessionId}/attendance/makeup`, data),
  completeTrainingSession: (sessionId: string) =>
    api.post(`/training/sessions/${sessionId}/complete`),
  trainingSessions: () => api.get<any[]>("/training/sessions"),
  nextEventRound: (eventId: string) =>
    api.post(`/events/${eventId}/rounds/next`),
  scoreEventMatch: (matchId: string, scoreA: number, scoreB: number) =>
    api.post(`/events/matches/${matchId}/score`, { scoreA, scoreB }),
  correctEventScore: (matchId: string, data: object) =>
    api.post(`/events/matches/${matchId}/correct`, data),
  checkInEventTeam: (eventId: string, teamId: string) =>
    api.post(`/events/${eventId}/teams/${teamId}/check-in`),
  finishEvent: (eventId: string) => api.post(`/events/${eventId}/finish`),
  eventPrizes: (eventId: string) => api.get<any[]>(`/events/${eventId}/prizes`),
  issueEventPrize: (eventId: string, data: object) =>
    api.post(`/events/${eventId}/prizes`, data),
  receiveEventPrize: (eventId: string, awardId: string, data: object) =>
    api.post(`/events/${eventId}/prizes/${awardId}/receive`, data),
  inventoryTransaction: (itemId: string, data: object) =>
    api.post(`/inventory/${itemId}/transactions`, data),
  membershipProducts: () => api.get<any[]>("/memberships/products"),
  purchaseMembership: (productId: string, creationIdempotencyKey?: string) =>
    api.post("/memberships/purchase", { productId, creationIdempotencyKey }),
  recharge: (
    principalCents: number,
    giftCents = 0,
    creationIdempotencyKey?: string,
  ) =>
    api.post("/memberships/recharge", {
      principalCents,
      giftCents,
      creationIdempotencyKey,
    }),
  goods: () => api.get<any[]>("/goods"),
  createGoodsOrder: (
    items: Array<{ itemId: string; quantity: number }>,
    creationIdempotencyKey?: string,
  ) => api.post("/goods/orders", { items, creationIdempotencyKey }),
  parameters: (params: Record<string, any> = {}) =>
    api.get<any[]>("/parameters", params),
  createParameter: (data: object) => api.post("/parameters", data),
  auditLogs: (params: Record<string, any> = {}) =>
    api.get<any>("/audit-logs", params),
  governanceUsers: (params: Record<string, any> = {}) =>
    api.get<any>("/governance/users", params),
  setGovernanceUserRoles: (id: string, data: object) =>
    api.post(`/governance/users/${id}/roles`, data),
  setGovernanceUserStatus: (id: string, data: object) =>
    api.post(`/governance/users/${id}/status`, data),
  riskEvents: (params: Record<string, any> = {}) =>
    api.get<any>("/governance/risk-events", params),
  transitionRiskEvent: (
    id: string,
    action: "review" | "resolve" | "dismiss",
    data: object,
  ) => api.post(`/governance/risk-events/${id}/${action}`, data),
  downloadReport: (scope: string) => download(`/reports/exports/${scope}.xlsx`),
};
