<script setup lang="ts">
import { useEventLoadingActions } from "./actions/loading.js";

import EventCreation from "./sections/EventCreation.vue";
import EventQueue from "./sections/EventQueue.vue";
import EventOperationDetails from "./sections/EventOperationDetails.vue";

import { computed, nextTick, ref } from "vue";
import { onLoad, onShow } from "@dcloudio/uni-app";
import OperationsFrame from "../../components/OperationsFrame.vue";
import OperationTask from "../../components/OperationTask.vue";
import { useOperationTask, reasonField } from "../../components/operation-task";
import MetricCard from "../../../../components/MetricCard.vue";
import { hasOperationsAccess } from "../../../../config/operations";
import { presentPrizePool } from "../../config/event-presentation";
import { endpoints } from "../../../../services/api";
import { useSessionStore } from "../../../../stores/session";
import type { AppRole } from "../../../../types/domain";
import { shortDate, today as shanghaiDate } from "../../../../utils/format";
import { withPendingCreationKey } from "../../../../utils/pending-creation-key";
import {
  findOpsDeepLinkRecord,
  opsDeepLinkDomId,
  parseOpsDeepLinkQuery,
  type OpsDeepLinkQuery,
} from "../../../../utils/work-item-deep-link";
import type {
  EventStatus,
  MatchStatus,
  EventSummary,
  EventTeam,
  EventDetail,
  InventoryItem,
  EventPrizeAward,
} from "./page-types.js";
import { useEventCatalogActions } from "./actions/catalog.js";
import { useEventParticipationActions } from "./actions/participation.js";
import { useEventCompetitionActions } from "./actions/competition.js";
import { useEventPrizesActions } from "./actions/prizes.js";
function showParticipantContacts(team: EventTeam) {
  uni.showModal({
    title: "参赛联系资料",
    content:
      team.playerAName +
      "：" +
      (team.playerAPhone || "未填写") +
      "\n" +
      team.playerBName +
      "：" +
      (team.playerBPhone || "未填写") +
      "\n仅供场馆办理本次赛事，请勿公开转发。",
    showCancel: false,
  });
}

const EVENT_MANAGEMENT_ROLES: readonly AppRole[] = [
  "EVENT_MANAGER",
  "ADMIN",
  "SUPER_ADMIN",
];

const SCORE_ROLES: readonly AppRole[] = [
  "EVENT_MANAGER",
  "FRONT_DESK",
  "ADMIN",
  "SUPER_ADMIN",
];

const PRIZE_ROLES: readonly AppRole[] = [
  "EVENT_MANAGER",
  "FRONT_DESK",
  "ADMIN",
  "SUPER_ADMIN",
];

const TERMINAL_MATCH_STATUSES: readonly MatchStatus[] = [
  "CONFIRMED",
  "CORRECTED",
];

const SCORE_INPUT_STATUSES: readonly MatchStatus[] = [
  "PENDING",
  "IN_PROGRESS",
  "SUBMITTED",
];

const ACTIVE_TEAM_STATUSES = ["REGISTERED", "PAID", "CHECKED_IN", "COMPLETED"];

const STATUS_LABELS: Record<string, string> = {
  DRAFT: "草稿",
  OPEN: "报名中",
  FULL: "已满员",
  IN_PROGRESS: "进行中",
  COMPLETED: "已完成",
  CANCELLED: "已取消",
  REGISTERED: "已报名",
  PAID: "已支付",
  CHECKED_IN: "已签到",
  REFUNDED: "已退款",
  WAITLISTED: "候补中",
  PENDING: "待录入",
  SUBMITTED: "待确认",
  CONFIRMED: "已确认",
  CORRECTED: "已纠错",
  ISSUED: "待签收",
  RECEIVED: "已签收",
};

const task = useOperationTask();

const session = useSessionStore();

const eventList = ref<EventSummary[]>([]);

const selectedEventId = ref("");

const eventDetail = ref<EventDetail | null>(null);

const selectedRound = ref(0);

const loading = ref(false);

const actionKey = ref("");

const errorMessage = ref("");

const deepLinkQuery = ref<OpsDeepLinkQuery>({});

const deepLinkHandled = ref(false);

const focusedRecord = ref("");

const prizeAwards = ref<EventPrizeAward[]>([]);

const inventoryItems = ref<InventoryItem[]>([]);

const selectedPrizeTeamId = ref("");

const selectedPrizeItemId = ref("");

const prizeAwardName = ref("冠军奖");

const prizeQuantity = ref(1);

const eventName = ref("");

const eventCode = ref(`EV-${Date.now().toString().slice(-8)}`);

const eventDate = ref(shanghaiDate(7));

const eventTime = ref("09:00");

const registrationEndDate = ref(shanghaiDate(6));

const registrationEndTime = ref("20:00");

const eventFeeYuan = ref("99");

const eventSponsor = ref("");

const capacityOptions = Array.from(
  { length: 13 },
  (_, index) => 24 + index * 2,
);

const eventCapacityIndex = ref(capacityOptions.length - 1);

const pairingLeftIndex = ref(0);

const pairingRightIndex = ref(1);

const hasAnyRole = (roles: readonly AppRole[]) =>
  roles.some((role) => session.roles.includes(role));

const mayManageEvent = computed(() => hasAnyRole(EVENT_MANAGEMENT_ROLES));

const mayScore = computed(() => hasAnyRole(SCORE_ROLES));

const mayOperatePrizes = computed(() => hasAnyRole(PRIZE_ROLES));

const mayViewEvent = computed(() =>
  hasOperationsAccess(session.roles, "events"),
);

const roleLabel = computed(() => {
  if (session.roles.includes("EVENT_MANAGER")) return "赛事管理员";
  if (session.roles.includes("FRONT_DESK")) return "前台记分 / 库存经办";
  if (session.roles.includes("SUPER_ADMIN")) return "超级管理员";
  if (session.roles.includes("ADMIN")) return "管理员";
  return "赛事只读";
});

const teams = computed(() => eventDetail.value?.teams || []);

const matches = computed(() => eventDetail.value?.matches || []);

const activeTeams = computed(() =>
  teams.value.filter((team) => ACTIVE_TEAM_STATUSES.includes(team.status)),
);

const waitlistedTeams = computed(() =>
  teams.value.filter((team) => team.status === "WAITLISTED"),
);

const paidTeams = computed(() =>
  teams.value.filter((team) =>
    ["PAID", "CHECKED_IN", "COMPLETED"].includes(team.status),
  ),
);

const checkedTeams = computed(() =>
  teams.value.filter((team) =>
    ["CHECKED_IN", "COMPLETED"].includes(team.status),
  ),
);

const completedTeams = computed(() =>
  teams.value
    .filter(
      (team) => team.status === "COMPLETED" && Number(team.finalRank || 0) > 0,
    )
    .sort((a, b) => Number(a.finalRank) - Number(b.finalRank)),
);

const availablePrizeItems = computed(() =>
  inventoryItems.value.filter(
    (item) => item.enabled !== false && item.stock > 0,
  ),
);

const selectedPrizeTeam = computed(() =>
  completedTeams.value.find((team) => team.id === selectedPrizeTeamId.value),
);

const selectedPrizeItem = computed(() =>
  availablePrizeItems.value.find(
    (item) => item.id === selectedPrizeItemId.value,
  ),
);

const pendingPrizeReceipts = computed(
  () => prizeAwards.value.filter((award) => award.status === "ISSUED").length,
);

const prizePoolEntries = computed(() =>
  presentPrizePool(eventDetail.value?.prizePool),
);

const waitingScores = computed(() =>
  matches.value.filter(
    (match) => !TERMINAL_MATCH_STATUSES.includes(match.status),
  ),
);

const currentRound = computed(() =>
  Number(eventDetail.value?.currentRound || 0),
);

const totalRounds = computed(() => Number(eventDetail.value?.totalRounds || 5));

const minimumTeams = computed(() =>
  Math.ceil(Number(eventDetail.value?.minimumPeople || 24) / 2),
);

const currentRoundMatches = computed(() =>
  matches.value.filter((match) => match.round === currentRound.value),
);

const pairingOptions = computed(() =>
  currentRoundMatches.value.map(
    (match) =>
      `${match.courtLabel || `第${match.round}轮`} · ${teamName(match.teamAId)} vs ${teamName(match.teamBId)}`,
  ),
);

const pairingsEditable = computed(() =>
  Boolean(
    mayManageEvent.value &&
    eventDetail.value?.status === "IN_PROGRESS" &&
    currentRoundMatches.value.length >= 2 &&
    currentRoundMatches.value.every(
      (match) =>
        match.teamBId === null ||
        (match.status === "PENDING" &&
          match.scoreA === null &&
          match.scoreB === null),
    ),
  ),
);

const roundOptions = computed(() =>
  Array.from({ length: currentRound.value }, (_, index) => index + 1),
);

const visibleMatches = computed(() =>
  matches.value.filter((match) => match.round === selectedRound.value),
);

const statusCounts = computed(() =>
  eventList.value.reduce<Record<string, number>>((counts, event) => {
    counts[event.status] = (counts[event.status] || 0) + 1;
    return counts;
  }, {}),
);

const metrics = computed(() => [
  [
    "当前轮次",
    eventDetail.value ? `${currentRound.value}/${totalRounds.value}` : "—",
    "固定五轮瑞士制",
  ],
  [
    "已签到队伍",
    String(checkedTeams.value.length),
    `成赛门槛 ${minimumTeams.value} 队`,
  ],
  ["待录比分", String(waitingScores.value.length), "未确认场次"],
  [
    "有效报名",
    String(activeTeams.value.length),
    `已支付 ${paidTeams.value.length} 队 · 候补 ${waitlistedTeams.value.length} 队`,
  ],
]);

const roundReady = computed(() => {
  if (!eventDetail.value || currentRound.value >= totalRounds.value)
    return false;
  if (checkedTeams.value.length < minimumTeams.value) return false;
  if (currentRound.value === 0) return true;
  return (
    currentRoundMatches.value.length > 0 &&
    currentRoundMatches.value.every((match) =>
      TERMINAL_MATCH_STATUSES.includes(match.status),
    )
  );
});

const showPublish = computed(() =>
  Boolean(eventDetail.value?.status === "DRAFT" && mayManageEvent.value),
);

const showPromoteWaitlist = computed(() =>
  Boolean(
    mayManageEvent.value &&
    eventDetail.value &&
    ["OPEN", "FULL"].includes(eventDetail.value.status),
  ),
);

const showCancel = computed(() =>
  Boolean(
    mayManageEvent.value &&
    eventDetail.value &&
    ["DRAFT", "OPEN", "FULL"].includes(eventDetail.value.status),
  ),
);

const showNextRound = computed(() =>
  Boolean(
    eventDetail.value &&
    mayManageEvent.value &&
    ["OPEN", "FULL", "IN_PROGRESS"].includes(eventDetail.value.status) &&
    currentRound.value < totalRounds.value,
  ),
);

const showFinish = computed(() =>
  Boolean(eventDetail.value?.status === "IN_PROGRESS" && mayManageEvent.value),
);

const allRoundsComplete = computed(() => {
  if (currentRound.value !== totalRounds.value || totalRounds.value < 1)
    return false;
  return Array.from(
    { length: totalRounds.value },
    (_, index) => index + 1,
  ).every((round) => {
    const roundMatches = matches.value.filter((match) => match.round === round);
    return (
      roundMatches.length > 0 &&
      roundMatches.every((match) =>
        TERMINAL_MATCH_STATUSES.includes(match.status),
      )
    );
  });
});

const workflowHint = computed(() => {
  const event = eventDetail.value;
  if (!event) return "请选择赛事查看工作流。";
  if (event.status === "DRAFT")
    return mayManageEvent.value
      ? "草稿配置复核后发布，发布才开放报名。"
      : "赛事仍为草稿，当前角色没有发布权限。";
  if (event.status === "CANCELLED")
    return "赛事已取消，只保留历史数据和审计记录。";
  if (waitlistedTeams.value.length > 0)
    return `当前有 ${waitlistedTeams.value.length} 支队伍候补；释放或超时席位后按进入时间自动晋级，也可人工重试。`;
  if (event.status === "COMPLETED")
    return pendingPrizeReceipts.value
      ? `赛事已完赛，仍有 ${pendingPrizeReceipts.value} 笔奖品待签收。`
      : "赛事已完赛，排名、积分和奖品签收记录已经归档。";
  if (
    currentRound.value === 0 &&
    checkedTeams.value.length < minimumTeams.value
  ) {
    return `还需 ${minimumTeams.value - checkedTeams.value.length} 支队伍签到才能生成首轮。`;
  }
  if (waitingScores.value.length > 0)
    return `仍有 ${waitingScores.value.length} 场比分未确认，当前轮不能推进。`;
  if (currentRound.value < totalRounds.value)
    return `第 ${currentRound.value || 0} 轮已就绪，可生成第 ${currentRound.value + 1} 轮。`;
  if (!allRoundsComplete.value) return "五轮记录尚不完整，不能提交完赛。";
  return "五轮比分均已确认，可以完成赛事并生成最终排名积分。";
});

function causeMessage(cause: unknown, fallback: string) {
  return cause instanceof Error && cause.message ? cause.message : fallback;
}

function statusLabel(status?: string) {
  return STATUS_LABELS[status || ""] || status || "—";
}

async function runAction(
  key: string,
  successMessage: string,
  operation: () => Promise<unknown>,
  preferredRound?: number,
) {
  if (actionKey.value || loading.value) return;
  const eventId = eventDetail.value?.id;
  if (!eventId) return;
  actionKey.value = key;
  errorMessage.value = "";
  uni.showLoading({ title: "处理中", mask: true });
  try {
    await operation();
    await load(eventId, preferredRound, false);
    uni.showToast({ title: successMessage, icon: "success" });
  } catch (cause) {
    errorMessage.value = causeMessage(cause, "赛事操作失败");
    uni.showToast({ title: errorMessage.value, icon: "none" });
  } finally {
    uni.hideLoading();
    actionKey.value = "";
  }
}

const { publishEvent, cancelEvent, createEvent } = useEventCatalogActions({
  eventDetail,
  showPublish,
  task,
  load: (...args: Parameters<typeof load>) => load(...args),
  showCancel,
  mayManageEvent,
  loading,
  actionKey,
  errorMessage,
  eventCode,
  eventName,
  eventDate,
  eventTime,
  registrationEndDate,
  registrationEndTime,
  eventFeeYuan,
  capacityOptions,
  eventCapacityIndex,
  eventSponsor,
  causeMessage: (...args: Parameters<typeof causeMessage>) =>
    causeMessage(...args),
});

const { promoteWaitlist, canCheckInTeam, checkIn } =
  useEventParticipationActions({
    eventDetail,
    showPromoteWaitlist,
    runAction: (...args: Parameters<typeof runAction>) => runAction(...args),
    hasAnyRole: (...args: Parameters<typeof hasAnyRole>) => hasAnyRole(...args),
    SCORE_ROLES,
    currentRound,
    errorMessage,
    task,
    load: (...args: Parameters<typeof load>) => load(...args),
  });

const {
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
} = useEventCompetitionActions({
  eventDetail,
  showNextRound,
  roundReady,
  currentRound,
  checkedTeams,
  runAction: (...args: Parameters<typeof runAction>) => runAction(...args),
  pairingsEditable,
  currentRoundMatches,
  pairingLeftIndex,
  pairingRightIndex,
  errorMessage,
  task,
  load: (...args: Parameters<typeof load>) => load(...args),
  teams,
  mayScore,
  SCORE_INPUT_STATUSES,
  mayManageEvent,
  TERMINAL_MATCH_STATUSES,
  showFinish,
  allRoundsComplete,
  totalRounds,
});

const { choosePrizeTeam, choosePrizeItem, issuePrize, receivePrize } =
  useEventPrizesActions({
    selectedPrizeTeamId,
    completedTeams,
    selectedPrizeItemId,
    availablePrizeItems,
    eventDetail,
    selectedPrizeTeam,
    selectedPrizeItem,
    prizeAwardName,
    prizeQuantity,
    mayOperatePrizes,
    runAction: (...args: Parameters<typeof runAction>) => runAction(...args),
    totalRounds,
    task,
    load: (...args: Parameters<typeof load>) => load(...args),
  });

const {
  preferredEvent,
  load,
  loadFromPage,
  applyEventDeepLink,
  selectEvent,
  refresh,
} = useEventLoadingActions({
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
  causeMessage: (...args: Parameters<typeof causeMessage>) =>
    causeMessage(...args),
  deepLinkQuery,
  deepLinkHandled,
  matches,
  teams,
  focusedRecord,
  actionKey,
});

onLoad((options) => {
  deepLinkQuery.value = parseOpsDeepLinkQuery(options);
});

onShow(loadFromPage);
</script>

<template>
  <OperationsFrame
    access="events"
    icon="event"
    title="赛事运营"
    eyebrow="EVENT OPERATIONS"
    :role="roleLabel"
    description="按赛事状态和岗位权限推进发布、报名签到、五轮瑞士配对、比分确认、纠错和完赛归档。"
  >
    <OperationTask :task="task" />
    <view v-if="errorMessage" class="card error-panel">
      <view
        ><text class="panel-title">数据未同步</text
        ><text class="muted">{{ errorMessage }}</text></view
      >
      <button class="secondary inline" :disabled="loading" @tap="refresh">
        重试
      </button>
    </view>

    <EventCreation
      v-if="mayManageEvent"
      :mayManageEvent="mayManageEvent"
      v-model:eventCode="eventCode"
      v-model:eventName="eventName"
      v-model:eventDate="eventDate"
      v-model:eventTime="eventTime"
      v-model:registrationEndDate="registrationEndDate"
      v-model:registrationEndTime="registrationEndTime"
      :capacityOptions="capacityOptions"
      v-model:eventCapacityIndex="eventCapacityIndex"
      v-model:eventFeeYuan="eventFeeYuan"
      v-model:eventSponsor="eventSponsor"
      :actionKey="actionKey"
      :loading="loading"
      :createEvent="createEvent"
    />

    <EventQueue
      :statusCounts="statusCounts"
      :loading="loading"
      :actionKey="actionKey"
      :refresh="refresh"
      :eventList="eventList"
      :selectedEventId="selectedEventId"
      :selectEvent="selectEvent"
      :statusLabel="statusLabel"
    />

    <view v-if="loading && !eventDetail" class="card loading-panel"
      >赛事数据同步中…</view
    >
    <view v-else-if="!eventDetail" class="empty card"
      >当前没有可管理的赛事</view
    >

    <EventOperationDetails
      v-if="eventDetail"
      :eventDetail="eventDetail"
      :metrics="metrics"
      :focusedRecord="focusedRecord"
      :statusLabel="statusLabel"
      :workflowHint="workflowHint"
      :showPublish="showPublish"
      :showPromoteWaitlist="showPromoteWaitlist"
      :showCancel="showCancel"
      :showNextRound="showNextRound"
      :showFinish="showFinish"
      :actionKey="actionKey"
      :loading="loading"
      :publishEvent="publishEvent"
      :promoteWaitlist="promoteWaitlist"
      :cancelEvent="cancelEvent"
      :roundReady="roundReady"
      :nextRound="nextRound"
      :currentRound="currentRound"
      :allRoundsComplete="allRoundsComplete"
      :finishEvent="finishEvent"
      :activeTeams="activeTeams"
      :waitlistedTeams="waitlistedTeams"
      :paidTeams="paidTeams"
      :checkedTeams="checkedTeams"
      :teams="teams"
      :showParticipantContacts="showParticipantContacts"
      :canCheckInTeam="canCheckInTeam"
      :checkIn="checkIn"
      :mayOperatePrizes="mayOperatePrizes"
      :prizeAwards="prizeAwards"
      :pendingPrizeReceipts="pendingPrizeReceipts"
      :prizePoolEntries="prizePoolEntries"
      :completedTeams="completedTeams"
      :choosePrizeTeam="choosePrizeTeam"
      :selectedPrizeTeam="selectedPrizeTeam"
      :availablePrizeItems="availablePrizeItems"
      :choosePrizeItem="choosePrizeItem"
      :selectedPrizeItem="selectedPrizeItem"
      v-model:prizeAwardName="prizeAwardName"
      v-model:prizeQuantity="prizeQuantity"
      :issuePrize="issuePrize"
      :receivePrize="receivePrize"
      :roundOptions="roundOptions"
      v-model:selectedRound="selectedRound"
      :mayManageEvent="mayManageEvent"
      :currentRoundMatches="currentRoundMatches"
      :pairingOptions="pairingOptions"
      v-model:pairingLeftIndex="pairingLeftIndex"
      v-model:pairingRightIndex="pairingRightIndex"
      :pairingsEditable="pairingsEditable"
      :correctPairings="correctPairings"
      :visibleMatches="visibleMatches"
      :teamName="teamName"
      :canSubmitScore="canSubmitScore"
      :canCorrectScore="canCorrectScore"
      :score="score"
      :correctScore="correctScore"
    />
  </OperationsFrame>
</template>

<style scoped src="./page.css"></style>
