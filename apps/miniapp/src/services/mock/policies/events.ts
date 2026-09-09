import { mockUser } from "../core";
import { getOrders } from "../venue";
import { getEventDetail, getEvents } from "../state";
import { text, integer, newId } from "./common.js";
import { newOrderNo, mockOrderResponse } from "./orders.js";
import { mockOperatingShareSnapshot } from "./master-data.js";

export const activeTeamStatuses = [
  "REGISTERED",
  "PAID",
  "CHECKED_IN",
  "COMPLETED",
];

export const eventCapacity = (event: any) =>
  integer(event.capacityPeople) && event.capacityPeople > 0
    ? event.capacityPeople
    : 48;

export const eventMinimumPeople = (event: any) =>
  integer(event.minimumPeople) && event.minimumPeople > 0
    ? event.minimumPeople
    : 24;

export const eventRoundLimit = (event: any) =>
  integer(event.totalRounds) && event.totalRounds > 0 ? event.totalRounds : 5;

export const eventPaymentDueAt = (event: any, now = new Date()) =>
  new Date(
    Math.min(
      now.getTime() + 15 * 60_000,
      new Date(event.registrationEndsAt).getTime(),
      new Date(event.startsAt).getTime(),
    ),
  ).toISOString();

export const promoteMockEventWaitlist = (
  detail: any,
  orders: any[],
  now = new Date(),
) => {
  const teams = detail.teams || [];
  let expiredCount = 0;
  teams.forEach((team: any) => {
    if (
      team.status !== "REGISTERED" ||
      !team.paymentDueAt ||
      new Date(team.paymentDueAt) > now
    )
      return;
    const order = orders.find((item) => item.id === team.orderId);
    if (order?.status !== "PENDING") return;
    order.status = "CANCELLED";
    order.cancelledAt = now.toISOString();
    team.status = "CANCELLED";
    team.paymentDueAt = null;
    team.cancelledAt = now.toISOString();
    expiredCount += 1;
  });
  if (
    !["OPEN", "FULL"].includes(detail.status) ||
    new Date(detail.registrationEndsAt) <= now ||
    new Date(detail.startsAt) <= now
  ) {
    return { expiredCount, promotions: [] };
  }

  const capacityTeams = Math.floor(eventCapacity(detail) / 2);
  let seated = teams.filter((team: any) =>
    activeTeamStatuses.includes(team.status),
  ).length;
  const promotions: any[] = [];
  while (seated < capacityTeams) {
    const next = teams
      .filter((team: any) => team.status === "WAITLISTED" && !team.orderId)
      .sort((left: any, right: any) =>
        `${left.waitlistedAt || left.createdAt || ""}:${left.id}`.localeCompare(
          `${right.waitlistedAt || right.createdAt || ""}:${right.id}`,
        ),
      )[0];
    if (!next) break;
    const nowIso = now.toISOString();
    const paymentDueAt = eventPaymentDueAt(detail, now);
    const order = {
      id: newId("order"),
      orderNo: newOrderNo("EV"),
      title: `${detail.name} 报名`,
      status: "PENDING",
      businessType: "EVENT",
      eventId: detail.id,
      eventTeamId: next.id,
      creationIdempotencyKey: `SYSTEM:EVENT_WAITLIST:${next.id}`,
      payableCents: Number(next.payableCents ?? detail.feeCents ?? 0),
      paidCents: 0,
      refundedCents: 0,
      createdAt: nowIso,
      memberId: next.captainId,
      parameterSnapshot: {
        eventId: detail.id,
        eventTeamId: next.id,
        promotedFromWaitlist: true,
        paymentDueAt,
        operatingShare: mockOperatingShareSnapshot("EVENT", now),
      },
    };
    Object.assign(next, {
      status: "REGISTERED",
      orderId: order.id,
      promotedAt: nowIso,
      paymentDueAt,
    });
    orders.unshift(order);
    promotions.push({ order, registration: next });
    seated += 1;
  }
  detail._count = { ...(detail._count || {}), teams: seated };
  detail.status = seated >= capacityTeams ? "FULL" : "OPEN";
  return { expiredCount, promotions };
};

export const requireEvent = (eventId: string) => {
  if (!getEvents().some((event) => event.id === eventId))
    throw new Error("赛事不存在");
  return getEventDetail(eventId);
};

export const PUBLIC_EVENT_STATUSES = [
  "OPEN",
  "FULL",
  "IN_PROGRESS",
  "COMPLETED",
];

export const publicEvent = (event: any) => ({
  id: event.id,
  code: event.code,
  name: event.name,
  startsAt: event.startsAt,
  registrationEndsAt: event.registrationEndsAt,
  status: event.status,
  capacityPeople: event.capacityPeople,
  minimumPeople: event.minimumPeople,
  totalRounds: event.totalRounds,
  currentRound: event.currentRound,
  feeCents: event.feeCents,
  memberFeeCents: event.memberFeeCents ?? null,
  sponsor: event.sponsor ?? null,
});

export const publicEventRegistration = (registration: any, order?: any) => ({
  id: registration.id,
  isCaptain: registration.captainId === mockUser().id,
  name: registration.name,
  playerAName: registration.playerAName,
  playerBName: registration.playerBName,
  category: registration.category,
  status: registration.status,
  paymentDueAt: registration.paymentDueAt,
  waitlistedAt: registration.waitlistedAt,
  promotedAt: registration.promotedAt,
  cancellationPending: Boolean(registration.cancellationPending),
  cancelReason: registration.cancelReason,
  cancelRequestedAt: registration.cancelRequestedAt,
  cancellationResolvedAt: registration.cancellationResolvedAt,
  cancelledAt: registration.cancelledAt,
  checkedInAt: registration.checkedInAt,
  points: registration.points,
  wins: registration.wins,
  losses: registration.losses,
  scoreDiff: registration.scoreDiff,
  finalRank: registration.finalRank,
  eventPointsAwarded: registration.eventPointsAwarded,
  order: order ? mockOrderResponse(order) : null,
});

export const publicEventPrizeAward = (award: any) => ({
  id: award.id,
  awardName: award.awardName,
  finalRank: award.finalRank,
  recipientNames: award.recipientNames,
  quantity: award.quantity,
  status: award.status,
  note: award.note,
  receivedByName: award.receivedByName,
  receiptNote: award.receiptNote,
  issuedAt: award.issuedAt,
  receivedAt: award.receivedAt,
  team: award.team
    ? {
        id: award.team.id,
        name: award.team.name,
        finalRank: award.team.finalRank,
      }
    : undefined,
  inventoryItem: award.inventoryItem
    ? {
        id: award.inventoryItem.id,
        sku: award.inventoryItem.sku,
        name: award.inventoryItem.name,
      }
    : undefined,
  operator: award.operator
    ? { id: award.operator.id, displayName: award.operator.displayName }
    : undefined,
  signedBy: award.signedBy
    ? { id: award.signedBy.id, displayName: award.signedBy.displayName }
    : undefined,
});

export const publicEventDetail = (event: any) => ({
  ...publicEvent(event),
  standings:
    event.status === "COMPLETED"
      ? (event.teams || [])
          .filter(
            (team: any) =>
              team.status === "COMPLETED" && Number(team.finalRank || 0) > 0,
          )
          .sort(
            (left: any, right: any) =>
              Number(left.finalRank) - Number(right.finalRank),
          )
          .map((team: any) => ({
            name: team.name,
            category: team.category,
            points: team.points,
            wins: team.wins,
            losses: team.losses,
            scoreDiff: team.scoreDiff,
            finalRank: team.finalRank,
          }))
      : [],
});

export const eventCommandResponse = (event: any) => ({
  id: event.id,
  code: event.code,
  name: event.name,
  status: event.status,
  startsAt: event.startsAt,
  endsAt: event.endsAt,
  cancelReason: event.cancelReason || null,
  cancelledAt: event.cancelledAt || null,
});

export const eventCancellationResponse = (value: any) => {
  const policy = value.event?.cancelPolicySnapshot || {};
  return {
    event: eventCommandResponse(value.event),
    cancelledPendingOrders: Number(
      value.cancelledPendingOrders ??
        policy.pendingOrders ??
        policy.cancelledPendingOrders ??
        0,
    ),
    cancelledWaitlist: Number(
      value.cancelledWaitlist ??
        policy.waitlistedTeams ??
        policy.cancelledWaitlist ??
        0,
    ),
    refundRequestCount: Number(
      value.refundRequestCount ??
        value.refundRequests?.length ??
        policy.refundRequestCount ??
        0,
    ),
    refundRequestedCents: Number(policy.refundRequestedCents || 0),
    idempotent: Boolean(value.idempotent),
  };
};

export const eventTeamCommandResponse = (team: any) => ({
  id: team.id,
  name: team.name,
  category: team.category,
  status: team.status,
  checkedInAt: team.checkedInAt || null,
  cancellationPending: Boolean(team.cancellationPending),
});

export const managedEventSummary = (event: any) => ({
  ...publicEvent(event),
  cancelReason: event.cancelReason || null,
  cancelledAt: event.cancelledAt || null,
  _count: {
    teams: Number(
      event._count?.teams ??
        (event.teams || []).filter(
          (team: any) => !["CANCELLED", "REFUNDED"].includes(team.status),
        ).length,
    ),
  },
});

export const managedEventDetail = (event: any) => ({
  ...managedEventSummary(event),
  teams: (event.teams || []).map((team: any) => {
    const order =
      team.order || getOrders().find((item: any) => item.id === team.orderId);
    return {
      id: team.id,
      name: team.name,
      playerAName: team.playerAName,
      playerBName: team.playerBName,
      playerAPhone: team.playerAPhone || null,
      playerBPhone: team.playerBPhone || null,
      captainPlays: team.captainPlays !== false,
      category: team.category,
      seed: team.seed,
      status: team.status,
      waitlistedAt: team.waitlistedAt || null,
      promotedAt: team.promotedAt || null,
      paymentDueAt: team.paymentDueAt || null,
      cancelReason: team.cancelReason || null,
      cancelRequestedAt: team.cancelRequestedAt || null,
      cancellationPending: Boolean(team.cancellationPending),
      cancellationResolvedAt: team.cancellationResolvedAt || null,
      cancelledAt: team.cancelledAt || null,
      checkedInAt: team.checkedInAt || null,
      points: Number(team.points || 0),
      wins: Number(team.wins || 0),
      losses: Number(team.losses || 0),
      scoreDiff: Number(team.scoreDiff || 0),
      finalRank: team.finalRank ?? null,
      eventPointsAwarded: Number(team.eventPointsAwarded || 0),
      order: order ? { status: order.status } : null,
    };
  }),
  matches: (event.matches || []).map((match: any) => ({
    id: match.id,
    round: match.round,
    courtLabel: match.courtLabel || null,
    teamAId: match.teamAId,
    teamBId: match.teamBId || null,
    startingScoreA: Number(match.startingScoreA || 0),
    startingScoreB: Number(match.startingScoreB || 0),
    scoreA: match.scoreA ?? null,
    scoreB: match.scoreB ?? null,
    status: match.status,
    correctionReason: match.correctionReason || null,
    submittedAt: match.submittedAt || null,
    confirmedAt: match.confirmedAt || null,
  })),
});

export const eventStartingScore = (
  categoryA: unknown,
  categoryB: unknown,
): [number, number] => {
  const a = text(categoryA) || "MIXED_DOUBLES";
  const b = text(categoryB) || "MIXED_DOUBLES";
  if (a === "MEN_DOUBLES" && b === "WOMEN_DOUBLES") return [0, 5];
  if (a === "WOMEN_DOUBLES" && b === "MEN_DOUBLES") return [5, 0];
  if (a === "MEN_DOUBLES" && b === "MIXED_DOUBLES") return [0, 2];
  if (a === "MIXED_DOUBLES" && b === "MEN_DOUBLES") return [2, 0];
  if (a === "WOMEN_DOUBLES" && b === "MIXED_DOUBLES") return [2, 0];
  if (a === "MIXED_DOUBLES" && b === "WOMEN_DOUBLES") return [0, 2];
  return [0, 0];
};

export const buildMockSwissPairings = (teams: any[], round: number) => {
  const sorted = [...teams].sort(
    (a, b) =>
      Number(b.points || 0) - Number(a.points || 0) ||
      Number(b.scoreDiff || 0) - Number(a.scoreDiff || 0) ||
      String(a.id).localeCompare(String(b.id)),
  );
  // Rotate the lower half after round one.  The small deterministic search
  // below then avoids an opponent that has already appeared in the team's
  // history whenever an alternative is available.
  if (round > 1 && sorted.length > 2) {
    const pivot = Math.ceil(sorted.length / 2);
    const lower = sorted.splice(pivot);
    const shift = (round - 1) % lower.length;
    sorted.push(...lower.slice(shift), ...lower.slice(0, shift));
  }
  const remaining = [...sorted];
  const pairings: any[] = [];
  while (remaining.length) {
    const teamA = remaining.shift();
    let candidateIndex = remaining.findIndex((candidate) => {
      const opponents = Array.isArray(teamA.opponents) ? teamA.opponents : [];
      return (
        !opponents.includes(candidate.id) &&
        !(
          Array.isArray(candidate.opponents) &&
          candidate.opponents.includes(teamA.id)
        )
      );
    });
    if (candidateIndex < 0) candidateIndex = remaining.length ? 0 : -1;
    if (candidateIndex < 0) {
      pairings.push({ teamA, teamB: null });
    } else {
      const [teamB] = remaining.splice(candidateIndex, 1);
      pairings.push({ teamA, teamB });
    }
  }
  return pairings;
};
