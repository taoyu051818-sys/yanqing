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

  function canHistoricallyCheckIn(team: EventTeam) {
    return canCheckInTeam(team) && hasAnyRole(["ADMIN", "SUPER_ADMIN"]);
  }

  function checkIn(team: EventTeam, historical = false) {
    const event = eventDetail.value;
    if (!event || !canCheckInTeam(team) || (historical && !canHistoricallyCheckIn(team))) return;
    task.start({
      title: historical ? "历史补录队伍签到" : "确认队伍签到",
      description:
        team.name +
        " · " +
        team.playerAName +
        " / " +
        team.playerBName +
        (historical ? "。仅用于已过签到窗口的补录，服务器将核验权限和时间。" : "。请核对两名选手实际到场，签到时间按当前业务规则核验。"),
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
  return { promoteWaitlist, canCheckInTeam, canHistoricallyCheckIn, checkIn };
}
