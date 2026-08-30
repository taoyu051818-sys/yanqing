const cents = (value: unknown) => {
  const parsed = Number(value ?? 0)
  return Number.isSafeInteger(parsed) ? Math.max(0, parsed) : 0
}

export const pendingTrainingRefundCents = (order: Record<string, any>) =>
  (Array.isArray(order.refunds) ? order.refunds : [])
    .filter((refund: Record<string, any>) =>
      ['REQUESTED', 'APPROVED', 'PROCESSING'].includes(String(refund.status)),
    )
    .reduce(
      (total: number, refund: Record<string, any>) =>
        total + cents(refund.amountCents),
      0,
    )

export const trainingRefundLimitCents = (
  enrollment: Record<string, any>,
  order: Record<string, any>,
) => {
  const pendingCents = pendingTrainingRefundCents(order)
  const unusedAfterReservations =
    cents(enrollment.prepaidBalanceCents) - pendingCents
  const orderRemaining =
    cents(order.paidCents ?? order.payableCents) -
    cents(order.refundedCents) -
    pendingCents
  return Math.max(0, Math.min(unusedAfterReservations, orderRemaining))
}

export const parseYuanToCents = (input: unknown): number | null => {
  const normalized = String(input ?? '')
    .trim()
    .replace(/[¥￥,，\s]/g, '')
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) return null
  const [yuan, fraction = ''] = normalized.split('.')
  const result = Number(yuan) * 100 + Number(fraction.padEnd(2, '0'))
  return Number.isSafeInteger(result) && result > 0 ? result : null
}
