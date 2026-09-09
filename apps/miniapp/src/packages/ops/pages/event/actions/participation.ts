import type { Ref, ComputedRef } from "vue";
import {
  useOperationTask,
  reasonField,
} from "../../../components/operation-task";
import { endpoints } from "../../../../../services/api";
import type { AppRole } from "../../../../../types/domain";
import type {
  EventStatus,
  MatchStatus,
  EventTeam,
  EventDetail,
} from "../page-types.js";

interface ActionContext {
  eventDetail: Ref<EventDetail | null, EventDetail | EventDetail | null>;
  showPromoteWaitlist: ComputedRef<boolean>;
  runAction: (
    key: string,
    successMessage: string,
    operation: () => Promise<unknown>,
    preferredRound?: number,
  ) => Promise<void>;
  hasAnyRole: (roles: readonly AppRole[]) => boolean;
  SCORE_ROLES: readonly AppRole[];
  currentRound: ComputedRef<number>;
  errorMessage: Ref<string, string>;
  task: ReturnType<typeof useOperationTask>;
  load: (
    preferredId?: string,
    preferredRound?: number,
    hydrate?: boolean,
  ) => Promise<void>;
}

export function useEventParticipationActions({
  eventDetail,
  showPromoteWaitlist,
  runAction,
  hasAnyRole,
  SCORE_ROLES,
  currentRound,
  errorMessage,
  task,
  load,
}: ActionContext) {
  async function promoteWaitlist() {
    const event = eventDetail.value;
    if (!event || !showPromoteWaitlist.value) return;
    await runAction(`promote:${event.id}`, "候补与超时席位已重新核算", () =>
      endpoints.promoteEventWaitlist(event.id),
    );
  }

  function canCheckInTeam(team: EventTeam) {
    const event = eventDetail.value;
    return Boolean(
      event &&
      hasAnyRole(SCORE_ROLES) &&
      ["OPEN", "FULL"].includes(event.status) &&
      currentRound.value === 0 &&
      team.status === "PAID" &&
      !team.cancellationPending &&
      team.order?.status !== "REFUND_PENDING",
    );
  }

  function checkIn(team: EventTeam) {
    const event = eventDetail.value;
    if (!event || !canCheckInTeam(team)) return;
    const start = new Date(event.startsAt || "").getTime(),
      historical = Date.now() > start + 30 * 60000;
    if (
      Date.now() < start - 30 * 60000 ||
      (historical && !hasAnyRole(["ADMIN", "SUPER_ADMIN"]))
    ) {
      errorMessage.value = "当前不在签到窗口，请核对时间或联系管理员。";
      return;
    }
    task.start({
      title: historical ? "历史补录队伍签到" : "确认队伍签到",
      description:
        team.name +
        " · " +
        team.playerAName +
        " / " +
        team.playerBName +
        "。请核对两名选手实际到场。",
      confirmText: "确认队伍到场",
      fields: historical ? [reasonField("历史补录依据")] : [],
      submit: async ({ reason }) => {
        await endpoints.checkInEventTeam(
          event.id,
          team.id,
          historical ? { overrideReason: reason } : {},
        );
        await load(event.id);
        return "队伍签到已记录，重复签到会被阻止。";
      },
    });
  }
  return { promoteWaitlist, canCheckInTeam, checkIn };
}
