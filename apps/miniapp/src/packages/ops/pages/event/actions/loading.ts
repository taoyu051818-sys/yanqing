import type { Ref, ComputedRef } from "vue";
import { nextTick } from "vue";
import { endpoints } from "../../../../../services/api";
import type { useSessionStore } from "../../../../../stores/session";
import {
  findOpsDeepLinkRecord,
  opsDeepLinkDomId,
  type OpsDeepLinkQuery,
} from "../../../../../utils/work-item-deep-link";
import type {
  EventStatus,
  MatchStatus,
  EventSummary,
  EventDetail,
  InventoryItem,
  EventPrizeAward,
} from "../page-types.js";

interface ActionContext {
  selectedEventId: Ref<string, string>;
  loading: Ref<boolean, boolean>;
  errorMessage: Ref<string, string>;
  session: ReturnType<typeof useSessionStore>;
  mayViewEvent: ComputedRef<boolean>;
  eventList: Ref<
    {
      id: string;
      code?: string | undefined;
      name: string;
      status: EventStatus;
      startsAt?: string | undefined;
      minimumPeople?: number | undefined;
      capacityPeople?: number | undefined;
      totalRounds?: number | undefined;
      currentRound?: number | undefined;
      _count?: { teams?: number | undefined } | undefined;
    }[],
    | EventSummary[]
    | {
        id: string;
        code?: string | undefined;
        name: string;
        status: EventStatus;
        startsAt?: string | undefined;
        minimumPeople?: number | undefined;
        capacityPeople?: number | undefined;
        totalRounds?: number | undefined;
        currentRound?: number | undefined;
        _count?: { teams?: number | undefined } | undefined;
      }[]
  >;
  eventDetail: Ref<
    {
      teams?:
        | {
            id: string;
            name: string;
            playerAName: string;
            playerBName: string;
            playerAPhone?: string | null | undefined;
            playerBPhone?: string | null | undefined;
            captainPlays?: boolean | undefined;
            status: string;
            category?: string | undefined;
            points?: number | undefined;
            wins?: number | undefined;
            losses?: number | undefined;
            scoreDiff?: number | undefined;
            finalRank?: number | null | undefined;
            paymentDueAt?: string | null | undefined;
            waitlistedAt?: string | null | undefined;
            cancelReason?: string | null | undefined;
            cancelRequestedAt?: string | null | undefined;
            cancellationPending?: boolean | undefined;
            cancellationResolvedAt?: string | null | undefined;
            order?: { status?: string | undefined } | null | undefined;
          }[]
        | undefined;
      matches?:
        | {
            id: string;
            round: number;
            courtLabel?: string | null | undefined;
            teamAId: string;
            teamBId: string | null;
            startingScoreA: number;
            startingScoreB: number;
            scoreA: number | null;
            scoreB: number | null;
            status: MatchStatus;
            correctionReason?: string | null | undefined;
          }[]
        | undefined;
      prizePool?: (Record<string, unknown> | null) | undefined;
      id: string;
      code?: string | undefined;
      name: string;
      status: EventStatus;
      startsAt?: string | undefined;
      minimumPeople?: number | undefined;
      capacityPeople?: number | undefined;
      totalRounds?: number | undefined;
      currentRound?: number | undefined;
      _count?: { teams?: number | undefined } | undefined;
    } | null,
    | EventDetail
    | {
        teams?:
          | {
              id: string;
              name: string;
              playerAName: string;
              playerBName: string;
              playerAPhone?: string | null | undefined;
              playerBPhone?: string | null | undefined;
              captainPlays?: boolean | undefined;
              status: string;
              category?: string | undefined;
              points?: number | undefined;
              wins?: number | undefined;
              losses?: number | undefined;
              scoreDiff?: number | undefined;
              finalRank?: number | null | undefined;
              paymentDueAt?: string | null | undefined;
              waitlistedAt?: string | null | undefined;
              cancelReason?: string | null | undefined;
              cancelRequestedAt?: string | null | undefined;
              cancellationPending?: boolean | undefined;
              cancellationResolvedAt?: string | null | undefined;
              order?: { status?: string | undefined } | null | undefined;
            }[]
          | undefined;
        matches?:
          | {
              id: string;
              round: number;
              courtLabel?: string | null | undefined;
              teamAId: string;
              teamBId: string | null;
              startingScoreA: number;
              startingScoreB: number;
              scoreA: number | null;
              scoreB: number | null;
              status: MatchStatus;
              correctionReason?: string | null | undefined;
            }[]
          | undefined;
        prizePool?: (Record<string, unknown> | null) | undefined;
        id: string;
        code?: string | undefined;
        name: string;
        status: EventStatus;
        startsAt?: string | undefined;
        minimumPeople?: number | undefined;
        capacityPeople?: number | undefined;
        totalRounds?: number | undefined;
        currentRound?: number | undefined;
        _count?: { teams?: number | undefined } | undefined;
      }
    | null
  >;
  mayOperatePrizes: ComputedRef<boolean>;
  prizeAwards: Ref<
    {
      id: string;
      awardName: string;
      finalRank: number;
      recipientNames: string[];
      quantity: number;
      status: "ISSUED" | "RECEIVED";
      receivedByName?: string | null | undefined;
      team?:
        | { id: string; name: string; finalRank?: number | undefined }
        | undefined;
      inventoryItem?: { id: string; sku: string; name: string } | undefined;
      operator?: { displayName: string } | undefined;
      signedBy?: { displayName: string } | null | undefined;
    }[],
    | EventPrizeAward[]
    | {
        id: string;
        awardName: string;
        finalRank: number;
        recipientNames: string[];
        quantity: number;
        status: "ISSUED" | "RECEIVED";
        receivedByName?: string | null | undefined;
        team?:
          | { id: string; name: string; finalRank?: number | undefined }
          | undefined;
        inventoryItem?: { id: string; sku: string; name: string } | undefined;
        operator?: { displayName: string } | undefined;
        signedBy?: { displayName: string } | null | undefined;
      }[]
  >;
  inventoryItems: Ref<
    {
      id: string;
      sku: string;
      name: string;
      stock: number;
      enabled?: boolean | undefined;
    }[],
    | InventoryItem[]
    | {
        id: string;
        sku: string;
        name: string;
        stock: number;
        enabled?: boolean | undefined;
      }[]
  >;
  completedTeams: ComputedRef<
    {
      id: string;
      name: string;
      playerAName: string;
      playerBName: string;
      playerAPhone?: string | null | undefined;
      playerBPhone?: string | null | undefined;
      captainPlays?: boolean | undefined;
      status: string;
      category?: string | undefined;
      points?: number | undefined;
      wins?: number | undefined;
      losses?: number | undefined;
      scoreDiff?: number | undefined;
      finalRank?: number | null | undefined;
      paymentDueAt?: string | null | undefined;
      waitlistedAt?: string | null | undefined;
      cancelReason?: string | null | undefined;
      cancelRequestedAt?: string | null | undefined;
      cancellationPending?: boolean | undefined;
      cancellationResolvedAt?: string | null | undefined;
      order?: { status?: string | undefined } | null | undefined;
    }[]
  >;
  selectedPrizeTeamId: Ref<string, string>;
  availablePrizeItems: ComputedRef<
    {
      id: string;
      sku: string;
      name: string;
      stock: number;
      enabled?: boolean | undefined;
    }[]
  >;
  selectedPrizeItemId: Ref<string, string>;
  selectedRound: Ref<number, number>;
  pairingLeftIndex: Ref<number, number>;
  pairingRightIndex: Ref<number, number>;
  currentRoundMatches: ComputedRef<
    {
      id: string;
      round: number;
      courtLabel?: string | null | undefined;
      teamAId: string;
      teamBId: string | null;
      startingScoreA: number;
      startingScoreB: number;
      scoreA: number | null;
      scoreB: number | null;
      status: MatchStatus;
      correctionReason?: string | null | undefined;
    }[]
  >;
  causeMessage: (cause: unknown, fallback: string) => string;
  deepLinkQuery: Ref<
    {
      focus?: string | undefined;
      id?: string | undefined;
      orderId?: string | undefined;
      eventId?: string | undefined;
      gameId?: string | undefined;
      sessionId?: string | undefined;
      attendanceId?: string | undefined;
      userId?: string | undefined;
      round?: string | undefined;
    },
    | OpsDeepLinkQuery
    | {
        focus?: string | undefined;
        id?: string | undefined;
        orderId?: string | undefined;
        eventId?: string | undefined;
        gameId?: string | undefined;
        sessionId?: string | undefined;
        attendanceId?: string | undefined;
        userId?: string | undefined;
        round?: string | undefined;
      }
  >;
  deepLinkHandled: Ref<boolean, boolean>;
  matches: ComputedRef<
    {
      id: string;
      round: number;
      courtLabel?: string | null | undefined;
      teamAId: string;
      teamBId: string | null;
      startingScoreA: number;
      startingScoreB: number;
      scoreA: number | null;
      scoreB: number | null;
      status: MatchStatus;
      correctionReason?: string | null | undefined;
    }[]
  >;
  teams: ComputedRef<
    {
      id: string;
      name: string;
      playerAName: string;
      playerBName: string;
      playerAPhone?: string | null | undefined;
      playerBPhone?: string | null | undefined;
      captainPlays?: boolean | undefined;
      status: string;
      category?: string | undefined;
      points?: number | undefined;
      wins?: number | undefined;
      losses?: number | undefined;
      scoreDiff?: number | undefined;
      finalRank?: number | null | undefined;
      paymentDueAt?: string | null | undefined;
      waitlistedAt?: string | null | undefined;
      cancelReason?: string | null | undefined;
      cancelRequestedAt?: string | null | undefined;
      cancellationPending?: boolean | undefined;
      cancellationResolvedAt?: string | null | undefined;
      order?: { status?: string | undefined } | null | undefined;
    }[]
  >;
  focusedRecord: Ref<string, string>;
  actionKey: Ref<string, string>;
}

export function useEventLoadingActions({
  selectedEventId,
  loading,
  errorMessage,
  session,
  mayViewEvent,
  eventList,
  eventDetail,
  mayOperatePrizes,
  prizeAwards,
  inventoryItems,
  completedTeams,
  selectedPrizeTeamId,
  availablePrizeItems,
  selectedPrizeItemId,
  selectedRound,
  pairingLeftIndex,
  pairingRightIndex,
  currentRoundMatches,
  causeMessage,
  deepLinkQuery,
  deepLinkHandled,
  matches,
  teams,
  focusedRecord,
  actionKey,
}: ActionContext) {
  function preferredEvent(list: EventSummary[], preferredId?: string) {
    if (preferredId) {
      const preferred = list.find((event) => event.id === preferredId);
      if (preferred) return preferred;
    }
    const priority: EventStatus[] = [
      "IN_PROGRESS",
      "OPEN",
      "FULL",
      "DRAFT",
      "COMPLETED",
      "CANCELLED",
    ];
    return (
      priority
        .map((status) => list.find((event) => event.status === status))
        .find(Boolean) || list[0]
    );
  }

  async function load(
    preferredId = selectedEventId.value,
    preferredRound?: number,
    hydrate = true,
  ) {
    loading.value = true;
    errorMessage.value = "";
    try {
      if (hydrate) await session.hydrate();
      if (!mayViewEvent.value) return;
      const list = (await endpoints.managedEvents()) as EventSummary[];
      eventList.value = Array.isArray(list) ? list : [];
      const selected = preferredEvent(eventList.value, preferredId);
      selectedEventId.value = selected?.id || "";
      eventDetail.value = selected
        ? ((await endpoints.managedEvent(selected.id)) as EventDetail)
        : null;
      if (
        selected &&
        eventDetail.value?.status === "COMPLETED" &&
        mayOperatePrizes.value
      ) {
        const [awards, items] = await Promise.all([
          endpoints.eventPrizes(selected.id) as Promise<EventPrizeAward[]>,
          endpoints.inventoryAwardOptions() as Promise<InventoryItem[]>,
        ]);
        prizeAwards.value = Array.isArray(awards) ? awards : [];
        inventoryItems.value = Array.isArray(items) ? items : [];
        if (
          !completedTeams.value.some(
            (team) => team.id === selectedPrizeTeamId.value,
          )
        ) {
          selectedPrizeTeamId.value = completedTeams.value[0]?.id || "";
        }
        if (
          !availablePrizeItems.value.some(
            (item) => item.id === selectedPrizeItemId.value,
          )
        ) {
          selectedPrizeItemId.value = availablePrizeItems.value[0]?.id || "";
        }
      } else {
        prizeAwards.value = [];
        inventoryItems.value = [];
        selectedPrizeTeamId.value = "";
        selectedPrizeItemId.value = "";
      }
      const latestRound = Number(eventDetail.value?.currentRound || 0);
      selectedRound.value =
        preferredRound && preferredRound <= latestRound
          ? preferredRound
          : latestRound;
      pairingLeftIndex.value = 0;
      pairingRightIndex.value = currentRoundMatches.value.length > 1 ? 1 : 0;
    } catch (cause) {
      errorMessage.value = causeMessage(cause, "赛事数据加载失败");
      throw cause;
    } finally {
      loading.value = false;
    }
  }

  async function loadFromPage() {
    try {
      const requestedRound =
        Number(deepLinkQuery.value.round || 0) || undefined;
      await load(deepLinkQuery.value.eventId || "", requestedRound, true);
      await applyEventDeepLink();
    } catch {
      uni.showToast({ title: errorMessage.value, icon: "none" });
    }
  }

  async function applyEventDeepLink() {
    if (deepLinkHandled.value || !deepLinkQuery.value.focus) return;
    const focus = deepLinkQuery.value.focus;
    deepLinkHandled.value = true;
    if (
      deepLinkQuery.value.eventId &&
      selectedEventId.value !== deepLinkQuery.value.eventId
    ) {
      uni.showToast({
        title: "未找到待办对应的赛事，可能已结束或无权查看",
        icon: "none",
      });
      return;
    }
    let record: any = null;
    let prefix = "";
    let label = "赛事记录";
    if (focus === "score" || focus === "match") {
      record = findOpsDeepLinkRecord(matches.value, deepLinkQuery.value, [
        "id",
      ]);
      prefix = "event-match";
      label = "比赛对阵";
      if (record)
        selectedRound.value = Number(record.round || selectedRound.value);
    } else if (focus === "prize") {
      record = findOpsDeepLinkRecord(
        prizeAwards.value as any[],
        deepLinkQuery.value,
        ["id"],
      );
      prefix = "event-prize";
      label = "奖品发放记录";
    } else if (focus === "team") {
      record = findOpsDeepLinkRecord(teams.value, deepLinkQuery.value, ["id"]);
      prefix = "event-team";
      label = "参赛队伍";
    } else if (focus === "event") {
      record = eventDetail.value;
      prefix = "event-summary";
    } else {
      uni.showToast({ title: `无法识别赛事待办类型：${focus}`, icon: "none" });
      return;
    }
    if (!record) {
      uni.showToast({
        title: `未找到待办对应的${label}，可能已处理或无权查看`,
        icon: "none",
      });
      return;
    }
    focusedRecord.value = `${prefix}:${record.id}`;
    await nextTick();
    uni.pageScrollTo({
      selector: `#${opsDeepLinkDomId(prefix, record.id)}`,
      duration: 250,
    });
  }

  async function selectEvent(eventId: string) {
    if (loading.value || actionKey.value || eventId === selectedEventId.value)
      return;
    try {
      await load(eventId, undefined, false);
    } catch {
      uni.showToast({ title: errorMessage.value, icon: "none" });
    }
  }

  async function refresh() {
    if (loading.value || actionKey.value) return;
    try {
      await load(
        selectedEventId.value,
        selectedRound.value || undefined,
        false,
      );
      uni.showToast({ title: "赛事数据已刷新", icon: "success" });
    } catch {
      uni.showToast({ title: errorMessage.value, icon: "none" });
    }
  }
  return {
    preferredEvent,
    load,
    loadFromPage,
    applyEventDeepLink,
    selectEvent,
    refresh,
  };
}
