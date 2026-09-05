// A single deadline policy is used by projection, payment and the expiry worker.
// Venue/event retain their domain reservation deadlines. Other unpaid purchases
// have a 15-minute window; no entitlement or inventory is granted before payment.
export const PURCHASE_HOLD_MS = 15 * 60 * 1000
export const DIRECT_CANCEL_TYPES = ['VENUE', 'GAME', 'TRAINING', 'MEMBERSHIP', 'RECHARGE', 'GOODS']
export const PURCHASE_TIMEOUT_TYPES = ['GAME', 'TRAINING', 'MEMBERSHIP', 'RECHARGE', 'GOODS']

export function pendingPaymentDeadline(order: Record<string, any>): Date | null {
  if (order.status !== 'PENDING') return null
  const domain = order.bookings?.[0]?.holdExpiresAt
    || order.eventTeam?.paymentDueAt || order.trainingEnrollment?.seatReservedUntil
  if (domain) return new Date(domain)
  if (!PURCHASE_TIMEOUT_TYPES.includes(order.businessType) || !order.createdAt) return null
  const created = new Date(order.createdAt).getTime()
  return Number.isFinite(created) ? new Date(created + PURCHASE_HOLD_MS) : null
}
