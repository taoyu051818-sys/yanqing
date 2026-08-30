export const TRAINING_CONTRACT_RATE_BPS = 2_000 as const
export const TRAINING_VENUE_FEE_CENTS = 0 as const

export type AccountType =
  | 'CASH_PRINCIPAL'
  | 'GIFT_BALANCE'
  | 'BADMINTON_COIN'
  | 'EVENT_POINTS'
  | 'GROWTH_POINTS'

export const ACCOUNT_TYPES: readonly AccountType[] = [
  'CASH_PRINCIPAL',
  'GIFT_BALANCE',
  'BADMINTON_COIN',
  'EVENT_POINTS',
  'GROWTH_POINTS',
] as const

export type AppRole =
  | 'MEMBER'
  | 'FRONT_DESK'
  | 'COACH'
  | 'EVENT_MANAGER'
  | 'HOST'
  | 'MERCHANT'
  | 'FINANCE'
  | 'ADMIN'
  | 'SUPER_ADMIN'

export type BusinessType =
  | 'VENUE'
  | 'GAME'
  | 'EVENT'
  | 'TRAINING'
  | 'GOODS'
  | 'MEMBERSHIP'
  | 'RECHARGE'
  | 'ALLIANCE'

export type SubjectAccount = 'VENUE' | 'TRAINING'

export interface ApiEnvelope<T> {
  code: number
  message: string
  data: T
  requestId?: string
}

export interface PageResult<T> {
  items: T[]
  page: number
  pageSize: number
  total: number
}

export interface TrainingFinancialInput {
  confirmedRevenueCents: number
  coachCostCents: number
  assistantCostCents: number
  materialCostCents: number
  acquisitionCostCents: number
  marketingCostCents: number
  occupiedCourtHours: number
  contractRateBps?: number
}

export interface TrainingFinancialSummary {
  effectiveRevenueCents: number
  contractRateBps: number
  venueContractContributionCents: number
  venueFeeCents: 0
  directCostCents: number
  cashContributionMarginCents: number
  occupiedCourtHours: number
  resourceEfficiencyCentsPerCourtHour: number | null
  trainingPayableFromVenueCents: 0
}

const assertInteger = (value: number, field: string) => {
  if (!Number.isSafeInteger(value)) {
    throw new Error(`${field} must be a safe integer`)
  }
}

export const roundHalfUp = (numerator: number, denominator: number): number => {
  if (!Number.isSafeInteger(numerator) || !Number.isSafeInteger(denominator) || denominator <= 0) {
    throw new Error('invalid integer division')
  }
  const sign = numerator < 0 ? -1 : 1
  return sign * Math.floor((Math.abs(numerator) + denominator / 2) / denominator)
}

export const trainingContractContributionCents = (
  effectiveRevenueCents: number,
  rateBps: number = TRAINING_CONTRACT_RATE_BPS,
): number => {
  assertInteger(effectiveRevenueCents, 'effectiveRevenueCents')
  assertInteger(rateBps, 'rateBps')
  if (effectiveRevenueCents < 0) throw new Error('effectiveRevenueCents cannot be negative')
  if (rateBps < 0 || rateBps > 10_000) throw new Error('rateBps must be between 0 and 10000')
  return roundHalfUp(effectiveRevenueCents * rateBps, 10_000)
}

export const summarizeTrainingFinancials = (
  input: TrainingFinancialInput,
): TrainingFinancialSummary => {
  const moneyFields = [
    input.confirmedRevenueCents,
    input.coachCostCents,
    input.assistantCostCents,
    input.materialCostCents,
    input.acquisitionCostCents,
    input.marketingCostCents,
  ]
  moneyFields.forEach((value, index) => {
    assertInteger(value, `moneyFields[${index}]`)
    if (value < 0) throw new Error('training financial values cannot be negative')
  })
  if (!Number.isFinite(input.occupiedCourtHours) || input.occupiedCourtHours < 0) {
    throw new Error('occupiedCourtHours cannot be negative')
  }

  const contractRateBps = input.contractRateBps ?? TRAINING_CONTRACT_RATE_BPS
  const directCostCents =
    input.coachCostCents +
    input.assistantCostCents +
    input.materialCostCents +
    input.acquisitionCostCents +
    input.marketingCostCents
  const cashContributionMarginCents = input.confirmedRevenueCents - directCostCents

  return {
    effectiveRevenueCents: input.confirmedRevenueCents,
    contractRateBps,
    venueContractContributionCents: trainingContractContributionCents(
      input.confirmedRevenueCents,
      contractRateBps,
    ),
    venueFeeCents: TRAINING_VENUE_FEE_CENTS,
    directCostCents,
    cashContributionMarginCents,
    occupiedCourtHours: input.occupiedCourtHours,
    resourceEfficiencyCentsPerCourtHour:
      input.occupiedCourtHours === 0
        ? null
        : Math.round(cashContributionMarginCents / input.occupiedCourtHours),
    trainingPayableFromVenueCents: 0,
  }
}

export interface AccountSnapshot {
  type: AccountType
  balance: number
}

export const adjustIsolatedAccount = (
  accounts: readonly AccountSnapshot[],
  type: AccountType,
  delta: number,
): AccountSnapshot[] => {
  assertInteger(delta, 'delta')
  const existing = accounts.find((account) => account.type === type)
  if (!existing) throw new Error(`account ${type} does not exist`)
  const nextBalance = existing.balance + delta
  if (nextBalance < 0) throw new Error(`insufficient ${type} balance`)
  return accounts.map((account) =>
    account.type === type ? { ...account, balance: nextBalance } : { ...account },
  )
}

export const validateDirectReferral = (input: {
  userId: string
  requestedReferrerId: string
  existingReferrerId?: string | null
}): void => {
  if (!input.requestedReferrerId) throw new Error('referrer is required')
  if (input.userId === input.requestedReferrerId) throw new Error('self-referral is not allowed')
  if (input.existingReferrerId && input.existingReferrerId !== input.requestedReferrerId) {
    throw new Error('direct referrer is immutable after binding')
  }
}

export type CouponCodeStatus = 'ISSUED' | 'CLAIMED' | 'REDEEMED' | 'EXPIRED' | 'VOID'

const COUPON_TRANSITIONS: Record<CouponCodeStatus, readonly CouponCodeStatus[]> = {
  ISSUED: ['CLAIMED', 'EXPIRED', 'VOID'],
  CLAIMED: ['REDEEMED', 'EXPIRED', 'VOID'],
  REDEEMED: [],
  EXPIRED: [],
  VOID: [],
}

export const transitionCoupon = (
  current: CouponCodeStatus,
  next: CouponCodeStatus,
): CouponCodeStatus => {
  if (!COUPON_TRANSITIONS[current].includes(next)) {
    throw new Error(`coupon cannot transition from ${current} to ${next}`)
  }
  return next
}

export type TeamCategory = 'MEN_DOUBLES' | 'WOMEN_DOUBLES' | 'MIXED_DOUBLES'

export const EVENT_GAME_POINT_CAP = 21 as const
export const SWISS_TOTAL_ROUNDS = 5 as const

export type SwissRound = 1 | 2 | 3 | 4 | 5

const TEAM_CATEGORIES: readonly TeamCategory[] = [
  'MEN_DOUBLES',
  'WOMEN_DOUBLES',
  'MIXED_DOUBLES',
] as const

const HANDICAP_STARTING_SCORES: Record<
  TeamCategory,
  Record<TeamCategory, readonly [number, number]>
> = {
  MEN_DOUBLES: {
    MEN_DOUBLES: [0, 0],
    WOMEN_DOUBLES: [0, 5],
    MIXED_DOUBLES: [0, 2],
  },
  WOMEN_DOUBLES: {
    MEN_DOUBLES: [5, 0],
    WOMEN_DOUBLES: [0, 0],
    MIXED_DOUBLES: [2, 0],
  },
  MIXED_DOUBLES: {
    MEN_DOUBLES: [2, 0],
    WOMEN_DOUBLES: [0, 2],
    MIXED_DOUBLES: [0, 0],
  },
}

const assertTeamCategory: (category: string) => asserts category is TeamCategory = (category) => {
  if (!TEAM_CATEGORIES.includes(category as TeamCategory)) {
    throw new Error(`invalid team category: ${category}`)
  }
}

export const startingScoreFor = (
  teamA: TeamCategory,
  teamB: TeamCategory,
): readonly [number, number] => {
  assertTeamCategory(teamA)
  assertTeamCategory(teamB)
  return HANDICAP_STARTING_SCORES[teamA][teamB]
}

export const validateEventScore = (
  scoreA: number,
  scoreB: number,
  startingScoreA = 0,
  startingScoreB = 0,
): void => {
  assertInteger(scoreA, 'scoreA')
  assertInteger(scoreB, 'scoreB')
  assertInteger(startingScoreA, 'startingScoreA')
  assertInteger(startingScoreB, 'startingScoreB')
  if (
    startingScoreA < 0 ||
    startingScoreB < 0 ||
    startingScoreA > EVENT_GAME_POINT_CAP ||
    startingScoreB > EVENT_GAME_POINT_CAP
  ) {
    throw new Error(`starting score must be between 0 and ${EVENT_GAME_POINT_CAP}`)
  }
  if (
    scoreA < startingScoreA ||
    scoreB < startingScoreB ||
    scoreA > EVENT_GAME_POINT_CAP ||
    scoreB > EVENT_GAME_POINT_CAP
  ) {
    throw new Error(
      `score must be between its starting score and ${EVENT_GAME_POINT_CAP}`,
    )
  }
  if (scoreA === scoreB) throw new Error('event match cannot end in a tie')
  if (Math.max(scoreA, scoreB) !== EVENT_GAME_POINT_CAP) {
    throw new Error(`winner must reach exactly ${EVENT_GAME_POINT_CAP} points`)
  }
}

export interface SwissPairState {
  id: string
  points: number
  scoreDiff: number
  wins: number
  seed: number
  opponents: readonly string[]
  checkedIn?: boolean
}

export interface SwissPairing {
  pairAId: string
  pairBId: string | null
  isBye: boolean
}

export const validateSwissRound = (round: number): SwissRound => {
  assertInteger(round, 'round')
  if (round < 1 || round > SWISS_TOTAL_ROUNDS) {
    throw new Error(`Swiss round must be between 1 and ${SWISS_TOTAL_ROUNDS}`)
  }
  return round as SwissRound
}

export const rankSwissPairs = <T extends SwissPairState>(pairs: readonly T[]): T[] =>
  [...pairs].sort(
    (a, b) =>
      b.points - a.points ||
      b.scoreDiff - a.scoreDiff ||
      b.wins - a.wins ||
      a.seed - b.seed ||
      a.id.localeCompare(b.id),
  )

const completedSwissRounds = (pairs: readonly SwissPairState[]): number => {
  const completedRounds = new Set(pairs.map((pair) => pair.opponents.length))
  if (completedRounds.size > 1) {
    throw new Error('all checked-in pairs must have completed the same number of Swiss rounds')
  }
  return completedRounds.values().next().value ?? 0
}

const assertUniqueSwissPairIds = (pairs: readonly SwissPairState[]): void => {
  const ids = new Set<string>()
  for (const pair of pairs) {
    if (!pair.id) throw new Error('Swiss pair id is required')
    if (ids.has(pair.id)) throw new Error(`duplicate Swiss pair id: ${pair.id}`)
    ids.add(pair.id)
    if (pair.opponents.includes(pair.id)) {
      throw new Error(`Swiss pair ${pair.id} cannot be its own opponent`)
    }
  }
}

const findNonRepeatPairings = (
  pool: readonly SwissPairState[],
): SwissPairing[] | undefined => {
  if (pool.length === 0) return []

  const [pairA, ...remaining] = pool
  for (let index = 0; index < remaining.length; index += 1) {
    const pairB = remaining[index]
    if (pairA.opponents.includes(pairB.id) || pairB.opponents.includes(pairA.id)) continue

    const rest = [...remaining.slice(0, index), ...remaining.slice(index + 1)]
    const subsequent = findNonRepeatPairings(rest)
    if (subsequent) {
      return [
        { pairAId: pairA.id, pairBId: pairB.id, isBye: false },
        ...subsequent,
      ]
    }
  }

  return undefined
}

export const buildSwissPairings = (pairs: readonly SwissPairState[]): SwissPairing[] => {
  const pool = rankSwissPairs(pairs.filter((pair) => pair.checkedIn !== false))
  const pairings: SwissPairing[] = []

  assertUniqueSwissPairIds(pool)
  const nextRound = completedSwissRounds(pool) + 1
  validateSwissRound(nextRound)

  if (pool.length % 2 === 1) {
    let byeIndex = -1
    for (let index = pool.length - 1; index >= 0; index -= 1) {
      if (!pool[index].opponents.includes('BYE')) {
        byeIndex = index
        break
      }
    }
    if (byeIndex < 0) byeIndex = pool.length - 1
    const [bye] = pool.splice(byeIndex, 1)
    pairings.push({ pairAId: bye.id, pairBId: null, isBye: true })
  }

  const nonRepeatPairings = findNonRepeatPairings(pool)
  if (nonRepeatPairings) return [...pairings, ...nonRepeatPairings]

  while (pool.length > 0) {
    const pairA = pool.shift()
    if (!pairA) break
    let candidateIndex = pool.findIndex((candidate) => !pairA.opponents.includes(candidate.id))
    if (candidateIndex < 0) candidateIndex = 0
    const [pairB] = pool.splice(candidateIndex, 1)
    pairings.push({ pairAId: pairA.id, pairBId: pairB.id, isBye: false })
  }

  return pairings
}

export const eventPointsForRank = (rank: number, totalTeams: number): number => {
  assertInteger(rank, 'rank')
  assertInteger(totalTeams, 'totalTeams')
  if (rank < 1 || totalTeams < 1 || rank > totalTeams) throw new Error('invalid event rank')
  const percentile = (totalTeams - rank + 1) / totalTeams
  return Math.max(5, Math.round(percentile * 100))
}

export interface EffectiveParameter<T> {
  value: T
  effectiveFrom: Date | string
  effectiveTo?: Date | string | null
}

const asTime = (value: Date | string): number => new Date(value).getTime()

export const resolveEffectiveParameter = <T>(
  parameters: readonly EffectiveParameter<T>[],
  at: Date | string,
): T | undefined => {
  const timestamp = asTime(at)
  return [...parameters]
    .filter(
      (parameter) =>
        asTime(parameter.effectiveFrom) <= timestamp &&
        (!parameter.effectiveTo || asTime(parameter.effectiveTo) > timestamp),
    )
    .sort((a, b) => asTime(b.effectiveFrom) - asTime(a.effectiveFrom))[0]?.value
}

export const calculateRoi = (grossProfitCents: number, cooperationCostCents: number): number | null => {
  assertInteger(grossProfitCents, 'grossProfitCents')
  assertInteger(cooperationCostCents, 'cooperationCostCents')
  if (cooperationCostCents === 0) return null
  return Math.round((grossProfitCents / cooperationCostCents) * 10_000) / 10_000
}

export const formatCents = (cents: number): string => {
  assertInteger(cents, 'cents')
  return `¥${(cents / 100).toFixed(2)}`
}
