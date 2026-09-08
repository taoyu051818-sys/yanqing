import { BadRequestException } from '@nestjs/common'
import type { BossActivity } from '@yanqing/shared'
export const DAY = 86_400_000
export const venueDay = (date = new Date()) =>
  new Date(date.getTime() + 8 * 3_600_000).toISOString().slice(0, 10)
export function dayRange(value = venueDay(), now = new Date()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value))
    throw new BadRequestException('日期格式应为 YYYY-MM-DD')
  const start = new Date(value + 'T00:00:00+08:00')
  if (
    !Number.isFinite(start.getTime()) ||
    venueDay(start) !== value ||
    value > venueDay(now) ||
    start.getTime() <
      new Date(venueDay(now) + 'T00:00:00+08:00').getTime() - 90 * DAY
  )
    throw new BadRequestException('仅支持今天及过去90天的有效日期')
  return { date: value, start, end: new Date(start.getTime() + DAY) }
}
type Interval = { startsAt: Date; endsAt: Date }
export function coveredMinutes(
  intervals: Interval[],
  start: number,
  end: number,
) {
  const clipped = intervals
    .map((i) => [
      Math.max(start, +new Date(i.startsAt)),
      Math.min(end, +new Date(i.endsAt)),
    ])
    .filter((i) => i[1] > i[0])
    .sort((a, b) => a[0] - b[0])
  let total = 0,
    until = start
  for (const [a, b] of clipped) {
    total += Math.max(0, b - Math.max(a, until))
    until = Math.max(until, b)
  }
  return total / 60000
}
export function utilization(
  courts: { id: string; createdAt?: Date }[],
  slots: {
    id: string
    label: string
    startMinutes: number
    endMinutes: number
  }[],
  bookings: Array<Interval & { courtId: string; status: string }>,
  closures: Array<Interval & { courtId: string }>,
  start: Date,
) {
  // De-duplicate overlapping closures and bookings before calculating capacity.
  const rows = slots.map((slot) => {
    const a = +start + slot.startMinutes * 60000,
      b = +start + slot.endMinutes * 60000
    let availableMinutes = 0,
      occupiedMinutes = 0
    for (const court of courts) {
      const courtStart = Math.max(
        a,
        court.createdAt ? +new Date(court.createdAt) : a,
      )
      if (courtStart >= b) continue
      const closed = closures.filter((i) => i.courtId === court.id)
      const booked = bookings.filter(
        (i) =>
          i.courtId === court.id &&
          ['CONFIRMED', 'CHECKED_IN', 'COMPLETED'].includes(i.status),
      )
      const closedMinutes = coveredMinutes(closed, courtStart, b)
      availableMinutes += (b - courtStart) / 60000 - closedMinutes
      occupiedMinutes +=
        coveredMinutes([...closed, ...booked], courtStart, b) - closedMinutes
    }
    return {
      id: slot.id,
      label: slot.label,
      startMinutes: slot.startMinutes,
      endMinutes: slot.endMinutes,
      availableMinutes,
      occupiedMinutes,
      emptyMinutes: availableMinutes - occupiedMinutes,
      utilizationRate: availableMinutes
        ? Math.round((occupiedMinutes / availableMinutes) * 10000) / 100
        : null,
    }
  })
  const availableMinutes = rows.reduce((sum, r) => sum + r.availableMinutes, 0),
    occupiedMinutes = rows.reduce((sum, r) => sum + r.occupiedMinutes, 0)
  return {
    availableMinutes,
    occupiedMinutes,
    utilizationRate: availableMinutes
      ? Math.round((occupiedMinutes / availableMinutes) * 10000) / 100
      : null,
    slots: rows,
    emptiestSlots: rows
      .filter((r) => r.availableMinutes > 0)
      .sort(
        (a, b) =>
          b.emptyMinutes - a.emptyMinutes || a.startMinutes - b.startMinutes,
      )
      .slice(0, 3),
  }
}
export function activitySummary(
  value: any,
  kind: 'GAME' | 'EVENT',
): BossActivity<Date> {
  const size = kind === 'EVENT' ? 2 : 1
  const entries = kind === 'EVENT' ? value.teams : value.registrations
  const usable = (entries || []).filter(
    (r: any) =>
      ['REGISTERED', 'PAID', 'CHECKED_IN', 'COMPLETED'].includes(r.status) &&
      !['CANCELLED', 'REFUNDED'].includes(r.order?.status),
  )
  const confirmed = usable.filter((r: any) =>
    ['PAID', 'CHECKED_IN', 'COMPLETED'].includes(r.status),
  )
  const held = usable.filter((r: any) => r.status === 'REGISTERED')
  const capacity = kind === 'EVENT' ? value.capacityPeople : value.capacity
  return {
    id: value.id,
    kind,
    name: value.name || value.title,
    status: value.status,
    startsAt: value.startsAt,
    registrationEndsAt: value.registrationEndsAt || value.startsAt,
    capacityPeople: capacity,
    confirmedPeople: confirmed.length * size,
    unpaidPeople: held.length * size,
    reservedPeople: usable.length * size,
    remainingPeople: Math.max(0, capacity - usable.length * size),
    waitlistPeople:
      (entries || []).filter((r: any) => r.status === 'WAITLISTED').length *
      size,
    collectedCents: (entries || []).reduce(
      (sum: number, r: any) =>
        sum +
        Math.max(0, (r.order?.paidCents || 0) - (r.order?.refundedCents || 0)),
      0,
    ),
  }
}
export interface Candidate {
  key: string
  ruleCode: string
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'
  objectType: string
  objectId?: string
  orderId?: string
  summary: string
  evidence: Record<string, any>
}
export const defaultThresholds = {
  largeOrderCents: 100000,
  largeRechargeCents: 200000,
  frequentRefundCount: 3,
  paymentStuckMinutes: 10,
  overdueOrderMinutes: 30,
  lowUtilizationPercent: 20,
  nearFullPercent: 90,
  lowSignupPercent: 30,
  signupLeadHours: 24,
}
export function detectEvents(input: {
  now: Date
  orders: any[]
  payments: any[]
  refunds: any[]
  bookings: any[]
  activities: ReturnType<typeof activitySummary>[]
  history: ReturnType<typeof utilization>[]
  thresholds: typeof defaultThresholds
}) {
  const {
      now,
      orders,
      payments,
      refunds,
      bookings,
      activities,
      history,
      thresholds: t,
    } = input,
    day = venueDay(now),
    result: Candidate[] = []
  for (const o of orders) {
    const amount =
      o.businessType === 'RECHARGE' ? t.largeRechargeCents : t.largeOrderCents
    // Large recharge means received money, not merely a newly created unpaid request.
    if (o.paidAt && +new Date(o.paidAt) >= +now - DAY && o.paidCents >= amount)
      result.push({
        key: `large:${o.id}`,
        ruleCode:
          o.businessType === 'RECHARGE'
            ? 'BOSS_LARGE_RECHARGE'
            : 'BOSS_LARGE_ORDER',
        severity: 'LOW',
        objectType: 'Order',
        objectId: o.id,
        orderId: o.id,
        summary:
          o.businessType === 'RECHARGE' ? '大额充值已到账' : '大额订单已付款',
        evidence: {
          paidCents: o.paidCents,
          thresholdCents: amount,
          paidAt: o.paidAt,
        },
      })
    if (
      o.status === 'PENDING' &&
      +new Date(o.createdAt) <= +now - t.overdueOrderMinutes * 60000
    )
      result.push({
        key: `pending:${day}:${o.id}`,
        ruleCode: 'BOSS_OVERDUE_PENDING',
        severity: 'MEDIUM',
        objectType: 'Order',
        objectId: o.id,
        orderId: o.id,
        summary: '待支付订单长时间未处理',
        evidence: {
          createdAt: o.createdAt,
          thresholdMinutes: t.overdueOrderMinutes,
          payableCents: o.payableCents,
        },
      })
  }
  for (const p of payments) {
    if (
      p.status === 'FAILED' ||
      (['CREATED', 'PROCESSING'].includes(p.status) &&
        +new Date(p.createdAt) <= +now - t.paymentStuckMinutes * 60000)
    )
      result.push({
        key: `payment:${p.id}`,
        ruleCode: 'BOSS_PAYMENT_EXCEPTION',
        severity: 'HIGH',
        objectType: 'Payment',
        objectId: p.id,
        orderId: p.orderId,
        summary:
          p.status === 'FAILED' ? '支付失败需核对' : '支付结果长时间未确认',
        evidence: {
          status: p.status,
          amountCents: p.amountCents,
          createdAt: p.createdAt,
          thresholdMinutes: t.paymentStuckMinutes,
        },
      })
  }
  const recent = refunds.filter(
    (r) =>
      r.status === 'SUCCEEDED' &&
      r.completedAt &&
      +new Date(r.completedAt) >= +now - DAY,
  )
  if (recent.length >= t.frequentRefundCount)
    result.push({
      key: `refunds:${day}`,
      ruleCode: 'BOSS_FREQUENT_REFUNDS',
      severity: 'MEDIUM',
      objectType: 'BusinessDay',
      objectId: day,
      summary: '24小时内出现多笔退款',
      evidence: {
        count: recent.length,
        amountCents: recent.reduce((s, r) => s + r.amountCents, 0),
        threshold: t.frequentRefundCount,
        windowHours: 24,
      },
    })
  for (const a of activities) {
    const deadline = +new Date(a.registrationEndsAt)
    if (
      !['OPEN', 'FULL'].includes(a.status) ||
      deadline <= +now ||
      +new Date(a.startsAt) <= +now ||
      !a.capacityPeople
    )
      continue
    if ((a.reservedPeople / a.capacityPeople) * 100 >= t.nearFullPercent)
      result.push({
        key: `nearfull:${day}:${a.kind}:${a.id}`,
        ruleCode: 'BOSS_ACTIVITY_NEAR_FULL',
        severity: 'LOW',
        objectType: a.kind === 'EVENT' ? 'Event' : 'Game',
        objectId: a.id,
        summary: '活动名额即将报满',
        evidence: {
          name: a.name,
          reservedPeople: a.reservedPeople,
          remainingPeople: a.remainingPeople,
          unpaidPeople: a.unpaidPeople,
          thresholdPercent: t.nearFullPercent,
        },
      })
    if (
      deadline - +now <= t.signupLeadHours * 3600000 &&
      (a.confirmedPeople / a.capacityPeople) * 100 < t.lowSignupPercent
    )
      result.push({
        key: `lowsignup:${day}:${a.kind}:${a.id}`,
        ruleCode: 'BOSS_ACTIVITY_LOW_SIGNUP',
        severity: 'MEDIUM',
        objectType: a.kind === 'EVENT' ? 'Event' : 'Game',
        objectId: a.id,
        summary: '活动临近截止但确认报名不足',
        evidence: {
          name: a.name,
          confirmedPeople: a.confirmedPeople,
          unpaidPeople: a.unpaidPeople,
          capacityPeople: a.capacityPeople,
          registrationEndsAt: a.registrationEndsAt,
          thresholdPercent: t.lowSignupPercent,
        },
      })
  }
  if (history.length >= 3) {
    for (const slot of history[0].slots) {
      const samples = history
        .map((h) => h.slots.find((r) => r.id === slot.id))
        .filter(
          (r) => r && r.availableMinutes > 0,
        ) as (typeof history)[0]['slots']
      const available = samples.reduce((s, r) => s + r.availableMinutes, 0),
        occupied = samples.reduce((s, r) => s + r.occupiedMinutes, 0)
      if (
        samples.length >= 3 &&
        available &&
        (occupied / available) * 100 < t.lowUtilizationPercent
      )
        result.push({
          key: `idle:${day}:${slot.id}`,
          ruleCode: 'BOSS_PERSISTENT_EMPTY_SLOT',
          severity: 'LOW',
          objectType: 'TimeSlot',
          objectId: slot.id,
          summary: '近期该时段场地使用率偏低',
          evidence: {
            label: slot.label,
            days: samples.length,
            utilizationRate: Math.round((occupied / available) * 10000) / 100,
            thresholdPercent: t.lowUtilizationPercent,
          },
        })
    }
  }
  const active = bookings
    .filter(
      (b) =>
        ['CONFIRMED', 'CHECKED_IN', 'COMPLETED'].includes(b.status) ||
        (b.status === 'HELD' &&
          b.holdExpiresAt &&
          +new Date(b.holdExpiresAt) > +now),
    )
    .sort((a, b) => +new Date(a.startsAt) - +new Date(b.startsAt))
  for (let i = 0; i < active.length; i++)
    for (
      let j = i + 1;
      j < active.length &&
      +new Date(active[j].startsAt) < +new Date(active[i].endsAt);
      j++
    ) {
      const a = active[i],
        b = active[j]
      if (a.courtId !== b.courtId) continue
      const ids = [a.id, b.id].sort()
      result.push({
        key: `conflict:${ids.join(':')}`,
        ruleCode: 'BOSS_COURT_CONFLICT',
        severity: 'CRITICAL',
        objectType: 'Court',
        objectId: a.courtId,
        summary: '同一场地存在重叠占用记录',
        evidence: {
          bookingIds: ids,
          orderIds: [a.orderId, b.orderId].filter(Boolean),
          startsAt: a.startsAt,
          endsAt: a.endsAt,
        },
      })
    }
  return result
}
