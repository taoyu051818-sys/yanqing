import { describe, expect, it } from 'vitest'

import {
  adjustIsolatedAccount,
  buildSwissPairings,
  calculateRoi,
  EVENT_GAME_POINT_CAP,
  resolveEffectiveParameter,
  startingScoreFor,
  SWISS_TOTAL_ROUNDS,
  summarizeTrainingFinancials,
  trainingContractContributionCents,
  transitionCoupon,
  eventPointsForRank,
  validateDirectReferral,
  validateEventScore,
  validateSwissRound,
} from './domain.js'

describe('training contract hard constraints', () => {
  it('puts 20% of 100000 yuan into venue contract revenue and never charges venue fee', () => {
    const summary = summarizeTrainingFinancials({
      confirmedRevenueCents: 10_000_000,
      coachCostCents: 2_000_000,
      assistantCostCents: 200_000,
      materialCostCents: 300_000,
      acquisitionCostCents: 100_000,
      marketingCostCents: 100_000,
      occupiedCourtHours: 200,
    })

    expect(summary.venueContractContributionCents).toBe(2_000_000)
    expect(summary.venueFeeCents).toBe(0)
    expect(summary.trainingPayableFromVenueCents).toBe(0)
    expect(summary.cashContributionMarginCents).toBe(7_300_000)
  })

  it('rounds basis-point contribution in integer cents', () => {
    expect(trainingContractContributionCents(101, 2_000)).toBe(20)
  })
})

describe('isolated accounts and one-level referrals', () => {
  it('only changes the selected account', () => {
    const accounts = [
      { type: 'CASH_PRINCIPAL' as const, balance: 1_000 },
      { type: 'GIFT_BALANCE' as const, balance: 500 },
      { type: 'BADMINTON_COIN' as const, balance: 300 },
      { type: 'EVENT_POINTS' as const, balance: 20 },
      { type: 'GROWTH_POINTS' as const, balance: 80 },
    ]
    const next = adjustIsolatedAccount(accounts, 'BADMINTON_COIN', -100)
    expect(next.find((account) => account.type === 'BADMINTON_COIN')?.balance).toBe(200)
    expect(next.find((account) => account.type === 'CASH_PRINCIPAL')?.balance).toBe(1_000)
  })

  it('rejects self referral and rebinding', () => {
    expect(() =>
      validateDirectReferral({ userId: 'U1', requestedReferrerId: 'U1' }),
    ).toThrow('self-referral')
    expect(() =>
      validateDirectReferral({
        userId: 'U1',
        requestedReferrerId: 'U3',
        existingReferrerId: 'U2',
      }),
    ).toThrow('immutable')
  })
})

describe('coupon, tournament and effective parameters', () => {
  it('prevents duplicate coupon redemption', () => {
    expect(transitionCoupon('CLAIMED', 'REDEEMED')).toBe('REDEEMED')
    expect(() => transitionCoupon('REDEEMED', 'REDEEMED')).toThrow()
  })

  it('applies the documented doubles handicaps', () => {
    expect([
      startingScoreFor('MEN_DOUBLES', 'MEN_DOUBLES'),
      startingScoreFor('MEN_DOUBLES', 'WOMEN_DOUBLES'),
      startingScoreFor('MEN_DOUBLES', 'MIXED_DOUBLES'),
    ]).toEqual([
      [0, 0],
      [0, 5],
      [0, 2],
    ])
    expect([
      startingScoreFor('WOMEN_DOUBLES', 'MEN_DOUBLES'),
      startingScoreFor('WOMEN_DOUBLES', 'WOMEN_DOUBLES'),
      startingScoreFor('WOMEN_DOUBLES', 'MIXED_DOUBLES'),
    ]).toEqual([
      [5, 0],
      [0, 0],
      [2, 0],
    ])
    expect([
      startingScoreFor('MIXED_DOUBLES', 'MEN_DOUBLES'),
      startingScoreFor('MIXED_DOUBLES', 'WOMEN_DOUBLES'),
      startingScoreFor('MIXED_DOUBLES', 'MIXED_DOUBLES'),
    ]).toEqual([
      [2, 0],
      [0, 2],
      [0, 0],
    ])
    expect(() => startingScoreFor('INVALID' as never, 'MEN_DOUBLES')).toThrow(
      'invalid team category',
    )
  })

  it('validates a single game to 21 without deuce extension', () => {
    expect(EVENT_GAME_POINT_CAP).toBe(21)
    expect(() => validateEventScore(21, 0)).not.toThrow()
    expect(() => validateEventScore(21, 20)).not.toThrow()
    expect(() => validateEventScore(20, 21)).not.toThrow()
    expect(() => validateEventScore(20, 20)).toThrow('tie')
    expect(() => validateEventScore(20, 19)).toThrow('exactly 21')
    expect(() => validateEventScore(22, 20)).toThrow()
    expect(() => validateEventScore(21, 1, 0, 2)).toThrow('starting score')
    expect(() => validateEventScore(21, 2, 0, 2)).not.toThrow()
  })

  it('avoids repeat opponents when an alternative exists', () => {
    const pairings = buildSwissPairings([
      { id: 'A', points: 2, scoreDiff: 8, wins: 2, seed: 1, opponents: ['B'] },
      { id: 'B', points: 2, scoreDiff: 5, wins: 2, seed: 2, opponents: ['A'] },
      { id: 'C', points: 1, scoreDiff: 1, wins: 1, seed: 3, opponents: ['D'] },
      { id: 'D', points: 1, scoreDiff: -2, wins: 1, seed: 4, opponents: ['C'] },
    ])
    expect(pairings[0]).toEqual({ pairAId: 'A', pairBId: 'C', isBye: false })
  })

  it('enforces the five-round Swiss invariant', () => {
    expect(SWISS_TOTAL_ROUNDS).toBe(5)
    expect(validateSwissRound(1)).toBe(1)
    expect(validateSwissRound(5)).toBe(5)
    expect(() => validateSwissRound(0)).toThrow('between 1 and 5')
    expect(() => validateSwissRound(6)).toThrow('between 1 and 5')

    const fourRounds = ['B', 'C', 'D', 'E']
    expect(() =>
      buildSwissPairings([
        { id: 'A', points: 4, scoreDiff: 20, wins: 4, seed: 1, opponents: fourRounds },
        { id: 'F', points: 0, scoreDiff: -20, wins: 0, seed: 6, opponents: ['C', 'D', 'E', 'B'] },
      ]),
    ).not.toThrow()

    const fiveRounds = [...fourRounds, 'F']
    expect(() =>
      buildSwissPairings([
        { id: 'A', points: 5, scoreDiff: 25, wins: 5, seed: 1, opponents: fiveRounds },
        { id: 'G', points: 0, scoreDiff: -25, wins: 0, seed: 7, opponents: ['B', 'C', 'D', 'E', 'F'] },
      ]),
    ).toThrow('between 1 and 5')
  })

  it('rejects out-of-sync histories and duplicate entrants before pairing', () => {
    expect(() =>
      buildSwissPairings([
        { id: 'A', points: 1, scoreDiff: 1, wins: 1, seed: 1, opponents: ['B'] },
        { id: 'B', points: 0, scoreDiff: -1, wins: 0, seed: 2, opponents: [] },
      ]),
    ).toThrow('same number of Swiss rounds')
    expect(() =>
      buildSwissPairings([
        { id: 'A', points: 0, scoreDiff: 0, wins: 0, seed: 1, opponents: [] },
        { id: 'A', points: 0, scoreDiff: 0, wins: 0, seed: 2, opponents: [] },
      ]),
    ).toThrow('duplicate Swiss pair id')
  })

  it('selects the parameter version effective on the order date', () => {
    expect(
      resolveEffectiveParameter(
        [
          { value: 1_800, effectiveFrom: '2026-01-01', effectiveTo: '2026-08-01' },
          { value: 2_000, effectiveFrom: '2026-08-01' },
        ],
        '2026-08-15',
      ),
    ).toBe(2_000)
  })

  it('awards more long-term points to higher-ranked teams', () => {
    expect(eventPointsForRank(1, 12)).toBe(100)
    expect(eventPointsForRank(12, 12)).toBeLessThan(eventPointsForRank(2, 12))
  })

  it('returns alliance ROI while treating zero cost as not applicable', () => {
    expect(calculateRoi(50_000, 10_000)).toBe(5)
    expect(calculateRoi(50_000, 0)).toBeNull()
  })
})
