import type { EventTeam } from "../page-types";
import type { Ref, ComputedRef } from "vue";
import {
  useOperationTask,
  reasonField,
} from "../../../components/operation-task";
import { endpoints } from "../../../../../services/api";
import { withPendingCreationKey } from "../../../../../utils/pending-creation-key";
import type {
  EventStatus,
  MatchStatus,
  EventMatch,
  EventDetail,
} from "../page-types.js";

interface ActionContext {
  eventDetail: Ref<EventDetail | null, EventDetail | EventDetail | null>;
  showNextRound: ComputedRef<boolean>;
  roundReady: ComputedRef<boolean>;
  currentRound: ComputedRef<number>;
  checkedTeams: ComputedRef<EventTeam[]>;
  runAction: (
    key: string,
    successMessage: string,
    operation: () => Promise<unknown>,
    preferredRound?: number,
  ) => Promise<void>;
  pairingsEditable: ComputedRef<boolean>;
  currentRoundMatches: ComputedRef<EventMatch[]>;
  pairingLeftIndex: Ref<number, number>;
  pairingRightIndex: Ref<number, number>;
  errorMessage: Ref<string, string>;
  task: ReturnType<typeof useOperationTask>;
  load: (
    preferredId?: string,
    preferredRound?: number,
    hydrate?: boolean,
  ) => Promise<void>;
  teams: ComputedRef<EventTeam[]>;
  mayScore: ComputedRef<boolean>;
  SCORE_INPUT_STATUSES: readonly MatchStatus[];
  mayManageEvent: ComputedRef<boolean>;
  TERMINAL_MATCH_STATUSES: readonly MatchStatus[];
  showFinish: ComputedRef<boolean>;
  allRoundsComplete: ComputedRef<boolean>;
  totalRounds: ComputedRef<number>;
}

export function useEventCompetitionActions({
  eventDetail,
  showNextRound,
  roundReady,
  currentRound,
  checkedTeams,
  runAction,
  pairingsEditable,
  currentRoundMatches,
  pairingLeftIndex,
  pairingRightIndex,
  errorMessage,
  task,
  load,
  teams,
  mayScore,
  SCORE_INPUT_STATUSES,
  mayManageEvent,
  TERMINAL_MATCH_STATUSES,
  showFinish,
  allRoundsComplete,
  totalRounds,
}: ActionContext) {
  async function nextRound() {
    const event = eventDetail.value;
    if (!event || !showNextRound.value || !roundReady.value) return;
    const next = currentRound.value + 1;
    const modal = await uni.showModal({
      title: `生成第 ${next} 轮`,
      content:
        currentRound.value === 0
          ? `已签到 ${checkedTeams.value.length} 队，确认锁定名单并生成首轮瑞士制对阵？`
          : `确认第 ${currentRound.value} 轮比分已锁定，并生成下一轮对阵？`,
    });
    if (!modal.confirm) return;
    await runAction(`round:${event.id}`, `第 ${next} 轮已生成`, () =>
      endpoints.nextEventRound(event.id),
    );
  }

  function correctPairings() {
    const event = eventDetail.value;
    if (!event || !pairingsEditable.value) return;
    const left = currentRoundMatches.value[Number(pairingLeftIndex.value)],
      right = currentRoundMatches.value[Number(pairingRightIndex.value)];
    if (!left || !right || left.id === right.id) {
      errorMessage.value = "请选择两场不同的对阵";
      return;
    }
    const round = currentRound.value;
    const pairings = currentRoundMatches.value.map((match) => ({
      teamAId: match.teamAId,
      teamBId:
        (match.id === left.id
          ? right.teamBId
          : match.id === right.id
            ? left.teamBId
            : match.teamBId) || undefined,
      courtLabel: match.courtLabel || undefined,
    }));
    task.start({
      title: "调整本轮配对",
      description:
        teamName(left.teamAId) +
        " 的对手与 " +
        teamName(right.teamAId) +
        " 的对手互换。服务器重新核验队伍冲突，不改已录比分。",
      confirmText: "确认交换对手",
      fields: [reasonField("异常原因与调整依据")],
      submit: async ({ reason }) => {
        await withPendingCreationKey(
          "event.correct-pairings",
          { eventId: event.id, round, pairings, reason },
          (idempotencyKey) =>
            endpoints.correctEventPairings(event.id, round, {
              pairings,
              reason,
              idempotencyKey,
            }),
        );
        await load(event.id, round, false);
        return "本轮配对已调整，修改记录可追溯。";
      },
    });
  }

  function parseScore(
    raw: unknown,
    match: EventMatch,
  ): [number, number] | null {
    const found = String(raw || "")
      .trim()
      .match(/^(\d{1,2})\s*[:：/\-]\s*(\d{1,2})$/);
    if (!found) return null;
    const scoreA = Number(found[1]);
    const scoreB = Number(found[2]);
    if (
      !Number.isInteger(scoreA) ||
      !Number.isInteger(scoreB) ||
      scoreA < match.startingScoreA ||
      scoreB < match.startingScoreB ||
      scoreA > 21 ||
      scoreB > 21 ||
      scoreA === scoreB ||
      Math.max(scoreA, scoreB) !== 21
    )
      return null;
    return [scoreA, scoreB];
  }

  function teamName(teamId: string | null) {
    if (!teamId) return "轮空";
    return teams.value.find((team) => team.id === teamId)?.name || "未命名队伍";
  }

  function canSubmitScore(match: EventMatch) {
    return Boolean(
      mayScore.value &&
      eventDetail.value?.status === "IN_PROGRESS" &&
      SCORE_INPUT_STATUSES.includes(match.status),
    );
  }

  function canCorrectScore(match: EventMatch) {
    return Boolean(
      mayManageEvent.value &&
      eventDetail.value?.status === "IN_PROGRESS" &&
      match.teamBId &&
      TERMINAL_MATCH_STATUSES.includes(match.status),
    );
  }

  function score(match: EventMatch) {
    if (canSubmitScore(match)) openScoreTask(match, false);
  }

  function correctScore(match: EventMatch) {
    if (canCorrectScore(match)) openScoreTask(match, true);
  }

  function openScoreTask(match: EventMatch, correction: boolean) {
    const eventId = eventDetail.value!.id;
    task.start({
      title: correction ? "纠正比赛比分" : "录入比赛比分",
      description:
        teamName(match.teamAId) +
        " 对 " +
        teamName(match.teamBId) +
        " · " +
        (correction
          ? "原比分 " + match.scoreA + ":" + match.scoreB + "，更正须留痕。"
          : "一局21分结束，不得并列，最终分数不能低于让分。"),
      confirmText: correction ? "确认更正并留痕" : "确认提交比分",
      fields: [
        {
          key: "scoreA",
          label: teamName(match.teamAId) + " 最终得分",
          kind: "number",
          min: match.startingScoreA,
          max: 21,
          initial: correction ? String(match.scoreA) : "",
        },
        {
          key: "scoreB",
          label: teamName(match.teamBId) + " 最终得分",
          kind: "number",
          min: match.startingScoreB,
          max: 21,
          initial: correction ? String(match.scoreB) : "",
        },
        ...(correction ? [reasonField("纠错依据")] : []),
      ],
      submit: async (values) => {
        const parsed = parseScore(values.scoreA + ":" + values.scoreB, match);
        if (!parsed)
          throw new Error("比分须以21分结束、不得并列且不能低于让分");
        const [scoreA, scoreB] = parsed;
        if (correction && scoreA === match.scoreA && scoreB === match.scoreB)
          throw new Error("纠正后比分与原比分相同");
        if (correction)
          await endpoints.correctEventScore(match.id, {
            scoreA,
            scoreB,
            reason: values.reason,
          });
        else await endpoints.scoreEventMatch(match.id, scoreA, scoreB);
        await load(eventId, match.round, false);
        return correction
          ? "比分已纠正，排名已重新计算，修改历史保留。"
          : "比分已提交，状态与排名已同步。";
      },
    });
  }

  async function finishEvent() {
    const event = eventDetail.value;
    if (!event || !showFinish.value || !allRoundsComplete.value) return;
    const modal = await uni.showModal({
      title: "完成赛事",
      content: "确认五轮比分均已复核？完成后将生成最终排名并发放赛事积分。",
    });
    if (!modal.confirm) return;
    await runAction(
      `finish:${event.id}`,
      "赛事已完成",
      () => endpoints.finishEvent(event.id),
      totalRounds.value,
    );
  }
  return {
    nextRound,
    correctPairings,
    parseScore,
    teamName,
    canSubmitScore,
    canCorrectScore,
    score,
    correctScore,
    openScoreTask,
    finishEvent,
  };
}
