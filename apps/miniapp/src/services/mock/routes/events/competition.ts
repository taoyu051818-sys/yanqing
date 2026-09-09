import { mockUser } from "../../core";
import { getOrders, saveOrders } from "../../venue";
import {
  getEventDetail,
  getEvents,
  getAuditLogs,
  recomputeEventStandings,
  saveEventDetail,
  saveAuditLogs,
} from "../../state";
import { ok, requireMockRole, text, newId } from "../../policies/common.js";
import { assertMockOperationWindow } from "../../policies/operation-window.js";
import {
  eventMinimumPeople,
  eventRoundLimit,
  requireEvent,
  eventTeamCommandResponse,
  eventStartingScore,
  buildMockSwissPairings,
} from "../../policies/events.js";
import type { MockRouteResult, MockRouteOptions } from "../route-contract.js";

export async function handleFinishEventPost(
  method: string,
  url: string,
  data: any,
  options: MockRouteOptions,
): Promise<MockRouteResult> {
  const finishEventMatch = url.match(/^\/events\/([^/]+)\/finish$/);
  if (finishEventMatch && method === "POST") {
    requireMockRole("EVENT_MANAGER", "ADMIN", "SUPER_ADMIN");
    const detail = requireEvent(finishEventMatch[1]);
    if (detail.status === "COMPLETED")
      return {
        handled: true,
        value: ok(
          (detail.teams || [])
            .filter((team: any) => team.finalRank)
            .sort((a: any, b: any) => a.finalRank - b.finalRank),
        ),
      };
    if (detail.status !== "IN_PROGRESS")
      throw new Error(`当前赛事状态为 ${detail.status}，不允许完赛`);
    if (Number(detail.currentRound || 0) !== eventRoundLimit(detail))
      throw new Error(`赛事必须完成${eventRoundLimit(detail)}轮后才能完赛`);
    const checkedTeams = (detail.teams || []).filter(
      (team: any) => team.status === "CHECKED_IN",
    );
    if (checkedTeams.length * 2 < eventMinimumPeople(detail))
      throw new Error(
        `签到人数不足${eventMinimumPeople(detail)}人，暂不能完赛`,
      );
    for (let round = 1; round <= eventRoundLimit(detail); round += 1) {
      const roundMatches = (detail.matches || []).filter(
        (match: any) => match.round === round,
      );
      if (
        !roundMatches.length ||
        roundMatches.some(
          (match: any) => !["CONFIRMED", "CORRECTED"].includes(match.status),
        )
      )
        throw new Error(`第${round}轮仍有未确认比分`);
    }
    const ranked = [...checkedTeams].sort(
      (a, b) =>
        Number(b.points || 0) - Number(a.points || 0) ||
        Number(b.scoreDiff || 0) - Number(a.scoreDiff || 0),
    );
    const orders = getOrders();
    if (
      (detail.teams || []).some((team: any) => {
        const order = orders.find((item) => item.id === team.orderId);
        return order?.status === "REFUND_PENDING";
      })
    )
      throw new Error("赛事存在等待退款审批的订单，请先处理退款后再完赛");
    const completedAt = new Date().toISOString();
    ranked.forEach((team, index) => {
      team.finalRank = index + 1;
      team.eventPointsAwarded = Math.max(1, ranked.length - index);
      team.status = "COMPLETED";
      const order = orders.find((item) => item.id === team.orderId);
      if (order && !["REFUNDED", "CANCELLED"].includes(order.status)) {
        order.completedAt = order.completedAt || completedAt;
        order.fulfillmentOutcome = "COMPLETED";
        if (!["REFUND_PENDING", "PARTIALLY_REFUNDED"].includes(order.status))
          order.status = "COMPLETED";
      }
    });
    (detail.teams || []).forEach((team: any) => {
      if (ranked.some((rankedTeam: any) => rankedTeam.id === team.id)) return;
      const previousStatus = team.status;
      const order = orders.find((item) => item.id === team.orderId);
      if (
        previousStatus === "PAID" &&
        (!order ||
          !["REFUND_PENDING", "REFUNDED", "CANCELLED"].includes(order.status))
      ) {
        team.status = "NO_SHOW";
        if (order) {
          order.completedAt = order.completedAt || completedAt;
          order.fulfillmentOutcome = "NO_SHOW";
          if (!["REFUND_PENDING", "PARTIALLY_REFUNDED"].includes(order.status))
            order.status = "COMPLETED";
        }
      } else if (["REGISTERED", "WAITLISTED"].includes(previousStatus)) {
        team.status = "CANCELLED";
        if (previousStatus === "REGISTERED" && order?.status === "PENDING") {
          order.status = "CANCELLED";
          order.cancelledAt = completedAt;
        }
      }
    });
    detail.status = "COMPLETED";
    detail.completedAt = detail.completedAt || completedAt;
    saveOrders(orders);
    saveEventDetail(detail);
    return { handled: true, value: ok(ranked) };
  }
  return { handled: false };
}

export async function handleNextEventRoundPost(
  method: string,
  url: string,
  data: any,
  options: MockRouteOptions,
): Promise<MockRouteResult> {
  const nextEventRoundMatch = url.match(/^\/events\/([^/]+)\/rounds\/next$/);
  if (nextEventRoundMatch && method === "POST") {
    requireMockRole("EVENT_MANAGER", "ADMIN", "SUPER_ADMIN");
    const detail = requireEvent(nextEventRoundMatch[1]);
    const nextRound = Number(detail.currentRound || 0) + 1;
    if (!["OPEN", "FULL", "IN_PROGRESS"].includes(detail.status))
      throw new Error(`当前赛事状态为 ${detail.status}，不允许生成下一轮配对`);
    if (nextRound > eventRoundLimit(detail))
      throw new Error("所有轮次已经完成");
    const teams = (detail.teams || []).filter(
      (team: any) => team.status === "CHECKED_IN",
    );
    if (teams.length * 2 < eventMinimumPeople(detail))
      throw new Error(
        `签到人数不足${eventMinimumPeople(detail)}人，暂不能开赛`,
      );
    if (nextRound > 1) {
      const previous = (detail.matches || []).filter(
        (match: any) => match.round === nextRound - 1,
      );
      if (
        !previous.length ||
        previous.some(
          (match: any) => !["CONFIRMED", "CORRECTED"].includes(match.status),
        )
      )
        throw new Error(`第${nextRound - 1}轮仍有未确认比分`);
    }
    if ((detail.matches || []).some((match: any) => match.round === nextRound))
      throw new Error(`第${nextRound}轮配对已经生成，请勿重复操作`);
    const pairMatches = buildMockSwissPairings(teams, nextRound).map(
      ({ teamA, teamB }, index) => {
        if (!teamB) {
          teamA.points = Number(teamA.points || 0) + 1;
          teamA.wins = Number(teamA.wins || 0) + 1;
          teamA.opponents = [...(teamA.opponents || []), "BYE"];
          return {
            id: newId(`match-${nextRound}`),
            round: nextRound,
            teamAId: teamA.id,
            teamBId: null,
            status: "CONFIRMED",
            courtLabel: "轮空",
            startingScoreA: 0,
            startingScoreB: 0,
            scoreA: 21,
            scoreB: 0,
          };
        }
        const [startingScoreA, startingScoreB] = eventStartingScore(
          teamA.category,
          teamB.category,
        );
        return {
          id: newId(`match-${nextRound}`),
          round: nextRound,
          teamAId: teamA.id,
          teamBId: teamB.id,
          status: "PENDING",
          courtLabel: `${index + 1}号场`,
          startingScoreA,
          startingScoreB,
          scoreA: null,
          scoreB: null,
        };
      },
    );
    detail.currentRound = nextRound;
    detail.status = "IN_PROGRESS";
    detail.matches = [...(detail.matches || []), ...pairMatches];
    saveEventDetail(detail);
    return { handled: true, value: ok(pairMatches) };
  }
  return { handled: false };
}

export async function handleCorrectEventPairingsPost(
  method: string,
  url: string,
  data: any,
  options: MockRouteOptions,
): Promise<MockRouteResult> {
  const correctEventPairingsMatch = url.match(
    /^\/events\/([^/]+)\/rounds\/(\d+)\/pairings\/correct$/,
  );
  if (correctEventPairingsMatch && method === "POST") {
    requireMockRole("EVENT_MANAGER", "ADMIN", "SUPER_ADMIN");
    const detail = requireEvent(correctEventPairingsMatch[1]);
    const round = Number(correctEventPairingsMatch[2]);
    const reason = text(data.reason);
    const idempotencyKey = text(data.idempotencyKey);
    if (reason.length < 2)
      throw new Error("人工调整配对必须填写至少2个字的原因");
    if (idempotencyKey.length < 8 || idempotencyKey.length > 100)
      throw new Error("配对调整幂等键长度必须为8-100个字符");
    const requested = Array.isArray(data.pairings)
      ? data.pairings.map((pairing: any, index: number) => ({
          teamAId: text(pairing.teamAId),
          teamBId: text(pairing.teamBId) || null,
          courtLabel:
            text(pairing.courtLabel) ||
            (text(pairing.teamBId) ? `${index + 1}号场` : "轮空"),
        }))
      : [];
    const command = JSON.stringify({
      eventId: detail.id,
      round,
      reason,
      pairings: requested,
    });
    const requestId = `EVENT_PAIRINGS:${idempotencyKey}`;
    const replay = getAuditLogs().find(
      (item) =>
        item.requestId === requestId &&
        item.action === "EVENT_PAIRINGS_CORRECTED",
    );
    if (replay) {
      if (replay.newValue?.command !== command)
        throw new Error("配对调整幂等键已用于其他指令，请更换幂等键");
      return {
        handled: true,
        value: ok(
          (detail.matches || []).filter((match: any) => match.round === round),
        ),
      };
    }
    if (
      detail.status !== "IN_PROGRESS" ||
      Number(detail.currentRound || 0) !== round
    )
      throw new Error("只能调整当前进行中轮次的配对");
    const current = (detail.matches || []).filter(
      (match: any) => match.round === round,
    );
    if (!current.length) throw new Error(`第${round}轮尚未生成配对`);
    if (
      current.some(
        (match: any) =>
          match.teamBId &&
          (match.status !== "PENDING" ||
            match.scoreA !== null ||
            match.scoreB !== null),
      )
    )
      throw new Error("本轮已有比分或已进入确认流程，不能再调整配对");
    const teams = (detail.teams || []).filter(
      (team: any) => team.status === "CHECKED_IN",
    );
    const allowed = new Set(teams.map((team: any) => team.id));
    const seen = new Set<string>();
    let byeCount = 0;
    requested.forEach((pairing: any) => {
      if (!allowed.has(pairing.teamAId) || seen.has(pairing.teamAId))
        throw new Error("人工配对包含重复或无效队伍");
      seen.add(pairing.teamAId);
      if (!pairing.teamBId) {
        byeCount += 1;
        return;
      }
      if (
        !allowed.has(pairing.teamBId) ||
        seen.has(pairing.teamBId) ||
        pairing.teamAId === pairing.teamBId
      )
        throw new Error("人工配对包含重复或无效队伍");
      seen.add(pairing.teamBId);
    });
    if (seen.size !== teams.length || byeCount !== teams.length % 2)
      throw new Error("人工配对必须完整覆盖本轮全部签到队伍");
    const signature = (items: any[]) =>
      JSON.stringify(
        items
          .map((item) => ({
            teamAId: item.teamAId,
            teamBId: item.teamBId || null,
            courtLabel: item.courtLabel || null,
          }))
          .sort((left, right) =>
            `${left.teamAId}:${left.teamBId || ""}`.localeCompare(
              `${right.teamAId}:${right.teamBId || ""}`,
            ),
          ),
      );
    if (signature(current) === signature(requested))
      throw new Error("人工调整后的配对与当前配对相同");
    const byId = new Map(teams.map((team: any) => [team.id, team]));
    const corrected = requested.map((pairing: any) => {
      const teamA: any = byId.get(pairing.teamAId);
      const teamB: any = pairing.teamBId ? byId.get(pairing.teamBId) : null;
      const [startingScoreA, startingScoreB] = teamB
        ? eventStartingScore(teamA.category, teamB.category)
        : [0, 0];
      return {
        id: newId(`match-${round}`),
        round,
        teamAId: teamA.id,
        teamBId: teamB?.id || null,
        status: teamB ? "PENDING" : "CONFIRMED",
        courtLabel: pairing.courtLabel,
        startingScoreA,
        startingScoreB,
        scoreA: teamB ? null : 21,
        scoreB: teamB ? null : 0,
      };
    });
    detail.matches = [
      ...(detail.matches || []).filter((match: any) => match.round !== round),
      ...corrected,
    ];
    saveEventDetail(recomputeEventStandings(detail));
    saveAuditLogs([
      {
        id: newId("audit"),
        actorId: mockUser().id,
        actor: { id: mockUser().id, displayName: mockUser().displayName },
        actorRole: mockUser().primaryRole,
        action: "EVENT_PAIRINGS_CORRECTED",
        objectType: "Event",
        objectId: detail.id,
        reason,
        requestId,
        result: "SUCCESS",
        oldValue: { round, pairings: current },
        newValue: { round, pairings: requested, command },
        createdAt: new Date().toISOString(),
      },
      ...getAuditLogs(),
    ]);
    return { handled: true, value: ok(corrected) };
  }
  return { handled: false };
}

export async function handleEventCheckInPost(
  method: string,
  url: string,
  data: any,
  options: MockRouteOptions,
): Promise<MockRouteResult> {
  const eventCheckInMatch = url.match(
    /^\/events\/([^/]+)\/teams\/([^/]+)\/check-in$/,
  );
  if (eventCheckInMatch && method === "POST") {
    requireMockRole("EVENT_MANAGER", "FRONT_DESK", "ADMIN", "SUPER_ADMIN");
    const detail = requireEvent(eventCheckInMatch[1]);
    const team = (detail.teams || []).find(
      (item: any) => item.id === eventCheckInMatch[2],
    );
    if (!team) throw new Error("参赛组合不存在");
    if (team.status === "CHECKED_IN")
      return { handled: true, value: ok(eventTeamCommandResponse(team)) };
    if (
      !["OPEN", "FULL"].includes(detail.status) ||
      Number(detail.currentRound || 0) !== 0
    )
      throw new Error("当前赛事状态不允许签到");
    if (team.status !== "PAID") throw new Error("参赛报名尚未支付");
    if (team.cancellationPending)
      throw new Error("该报名正在等待退款审批，暂不可签到");
    const teamOrder = getOrders().find((order) => order.id === team.orderId);
    if (teamOrder?.status === "REFUND_PENDING")
      throw new Error("该报名正在等待退款审批，暂不可签到");
    const timeWindowPolicy = assertMockOperationWindow({
      parameterKey: "operations.event_check_in_window.v1",
      defaults: { earlyMinutes: 30, lateMinutes: 30 },
      startsAt: detail.startsAt,
      endsAt: detail.startsAt,
      action: "EVENT_TEAM_CHECK_IN",
      objectType: "EventTeam",
      objectId: team.id,
      overrideReason: data.overrideReason,
    });
    team.status = "CHECKED_IN";
    team.checkedInAt = new Date().toISOString();
    team.checkInTimeWindowPolicy = timeWindowPolicy;
    saveEventDetail(detail);
    return { handled: true, value: ok(eventTeamCommandResponse(team)) };
  }
  return { handled: false };
}

export async function handleScoreEventPost(
  method: string,
  url: string,
  data: any,
  options: MockRouteOptions,
): Promise<MockRouteResult> {
  const scoreEventMatch = url.match(/^\/events\/matches\/([^/]+)\/score$/);
  if (scoreEventMatch && method === "POST") {
    requireMockRole("EVENT_MANAGER", "FRONT_DESK", "ADMIN", "SUPER_ADMIN");
    const details = getEvents().map((item) => getEventDetail(item.id));
    const detail = details.find((item) =>
      (item.matches || []).some(
        (match: any) => match.id === scoreEventMatch[1],
      ),
    );
    const match = detail?.matches?.find(
      (item: any) => item.id === scoreEventMatch[1],
    );
    const scoreA = Number(data.scoreA);
    const scoreB = Number(data.scoreB);
    if (!match) throw new Error("比赛不存在");
    if (!detail || detail.status !== "IN_PROGRESS")
      throw new Error("当前赛事不在进行中");
    if (Number(match.round) !== Number(detail.currentRound || 0))
      throw new Error("只能录入当前轮比分");
    if (
      !Number.isInteger(scoreA) ||
      !Number.isInteger(scoreB) ||
      scoreA < Number(match.startingScoreA || 0) ||
      scoreB < Number(match.startingScoreB || 0) ||
      scoreA > 21 ||
      scoreB > 21 ||
      scoreA === scoreB ||
      Math.max(scoreA, scoreB) !== 21
    )
      throw new Error("比分必须以21分结束、不得平分且不能低于让分");
    if (match.status === "CONFIRMED" || match.status === "CORRECTED") {
      if (match.scoreA === scoreA && match.scoreB === scoreB)
        return { handled: true, value: ok(match) };
      throw new Error("比分已确认，修正请使用纠错接口");
    }
    Object.assign(match, { scoreA, scoreB, status: "CONFIRMED" });
    const teamA = (detail.teams || []).find(
      (team: any) => team.id === match.teamAId,
    );
    const teamB = (detail.teams || []).find(
      (team: any) => team.id === match.teamBId,
    );
    if (teamA && teamB) {
      teamA.opponents = [...new Set([...(teamA.opponents || []), teamB.id])];
      teamB.opponents = [...new Set([...(teamB.opponents || []), teamA.id])];
    }
    if (detail) saveEventDetail(recomputeEventStandings(detail));
    return {
      handled: true,
      value: ok(match || { id: scoreEventMatch[1], status: "CONFIRMED" }),
    };
  }
  return { handled: false };
}

export async function handleCorrectEventPost(
  method: string,
  url: string,
  data: any,
  options: MockRouteOptions,
): Promise<MockRouteResult> {
  const correctEventMatch = url.match(/^\/events\/matches\/([^/]+)\/correct$/);
  if (correctEventMatch && method === "POST") {
    requireMockRole("EVENT_MANAGER", "ADMIN", "SUPER_ADMIN");
    const details = getEvents().map((item) => getEventDetail(item.id));
    const detail = details.find((item) =>
      (item.matches || []).some(
        (match: any) => match.id === correctEventMatch[1],
      ),
    );
    const match = detail?.matches?.find(
      (item: any) => item.id === correctEventMatch[1],
    );
    if (!match) throw new Error("比赛不存在");
    if (!detail || detail.status !== "IN_PROGRESS")
      throw new Error("当前赛事不在进行中");
    const reason = text(data.reason);
    if (reason.length < 2) throw new Error("纠错必须填写至少2个字的原因");
    const scoreA = Number(data.scoreA);
    const scoreB = Number(data.scoreB);
    if (
      !Number.isInteger(scoreA) ||
      !Number.isInteger(scoreB) ||
      scoreA < Number(match.startingScoreA || 0) ||
      scoreB < Number(match.startingScoreB || 0) ||
      scoreA > 21 ||
      scoreB > 21 ||
      scoreA === scoreB ||
      Math.max(scoreA, scoreB) !== 21
    )
      throw new Error("纠正比分必须以21分结束、不得平分且不能低于让分");
    if (!["CONFIRMED", "CORRECTED"].includes(match.status))
      throw new Error("只有已确认比分才能纠错");
    if (
      match.status === "CORRECTED" &&
      match.scoreA === scoreA &&
      match.scoreB === scoreB &&
      match.correctionReason === reason
    )
      return { handled: true, value: ok(match) };
    Object.assign(match, {
      scoreA,
      scoreB,
      status: "CORRECTED",
      correctionReason: reason,
    });
    if (detail) saveEventDetail(recomputeEventStandings(detail));
    return {
      handled: true,
      value: ok(match || { id: correctEventMatch[1], status: "CORRECTED" }),
    };
  }
  return { handled: false };
}
