import { describe, expect, it } from 'vitest'

import {
  parseYuanToCents,
  pendingTrainingRefundCents,
  trainingRefundLimitCents,
} from './training-refund'

describe('training refund guardrails', () => {
  it('limits a refund to unused prepayment after active reservations', () => {
    const order = {
      paidCents: 198_000,
      refundedCents: 20_000,
      refunds: [
        { status: 'REQUESTED', amountCents: 8_000 },
        { status: 'REJECTED', amountCents: 99_000 },
      ],
    }
    expect(pendingTrainingRefundCents(order)).toBe(8_000)
    expect(
      trainingRefundLimitCents({ prepaidBalanceCents: 90_000 }, order),
    ).toBe(82_000)
  })

  it('also respects the original order remaining amount', () => {
    expect(
      trainingRefundLimitCents(
        { prepaidBalanceCents: 90_000 },
        { paidCents: 100_000, refundedCents: 30_000, refunds: [] },
      ),
    ).toBe(70_000)
  })

  it('parses yuan exactly and rejects invalid or non-positive input', () => {
    expect(parseYuanToCents('¥ 820.05')).toBe(82_005)
    expect(parseYuanToCents('82.005')).toBeNull()
    expect(parseYuanToCents('0')).toBeNull()
  })
})
