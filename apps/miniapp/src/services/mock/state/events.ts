import { events as seedEvents } from "../catalog";
import { type JsonRecord, clone, KEYS, read, write } from "./storage.js";

export const initialRiskEvents = (): JsonRecord[] => [
  {
    id: "risk-mock-1",
    ruleCode: "COUPON_DEVICE_BURST",
    severity: "HIGH",
    status: "OPEN",
    userId: "user-member",
    objectType: "CouponCode",
    objectId: "coupon-1002",
    summary: "同设备短时领取多张联盟券",
    evidence: { deviceClaims: 5 },
    resolvedBy: null,
    resolvedAt: null,
    createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: "risk-mock-2",
    ruleCode: "PAYMENT_CALLBACK_MISMATCH",
    severity: "MEDIUM",
    status: "REVIEWING",
    userId: "user-member",
    orderId: "order-1001",
    objectType: "Payment",
    objectId: "payment-mock",
    summary: "支付回调金额与订单金额不一致",
    evidence: { orderAmountCents: 12000, callbackAmountCents: 11900 },
    resolvedBy: null,
    resolvedAt: null,
    createdAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
  },
];

export function buildEventDetail(eventId: string): JsonRecord {
  const summary =
    getEvents().find((item) => item.id === eventId) || seedEvents[0];
  const fixture = eventId === seedEvents[0]?.id;
  const completedFixture = eventId === seedEvents[1]?.id;
  const teams =
    fixture || completedFixture
      ? Array.from({ length: 12 }, (_, index) => ({
          id: `team-${index + 1}`,
          name: `金羽组合${index + 1}`,
          playerAName: `队员${index * 2 + 1}`,
          playerBName: `队员${index * 2 + 2}`,
          category:
            index % 3 === 0
              ? "MEN_DOUBLES"
              : index % 3 === 1
                ? "WOMEN_DOUBLES"
                : "MIXED_DOUBLES",
          // Keep the fixture at the 24-person start threshold so the event
          // workbench can exercise the full Swiss workflow immediately.
          status: completedFixture ? "COMPLETED" : "CHECKED_IN",
          points: 0,
          wins: 0,
          losses: 0,
          scoreDiff: 0,
          finalRank: completedFixture ? index + 1 : null,
          eventPointsAwarded: completedFixture ? Math.max(1, 12 - index) : 0,
          opponents: [],
        }))
      : [];
  const makeMatch = (
    id: string,
    round: number,
    teamAId: string,
    teamBId: string,
    status: string,
    scoreA: number | null,
    scoreB: number | null,
    startingScoreA = 0,
    startingScoreB = 0,
  ) => ({
    id,
    round,
    teamAId,
    teamBId,
    status,
    courtLabel: `${round}-${id}号场`,
    startingScoreA,
    startingScoreB,
    scoreA,
    scoreB,
  });
  const matches = fixture
    ? [
        makeMatch("match-r1-1", 1, "team-1", "team-3", "CONFIRMED", 21, 18),
        makeMatch(
          "match-r1-2",
          1,
          "team-2",
          "team-4",
          "CONFIRMED",
          21,
          15,
          5,
          0,
        ),
        makeMatch(
          "match-r1-3",
          1,
          "team-5",
          "team-7",
          "CONFIRMED",
          21,
          17,
          5,
          0,
        ),
        makeMatch(
          "match-r1-4",
          1,
          "team-6",
          "team-8",
          "CONFIRMED",
          21,
          16,
          0,
          2,
        ),
        makeMatch(
          "match-r1-5",
          1,
          "team-9",
          "team-11",
          "CONFIRMED",
          21,
          19,
          0,
          2,
        ),
        makeMatch(
          "match-r1-6",
          1,
          "team-10",
          "team-12",
          "CONFIRMED",
          21,
          14,
          0,
          2,
        ),
        makeMatch(
          "match-r2-1",
          2,
          "team-1",
          "team-5",
          "CONFIRMED",
          21,
          16,
          0,
          5,
        ),
        makeMatch(
          "match-r2-2",
          2,
          "team-2",
          "team-6",
          "CONFIRMED",
          21,
          17,
          2,
          0,
        ),
        makeMatch(
          "match-r2-3",
          2,
          "team-3",
          "team-7",
          "CONFIRMED",
          21,
          18,
          2,
          0,
        ),
        makeMatch(
          "match-r2-4",
          2,
          "team-4",
          "team-8",
          "CONFIRMED",
          21,
          15,
          0,
          5,
        ),
        makeMatch(
          "match-r2-5",
          2,
          "team-9",
          "team-10",
          "CONFIRMED",
          21,
          19,
          2,
          0,
        ),
        makeMatch(
          "match-r2-6",
          2,
          "team-11",
          "team-12",
          "PENDING",
          null,
          null,
          2,
          0,
        ),
      ]
    : [];
  return {
    ...clone(summary),
    ...(fixture ? { status: "IN_PROGRESS" } : {}),
    teams,
    matches,
    prizeAwards: [],
  };
}

export function getEvents(): JsonRecord[] {
  return read<JsonRecord[]>(KEYS.events, seedEvents as JsonRecord[]);
}

export function saveEvents(value: JsonRecord[]) {
  return write(KEYS.events, value);
}

export function getEventDetail(eventId: string): JsonRecord {
  const details = read<Record<string, JsonRecord>>(KEYS.eventDetails, {});
  if (!details[eventId]) {
    details[eventId] = buildEventDetail(eventId);
    write(KEYS.eventDetails, details);
  }
  return details[eventId];
}

export function saveEventDetail(value: JsonRecord) {
  const details = read<Record<string, JsonRecord>>(KEYS.eventDetails, {});
  details[value.id] = value;
  write(KEYS.eventDetails, details);
  const summaries = getEvents().map((item) =>
    item.id === value.id
      ? {
          ...item,
          status: value.status,
          currentRound: value.currentRound,
          cancelReason: value.cancelReason,
          cancelPolicySnapshot: value.cancelPolicySnapshot,
          cancelledAt: value.cancelledAt,
          _count: {
            teams: (value.teams || []).filter(
              (team: JsonRecord) =>
                !["CANCELLED", "REFUNDED"].includes(team.status),
            ).length,
          },
        }
      : item,
  );
  saveEvents(summaries);
  return value;
}

export function recomputeEventStandings(detail: JsonRecord) {
  const teams = (detail.teams || []) as JsonRecord[];
  const byId = new Map(teams.map((team) => [team.id, team]));
  teams.forEach((team) => {
    team.points = 0;
    team.wins = 0;
    team.losses = 0;
    team.scoreDiff = 0;
  });
  for (const match of (detail.matches || []) as JsonRecord[]) {
    if (!["CONFIRMED", "CORRECTED"].includes(match.status)) continue;
    const teamA = byId.get(match.teamAId);
    if (!teamA || match.scoreA === null || match.scoreB === null) continue;
    if (!match.teamBId) {
      teamA.points += 1;
      teamA.wins += 1;
      continue;
    }
    const teamB = byId.get(match.teamBId);
    if (!teamB) continue;
    const scoreA = Number(match.scoreA);
    const scoreB = Number(match.scoreB);
    teamA.scoreDiff += scoreA - scoreB;
    teamB.scoreDiff += scoreB - scoreA;
    if (scoreA > scoreB) {
      teamA.points += 1;
      teamA.wins += 1;
      teamB.losses += 1;
    } else {
      teamB.points += 1;
      teamB.wins += 1;
      teamA.losses += 1;
    }
  }
  return detail;
}

export function getEventPartnerInvites(): JsonRecord[] {
  return read<JsonRecord[]>(KEYS.eventPartnerInvites, []);
}

export function saveEventPartnerInvites(value: JsonRecord[]) {
  return write(KEYS.eventPartnerInvites, value);
}

export function getRiskEvents(): JsonRecord[] {
  return read<JsonRecord[]>(KEYS.riskEvents, initialRiskEvents());
}

export function saveRiskEvents(value: JsonRecord[]) {
  return write(KEYS.riskEvents, value);
}
