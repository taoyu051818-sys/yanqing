type JsonRecord = Record<string, any>

const record = (value: unknown): JsonRecord =>
  value && typeof value === 'object' ? (value as JsonRecord) : {}

const compact = <T extends JsonRecord>(value: T): T => {
  for (const key of Object.keys(value)) {
    if (value[key] === undefined) delete value[key]
  }
  return value
}

const orderItemView = (value: unknown) => {
  const item = record(value)
  return compact({
    id: item.id,
    itemType: item.itemType,
    itemId: item.itemId,
    name: item.name,
    quantity: item.quantity,
    unitPriceCents: item.unitPriceCents,
    amountCents: item.amountCents,
  })
}

const paymentView = (value: unknown) => {
  const payment = record(value)
  return compact({
    id: payment.id,
    paymentNo: payment.paymentNo,
    channel: payment.channel,
    amountCents: payment.amountCents,
    status: payment.status,
    paidAt: payment.paidAt,
    createdAt: payment.createdAt,
    updatedAt: payment.updatedAt,
  })
}

const refundView = (value: unknown) => {
  const refund = record(value)
  return compact({
    id: refund.id,
    refundNo: refund.refundNo,
    amountCents: refund.amountCents,
    reason: refund.reason,
    originalOrderStatus: refund.originalOrderStatus,
    status: refund.status,
    requestedAt: refund.requestedAt,
    approvedAt: refund.approvedAt,
    completedAt: refund.completedAt,
  })
}

const bookingView = (value: unknown) => {
  const booking = record(value)
  const court = record(booking.court)
  return compact({
    id: booking.id,
    status: booking.status,
    startsAt: booking.startsAt,
    endsAt: booking.endsAt,
    checkedInAt: booking.checkedInAt,
    completedAt: booking.completedAt,
    court: court.id
      ? compact({ id: court.id, code: court.code, name: court.name })
      : undefined,
  })
}

const gameRegistrationView = (value: unknown) => {
  const registration = record(value)
  const game = record(registration.game)
  return compact({
    id: registration.id,
    status: registration.status,
    checkedInAt: registration.checkedInAt,
    game: game.id
      ? compact({
          id: game.id,
          code: game.code,
          title: game.title,
          level: game.level,
          status: game.status,
          startsAt: game.startsAt,
          endsAt: game.endsAt,
        })
      : undefined,
  })
}

const eventTeamView = (value: unknown) => {
  const team = record(value)
  const event = record(team.event)
  return compact({
    id: team.id,
    name: team.name,
    category: team.category,
    status: team.status,
    paymentDueAt: team.paymentDueAt,
    event: event.id
      ? compact({
          id: event.id,
          code: event.code,
          name: event.name,
          status: event.status,
          startsAt: event.startsAt,
        })
      : undefined,
  })
}

const trainingEnrollmentView = (value: unknown) => {
  const enrollment = record(value)
  const product = record(enrollment.product)
  const student = record(enrollment.student)
  return compact({
    id: enrollment.id,
    status: enrollment.status,
    totalSessions: enrollment.totalSessions,
    remainingSessions: enrollment.remainingSessions,
    product: product.id
      ? compact({ id: product.id, code: product.code, name: product.name })
      : undefined,
    student: student.id
      ? compact({ id: student.id, name: student.name })
      : undefined,
  })
}

/**
 * HTTP order DTO. Economic and idempotency snapshots remain in PostgreSQL for
 * fulfilment, settlement and audit, but never cross the client boundary.
 */
export const orderResponse = (value: unknown) => {
  const order = record(value)
  const member = record(order.member)
  return compact({
    id: order.id,
    orderNo: order.orderNo,
    businessType: order.businessType,
    subjectAccount: order.subjectAccount,
    paymentChannel: order.paymentChannel,
    sourceChannel: order.sourceChannel,
    status: order.status,
    title: order.title,
    listAmountCents: order.listAmountCents,
    discountCents: order.discountCents,
    payableCents: order.payableCents,
    paidCents: order.paidCents,
    refundedCents: order.refundedCents,
    paidAt: order.paidAt,
    completedAt: order.completedAt,
    cancelledAt: order.cancelledAt,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
    member: member.id
      ? compact({ id: member.id, displayName: member.displayName })
      : undefined,
    items: Array.isArray(order.items)
      ? order.items.map(orderItemView)
      : undefined,
    payments: Array.isArray(order.payments)
      ? order.payments.map(paymentView)
      : undefined,
    refunds: Array.isArray(order.refunds)
      ? order.refunds.map(refundView)
      : undefined,
    bookings: Array.isArray(order.bookings)
      ? order.bookings.map(bookingView)
      : undefined,
    gameRegistration: order.gameRegistration
      ? gameRegistrationView(order.gameRegistration)
      : undefined,
    eventTeam: order.eventTeam ? eventTeamView(order.eventTeam) : undefined,
    trainingEnrollment: order.trainingEnrollment
      ? trainingEnrollmentView(order.trainingEnrollment)
      : undefined,
  })
}
