<script setup lang="ts">
import { computed, nextTick, ref } from "vue";
import { onLoad, onShow } from "@dcloudio/uni-app";
import OperationsFrame from '../../components/OperationsFrame.vue'
import OperationTask from '../../components/OperationTask.vue'
import { useOperationTask, reasonField } from '../../components/operation-task'
import MetricCard from "../../../../components/MetricCard.vue";
import { hasOperationsAccess } from "../../../../config/operations";
import { presentPrizePool } from "../../config/event-presentation";
import { endpoints } from "../../../../services/api";
import { useSessionStore } from "../../../../stores/session";
import type { AppRole } from "../../../../types/domain";
import { shortDate } from "../../../../utils/format";
import { withPendingCreationKey } from "../../../../utils/pending-creation-key";
import {
  findOpsDeepLinkRecord,
  opsDeepLinkDomId,
  parseOpsDeepLinkQuery,
  type OpsDeepLinkQuery,
} from "../../../../utils/work-item-deep-link";

type EventStatus =
  "DRAFT" | "OPEN" | "FULL" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED";
type MatchStatus =
  "PENDING" | "IN_PROGRESS" | "SUBMITTED" | "CONFIRMED" | "CORRECTED";

interface EventSummary {
  id: string;
  code?: string;
  name: string;
  status: EventStatus;
  startsAt?: string;
  minimumPeople?: number;
  capacityPeople?: number;
  totalRounds?: number;
  currentRound?: number;
  _count?: { teams?: number };
}

interface EventTeam {
  id: string;
  name: string;
  playerAName: string;
  playerBName: string;
  playerAPhone?: string | null;
  playerBPhone?: string | null;
  captainPlays?: boolean;
  status: string;
  category?: string;
  points?: number;
  wins?: number;
  losses?: number;
  scoreDiff?: number;
  finalRank?: number | null;
  paymentDueAt?: string | null;
  waitlistedAt?: string | null;
  cancelReason?: string | null;
  cancelRequestedAt?: string | null;
  cancellationPending?: boolean;
  cancellationResolvedAt?: string | null;
  order?: { status?: string } | null;
}

function showParticipantContacts(team: EventTeam) {
  uni.showModal({ title: '参赛联系资料', content: team.playerAName + '：' + (team.playerAPhone || '未填写') + '\n' + team.playerBName + '：' + (team.playerBPhone || '未填写') + '\n仅供场馆办理本次赛事，请勿公开转发。', showCancel: false })
}

interface EventMatch {
  id: string;
  round: number;
  courtLabel?: string | null;
  teamAId: string;
  teamBId: string | null;
  startingScoreA: number;
  startingScoreB: number;
  scoreA: number | null;
  scoreB: number | null;
  status: MatchStatus;
  correctionReason?: string | null;
}

interface EventDetail extends EventSummary {
  teams?: EventTeam[];
  matches?: EventMatch[];
  prizePool?: Record<string, unknown> | null;
}

interface InventoryItem {
  id: string;
  sku: string;
  name: string;
  stock: number;
  enabled?: boolean;
}

interface EventPrizeAward {
  id: string;
  awardName: string;
  finalRank: number;
  recipientNames: string[];
  quantity: number;
  status: "ISSUED" | "RECEIVED";
  receivedByName?: string | null;
  team?: { id: string; name: string; finalRank?: number };
  inventoryItem?: { id: string; sku: string; name: string };
  operator?: { displayName: string };
  signedBy?: { displayName: string } | null;
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

const task = useOperationTask()
const session = useSessionStore()
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
const mayViewEvent = computed(() => hasOperationsAccess(session.roles, "events"));
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

function shanghaiDate(offsetDays = 0) {
  const value = new Date(Date.now() + offsetDays * 86_400_000);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const values = Object.fromEntries(
    parts.map((part) => [part.type, part.value]),
  );
  return `${values.year}-${values.month}-${values.day}`;
}

function statusLabel(status?: string) {
  return STATUS_LABELS[status || ""] || status || "—";
}

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

function choosePrizeTeam(event: any) {
  selectedPrizeTeamId.value =
    completedTeams.value[Number(event.detail.value)]?.id || "";
}

function choosePrizeItem(event: any) {
  selectedPrizeItemId.value =
    availablePrizeItems.value[Number(event.detail.value)]?.id || "";
}

async function loadFromPage() {
  try {
    const requestedRound = Number(deepLinkQuery.value.round || 0) || undefined;
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
    uni.showToast({ title: "未找到待办对应的赛事，可能已结束或无权查看", icon: "none" });
    return;
  }
  let record: any = null;
  let prefix = "";
  let label = "赛事记录";
  if (focus === "score" || focus === "match") {
    record = findOpsDeepLinkRecord(matches.value, deepLinkQuery.value, ["id"]);
    prefix = "event-match";
    label = "比赛对阵";
    if (record) selectedRound.value = Number(record.round || selectedRound.value);
  } else if (focus === "prize") {
    record = findOpsDeepLinkRecord(prizeAwards.value as any[], deepLinkQuery.value, ["id"]);
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
    uni.showToast({ title: `未找到待办对应的${label}，可能已处理或无权查看`, icon: "none" });
    return;
  }
  focusedRecord.value = `${prefix}:${record.id}`;
  await nextTick();
  uni.pageScrollTo({ selector: `#${opsDeepLinkDomId(prefix, record.id)}`, duration: 250 });
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
    await load(selectedEventId.value, selectedRound.value || undefined, false);
    uni.showToast({ title: "赛事数据已刷新", icon: "success" });
  } catch {
    uni.showToast({ title: errorMessage.value, icon: "none" });
  }
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

function publishEvent() {
  const event = eventDetail.value
  if (!event || !showPublish.value) return
  task.start({ title: '发布赛事', description: event.name + ' · 发布后进入报名期，请先核对时间、费用、名额和规则。',
    confirmText: '确认发布赛事', fields: [{ key: 'reason', label: '发布说明', required: false, max: 300 }],
    submit: async ({ reason }) => { await endpoints.publishEvent(event.id, reason ? { reason } : {}); await load(event.id); return '赛事已发布，用户可报名。' },
  })
}

async function promoteWaitlist() {
  const event = eventDetail.value;
  if (!event || !showPromoteWaitlist.value) return;
  await runAction(`promote:${event.id}`, "候补与超时席位已重新核算", () =>
    endpoints.promoteEventWaitlist(event.id),
  );
}

function cancelEvent() {
  const event = eventDetail.value
  if (!event || !showCancel.value) return
  task.start({ title: '取消整场赛事', description: event.name + ' · 待付订单与候补取消，已付报名生成退款申请，仍须另一名财务或管理员审批。',
    confirmText: '确认取消整场赛事', fields: [reasonField('取消原因', ['成赛人数不足','场馆临时维护','组织安排有变'])],
    submit: async ({ reason }) => {
      await withPendingCreationKey('event.cancel', { eventId: event.id, reason }, idempotencyKey => endpoints.cancelEvent(event.id, { reason, idempotencyKey }))
      await load(event.id); return '赛事已取消，退款申请已转财务复核，尚不代表已到账。'
    },
  })
}

async function createEvent() {
  if (!mayManageEvent.value || loading.value || actionKey.value) return;
  errorMessage.value = "";
  const code = eventCode.value.trim();
  const name = eventName.value.trim();
  const startsAt = `${eventDate.value}T${eventTime.value}:00+08:00`;
  const registrationEndsAt = `${registrationEndDate.value}T${registrationEndTime.value}:00+08:00`;
  const fee = Number(eventFeeYuan.value);
  const capacityPeople = capacityOptions[eventCapacityIndex.value];
  if (!code || code.length > 40 || !name || name.length > 120) {
    errorMessage.value = "赛事编码和名称不能为空，且不能超过规定长度。";
    return;
  }
  if (
    new Date(startsAt) <= new Date() ||
    new Date(registrationEndsAt) <= new Date()
  ) {
    errorMessage.value = "开赛与报名截止时间都必须晚于当前时间。";
    return;
  }
  if (new Date(registrationEndsAt) >= new Date(startsAt)) {
    errorMessage.value = "报名截止时间必须早于开赛时间。";
    return;
  }
  if (
    !Number.isFinite(fee) ||
    fee < 0 ||
    Math.abs(Math.round(fee * 100) - fee * 100) > 1e-6
  ) {
    errorMessage.value = "报名费必须是非负金额，最多两位小数。";
    return;
  }
  const confirmed = await uni.showModal({
    title: "确认创建赛事草稿",
    content: `${name}\n${eventDate.value} ${eventTime.value} 开赛\n${capacityPeople} 人封顶 · 24 人成赛 · 固定五轮\n创建后仍需复核并发布。`,
    confirmText: "创建草稿",
  });
  if (!confirmed.confirm) return;
  actionKey.value = "create-event";
  uni.showLoading({ title: "创建中", mask: true });
  try {
    const created: any = await endpoints.createEvent({
      code,
      name,
      startsAt,
      registrationEndsAt,
      capacityPeople,
      minimumPeople: 24,
      totalRounds: 5,
      feeCents: Math.round(fee * 100),
      sponsor: eventSponsor.value.trim() || undefined,
      rules: [
        "固定搭档双打，男双、女双、混双同场",
        "每场一局21分，20平后不加分",
        "五轮瑞士积分制，尽量避免重复对手",
      ],
    });
    eventName.value = "";
    eventCode.value = `EV-${Date.now().toString().slice(-8)}`;
    await load(created.id, undefined, false);
    uni.showToast({ title: "赛事草稿已创建", icon: "success" });
  } catch (cause) {
    errorMessage.value = causeMessage(cause, "赛事创建失败");
  } finally {
    uni.hideLoading();
    actionKey.value = "";
  }
}

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
  const event = eventDetail.value
  if (!event || !pairingsEditable.value) return
  const left = currentRoundMatches.value[Number(pairingLeftIndex.value)], right = currentRoundMatches.value[Number(pairingRightIndex.value)]
  if (!left || !right || left.id === right.id) { errorMessage.value = '请选择两场不同的对阵'; return }
  const round = currentRound.value
  const pairings = currentRoundMatches.value.map(match => ({ teamAId: match.teamAId,
    teamBId: (match.id === left.id ? right.teamBId : match.id === right.id ? left.teamBId : match.teamBId) || undefined, courtLabel: match.courtLabel || undefined }))
  task.start({ title: '调整本轮配对', description: teamName(left.teamAId) + ' 的对手与 ' + teamName(right.teamAId) + ' 的对手互换。服务器重新核验队伍冲突，不改已录比分。',
    confirmText: '确认交换对手', fields: [reasonField('异常原因与调整依据')],
    submit: async ({ reason }) => {
      await withPendingCreationKey('event.correct-pairings', { eventId: event.id, round, pairings, reason }, idempotencyKey => endpoints.correctEventPairings(event.id, round, { pairings, reason, idempotencyKey }))
      await load(event.id, round, false); return '本轮配对已调整，修改记录可追溯。'
    },
  })
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
  const event = eventDetail.value
  if (!event || !canCheckInTeam(team)) return
  const start = new Date(event.startsAt || '').getTime(), historical = Date.now() > start + 30 * 60000
  if (Date.now() < start - 30 * 60000 || (historical && !hasAnyRole(['ADMIN','SUPER_ADMIN']))) { errorMessage.value = '当前不在签到窗口，请核对时间或联系管理员。'; return }
  task.start({ title: historical ? '历史补录队伍签到' : '确认队伍签到', description: team.name + ' · ' + team.playerAName + ' / ' + team.playerBName + '。请核对两名选手实际到场。',
    confirmText: '确认队伍到场', fields: historical ? [reasonField('历史补录依据')] : [],
    submit: async ({ reason }) => { await endpoints.checkInEventTeam(event.id, team.id, historical ? { overrideReason: reason } : {}); await load(event.id); return '队伍签到已记录，重复签到会被阻止。' },
  })
}

function parseScore(raw: unknown, match: EventMatch): [number, number] | null {
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



function score(match: EventMatch) { if (canSubmitScore(match)) openScoreTask(match, false) }

function correctScore(match: EventMatch) { if (canCorrectScore(match)) openScoreTask(match, true) }

function openScoreTask(match: EventMatch, correction: boolean) {
  const eventId = eventDetail.value!.id
  task.start({ title: correction ? '纠正比赛比分' : '录入比赛比分', description: teamName(match.teamAId) + ' 对 ' + teamName(match.teamBId) + ' · ' + (correction ? '原比分 ' + match.scoreA + ':' + match.scoreB + '，更正须留痕。' : '一局21分结束，不得并列，最终分数不能低于让分。'),
    confirmText: correction ? '确认更正并留痕' : '确认提交比分', fields: [
      { key: 'scoreA', label: teamName(match.teamAId) + ' 最终得分', kind: 'number', min: match.startingScoreA, max: 21, initial: correction ? String(match.scoreA) : '' },
      { key: 'scoreB', label: teamName(match.teamBId) + ' 最终得分', kind: 'number', min: match.startingScoreB, max: 21, initial: correction ? String(match.scoreB) : '' },
      ...(correction ? [reasonField('纠错依据')] : []),
    ],
    submit: async values => {
      const parsed = parseScore(values.scoreA + ':' + values.scoreB, match)
      if (!parsed) throw new Error('比分须以21分结束、不得并列且不能低于让分')
      const [scoreA, scoreB] = parsed
      if (correction && scoreA === match.scoreA && scoreB === match.scoreB) throw new Error('纠正后比分与原比分相同')
      if (correction) await endpoints.correctEventScore(match.id, { scoreA, scoreB, reason: values.reason })
      else await endpoints.scoreEventMatch(match.id, scoreA, scoreB)
      await load(eventId, match.round, false); return correction ? '比分已纠正，排名已重新计算，修改历史保留。' : '比分已提交，状态与排名已同步。'
    },
  })
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

async function issuePrize() {
  const event = eventDetail.value;
  const team = selectedPrizeTeam.value;
  const item = selectedPrizeItem.value;
  const awardName = prizeAwardName.value.trim();
  const quantity = Number(prizeQuantity.value);
  if (!event || event.status !== "COMPLETED" || !mayOperatePrizes.value) return;
  if (
    !team ||
    !item ||
    awardName.length < 2 ||
    !Number.isInteger(quantity) ||
    quantity < 1
  ) {
    uni.showToast({
      title: "请选择队伍和库存，并填写有效奖项及数量",
      icon: "none",
    });
    return;
  }
  if (quantity > item.stock) {
    uni.showToast({ title: `库存仅剩 ${item.stock} 件`, icon: "none" });
    return;
  }
  const modal = await uni.showModal({
    title: "确认发放奖品",
    content: `第${team.finalRank}名 ${team.name}\n${awardName} · ${item.name} × ${quantity}\n确认后立即扣减库存。`,
  });
  if (!modal.confirm) return;
  await runAction(
    `prize:${team.id}:${item.id}`,
    "奖品已出库",
    () =>
      endpoints.issueEventPrize(event.id, {
        teamId: team.id,
        awardName,
        inventoryItemId: item.id,
        quantity,
        idempotencyKey: `event-prize-${event.id}-${Date.now()}`,
        note: "赛事工作台现场发放",
      }),
    totalRounds.value,
  );
}

function receivePrize(award: EventPrizeAward) {
  const event = eventDetail.value
  if (!event || award.status !== 'ISSUED' || !mayOperatePrizes.value) return
  task.start({ title: '奖品签收', description: award.awardName + ' · ' + (award.inventoryItem?.name || '库存奖品') + ' × ' + award.quantity + '。请选择实际到场签收人。',
    confirmText: '确认本人签收', fields: [{ key: 'receivedByName', label: '签收人', kind: 'choices', options: award.recipientNames.map(value => ({ value, label: value })) }],
    submit: async ({ receivedByName }) => {
      const command = { receivedByName, note: '赛事工作台现场签收' }
      await withPendingCreationKey('event.receipt.' + award.id, command, idempotencyKey => endpoints.receiveEventPrize(event.id, award.id, { ...command, idempotencyKey }))
      await load(event.id, totalRounds.value, false); return '奖品已签收，库存出库与签收记录可追溯。'
    },
  })
}

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

    <template v-if="mayManageEvent">
      <view class="section-title">创建赛事</view>
      <view class="card create-event-form">
        <view class="form-grid">
          <view
            ><text class="field-label">赛事编码</text
            ><input v-model="eventCode" class="text-input" maxlength="40"
          /></view>
          <view
            ><text class="field-label">赛事名称</text
            ><input
              v-model="eventName"
              class="text-input"
              maxlength="120"
              placeholder="例如：延庆周末积分赛"
          /></view>
        </view>
        <view class="form-grid">
          <picker
            mode="date"
            :value="eventDate"
            :start="shanghaiDate()"
            @change="eventDate = ($event.detail as any).value"
            ><view
              ><text class="field-label">开赛日期</text
              ><view class="picker-value">{{ eventDate }} ›</view></view
            ></picker
          >
          <picker
            mode="time"
            :value="eventTime"
            @change="eventTime = ($event.detail as any).value"
            ><view
              ><text class="field-label">开赛时间</text
              ><view class="picker-value">{{ eventTime }} ›</view></view
            ></picker
          >
        </view>
        <view class="form-grid">
          <picker
            mode="date"
            :value="registrationEndDate"
            :start="shanghaiDate()"
            @change="registrationEndDate = ($event.detail as any).value"
            ><view
              ><text class="field-label">报名截止日期</text
              ><view class="picker-value"
                >{{ registrationEndDate }} ›</view
              ></view
            ></picker
          >
          <picker
            mode="time"
            :value="registrationEndTime"
            @change="registrationEndTime = ($event.detail as any).value"
            ><view
              ><text class="field-label">报名截止时间</text
              ><view class="picker-value"
                >{{ registrationEndTime }} ›</view
              ></view
            ></picker
          >
        </view>
        <view class="form-grid">
          <picker
            :range="capacityOptions"
            :value="eventCapacityIndex"
            @change="eventCapacityIndex = Number(($event.detail as any).value)"
            ><view
              ><text class="field-label">人数上限</text
              ><view class="picker-value"
                >{{ capacityOptions[eventCapacityIndex] }} 人 ›</view
              ></view
            ></picker
          >
          <view
            ><text class="field-label">报名费（元）</text
            ><input v-model="eventFeeYuan" class="text-input" type="digit"
          /></view>
        </view>
        <view
          ><text class="field-label">赞助方（选填）</text
          ><input
            v-model="eventSponsor"
            class="text-input"
            maxlength="100"
            placeholder="无赞助可留空"
        /></view>
        <text class="create-guardrail"
          >赛制锁定为固定双打、24 人成赛、24-48
          人双数容量、五轮瑞士制。创建得到草稿，必须二次确认发布才开放报名。</text
        >
        <button
          class="primary"
          :loading="actionKey === 'create-event'"
          :disabled="loading || Boolean(actionKey)"
          @tap="createEvent"
        >
          创建赛事草稿
        </button>
      </view>
    </template>

    <view class="queue-header">
      <view>
        <text class="section-title queue-title">赛事队列</text>
        <text class="section-note">
          报名中 {{ (statusCounts.OPEN || 0) + (statusCounts.FULL || 0) }} ·
          进行中 {{ statusCounts.IN_PROGRESS || 0 }} · 草稿
          {{ statusCounts.DRAFT || 0 }}
        </text>
      </view>
      <button
        class="secondary refresh-button"
        :loading="loading"
        :disabled="loading || Boolean(actionKey)"
        @tap="refresh"
      >
        刷新
      </button>
    </view>

    <scroll-view
      v-if="eventList.length"
      class="event-scroll"
      scroll-x
      enable-flex
    >
      <view class="event-list">
        <button
          v-for="event in eventList"
          :key="event.id"
          class="event-option"
          :class="{ selected: event.id === selectedEventId }"
          :disabled="loading || Boolean(actionKey)"
          @tap="selectEvent(event.id)"
        >
          <view class="option-top"
            ><text class="option-name">{{ event.name }}</text
            ><text class="status-badge" :class="event.status.toLowerCase()">{{
              statusLabel(event.status)
            }}</text></view
          >
          <text class="option-meta"
            >{{ shortDate(event.startsAt) }} · {{ event.currentRound || 0 }}/{{
              event.totalRounds || 5
            }}
            轮 · {{ event._count?.teams || 0 }} 队</text
          >
        </button>
      </view>
    </scroll-view>

    <view v-if="loading && !eventDetail" class="card loading-panel"
      >赛事数据同步中…</view
    >
    <view v-else-if="!eventDetail" class="empty card"
      >当前没有可管理的赛事</view
    >

    <template v-if="eventDetail">
      <view class="metric-grid">
        <MetricCard
          v-for="item in metrics"
          :key="item[0]"
          :label="item[0]"
          :value="item[1]"
          :note="item[2]"
        />
      </view>

      <view :id="opsDeepLinkDomId('event-summary', eventDetail.id)" class="card event-summary" :class="{ 'deep-link-target': focusedRecord === `event-summary:${eventDetail.id}` }">
        <view class="row summary-top">
          <view class="summary-copy">
            <text class="event-title">{{ eventDetail.name }}</text>
            <text class="muted"
              >{{ eventDetail.code || "未显示赛事编码" }} ·
              {{ shortDate(eventDetail.startsAt) }}</text
            >
            <text class="muted"
              >固定双打 · 24人起赛 · 最多{{
                eventDetail.capacityPeople || 48
              }}人 · 五轮瑞士制</text
            >
          </view>
          <text
            class="status-badge"
            :class="eventDetail.status.toLowerCase()"
            >{{ statusLabel(eventDetail.status) }}</text
          >
        </view>
        <view class="workflow-hint">{{ workflowHint }}</view>
        <view
          v-if="
            showPublish ||
            showPromoteWaitlist ||
            showCancel ||
            showNextRound ||
            showFinish
          "
          class="event-actions"
        >
          <button
            v-if="showPublish"
            class="primary"
            :loading="actionKey === `publish:${eventDetail.id}`"
            :disabled="loading || Boolean(actionKey)"
            @tap="publishEvent"
          >
            发布赛事
          </button>
          <button
            v-if="showPromoteWaitlist"
            class="secondary"
            :loading="actionKey === `promote:${eventDetail.id}`"
            :disabled="loading || Boolean(actionKey)"
            @tap="promoteWaitlist"
          >
            重试候补晋级
          </button>
          <button
            v-if="showCancel"
            class="danger"
            :loading="actionKey === `cancel:${eventDetail.id}`"
            :disabled="loading || Boolean(actionKey)"
            @tap="cancelEvent"
          >
            取消赛事
          </button>
          <button
            v-if="showNextRound"
            class="primary"
            :loading="actionKey === `round:${eventDetail.id}`"
            :disabled="loading || Boolean(actionKey) || !roundReady"
            @tap="nextRound"
          >
            {{
              currentRound === 0 ? "生成首轮" : `生成第 ${currentRound + 1} 轮`
            }}
          </button>
          <button
            v-if="showFinish"
            class="primary"
            :loading="actionKey === `finish:${eventDetail.id}`"
            :disabled="loading || Boolean(actionKey) || !allRoundsComplete"
            @tap="finishEvent"
          >
            完成赛事
          </button>
        </view>
      </view>

      <view class="section-title">
        报名与签到
        <text class="section-note"
          >有效 {{ activeTeams.length }} · 候补 {{ waitlistedTeams.length }} ·
          已支付 {{ paidTeams.length }} · 已签到 {{ checkedTeams.length }}</text
        >
      </view>
      <view v-for="team in teams" :id="opsDeepLinkDomId('event-team', team.id)" :key="team.id" class="card team-row" :class="{ 'deep-link-target': focusedRecord === `event-team:${team.id}` }">
        <view class="team-copy">
          <view class="row team-heading"
            ><text class="team-name">{{ team.name }}</text
            ><text class="status-badge" :class="team.status.toLowerCase()">{{
              statusLabel(team.status)
            }}</text></view
          >
          <text class="muted"
            >{{ team.playerAName }} / {{ team.playerBName }} ·
            {{ team.category || "固定双打" }}</text
          >
          <button v-if="team.playerAPhone || team.playerBPhone" class="secondary" @tap="showParticipantContacts(team)">查看选手联系方式</button>
          <text v-if="team.status === 'WAITLISTED'" class="team-stat"
            >候补不生成订单、不收费；按进入队列时间 FIFO 晋级。</text
          >
          <text
            v-else-if="team.status === 'REGISTERED' && team.paymentDueAt"
            class="team-stat"
            >支付保留至 {{ new Date(team.paymentDueAt).toLocaleString() }}</text
          >
          <text v-if="team.cancellationPending" class="team-stat warning"
            >队长已申请退出：{{
              team.cancelReason || "待补充原因"
            }}。退款待财务审批，当前保留席位并禁止签到。</text
          >
          <text
            v-else-if="
              team.status === 'PAID' &&
              team.cancelRequestedAt &&
              team.cancellationResolvedAt
            "
            class="team-stat warning"
            >退出退款未通过或已撤销，报名已恢复；如有疑问请联络财务。</text
          >
          <text
            v-else-if="
              ['CANCELLED', 'REFUNDED'].includes(team.status) &&
              team.cancelReason
            "
            class="team-stat"
            >退出原因：{{ team.cancelReason }} · 席位已释放。</text
          >
          <text v-if="currentRound > 0" class="team-stat"
            >{{ team.finalRank ? `第${team.finalRank}名 · ` : ""
            }}{{ team.points || 0 }} 分 · {{ team.wins || 0 }}胜{{
              team.losses || 0
            }}负 · 净胜分 {{ team.scoreDiff || 0 }}</text
          >
        </view>
        <button
          v-if="canCheckInTeam(team)"
          class="secondary inline"
          :loading="actionKey === `checkin:${team.id}`"
          :disabled="loading || Boolean(actionKey)"
          @tap="checkIn(team)"
        >
          签到
        </button>
      </view>
      <view v-if="!teams.length" class="empty card">该赛事尚无报名队伍</view>

      <template v-if="eventDetail.status === 'COMPLETED' && mayOperatePrizes">
        <view class="section-title">
          奖品出库与签收
          <text class="section-note"
            >已发 {{ prizeAwards.length }} 笔 · 待签收
            {{ pendingPrizeReceipts }} 笔</text
          >
        </view>
        <view class="card prize-pool-card">
          <text class="panel-title">本场奖池</text>
          <text v-if="!prizePoolEntries.length" class="muted"
            >尚未配置奖池；发放记录仍会保留当时的业务配置用于追溯。</text
          >
          <text
            v-for="entry in prizePoolEntries"
            :key="entry.id"
            class="prize-pool-line"
            >{{ entry.label }}：{{ entry.value }}</text
          >
        </view>
        <view class="card prize-form">
          <text class="panel-title">新增奖品发放</text>
          <view class="prize-field">
            <text class="field-label">获奖队伍</text>
            <picker
              :range="completedTeams"
              range-key="name"
              @change="choosePrizeTeam"
            >
              <view class="picker-value">{{
                selectedPrizeTeam
                  ? `第${selectedPrizeTeam.finalRank}名 · ${selectedPrizeTeam.name}`
                  : "请选择已完赛队伍"
              }}</view>
            </picker>
          </view>
          <view class="prize-field">
            <text class="field-label">库存 SKU</text>
            <picker
              :range="availablePrizeItems"
              range-key="name"
              @change="choosePrizeItem"
            >
              <view class="picker-value">{{
                selectedPrizeItem
                  ? `${selectedPrizeItem.name} · 库存 ${selectedPrizeItem.stock}`
                  : "没有可用库存"
              }}</view>
            </picker>
          </view>
          <view class="prize-inputs">
            <view class="prize-field"
              ><text class="field-label">奖项</text
              ><input
                v-model="prizeAwardName"
                class="text-input"
                maxlength="80"
                placeholder="如：冠军奖"
            /></view>
            <view class="prize-field quantity-field"
              ><text class="field-label">数量</text
              ><input
                v-model.number="prizeQuantity"
                class="text-input"
                type="number"
            /></view>
          </view>
          <button
            class="primary"
            :disabled="
              loading ||
              Boolean(actionKey) ||
              !selectedPrizeTeam ||
              !selectedPrizeItem
            "
            @tap="issuePrize"
          >
            确认出库并生成发放记录
          </button>
        </view>
        <view
          v-for="award in prizeAwards"
          :id="opsDeepLinkDomId('event-prize', award.id)"
          :key="award.id"
          class="card prize-award"
          :class="{ 'deep-link-target': focusedRecord === `event-prize:${award.id}` }"
        >
          <view class="row prize-heading">
            <view
              ><text class="team-name">{{ award.awardName }}</text
              ><text class="muted"
                >第{{ award.finalRank }}名 · {{ award.team?.name }} ·
                {{ award.recipientNames.join(" / ") }}</text
              ></view
            >
            <text class="status-badge" :class="award.status.toLowerCase()">{{
              statusLabel(award.status)
            }}</text>
          </view>
          <text class="team-stat"
            >{{ award.inventoryItem?.sku }} · {{ award.inventoryItem?.name }} ×
            {{ award.quantity }} · 发放人
            {{ award.operator?.displayName || "已记录" }}</text
          >
          <text v-if="award.status === 'RECEIVED'" class="receipt-note"
            >签收人 {{ award.receivedByName }} · 经办
            {{ award.signedBy?.displayName || "已记录" }}</text
          >
          <button
            v-else
            class="secondary inline receipt-button"
            :disabled="loading || Boolean(actionKey)"
            @tap="receivePrize(award)"
          >
            登记签收
          </button>
        </view>
        <view v-if="!prizeAwards.length" class="empty card"
          >尚未发放奖品。发放会原子扣减库存并写入审计。</view
        >
      </template>

      <view class="round-heading">
        <view
          ><text class="section-title round-title">轮次与比分</text
          ><text class="section-note"
            >确认后纠错必须填写原因并留审计</text
          ></view
        >
        <scroll-view
          v-if="roundOptions.length"
          class="round-scroll"
          scroll-x
          enable-flex
        >
          <view class="round-tabs">
            <button
              v-for="round in roundOptions"
              :key="round"
              class="round-tab"
              :class="{ selected: selectedRound === round }"
              @tap="selectedRound = round"
            >
              第{{ round }}轮
            </button>
          </view>
        </scroll-view>
      </view>

      <view
        v-if="
          mayManageEvent &&
          selectedRound === currentRound &&
          currentRoundMatches.length
        "
        class="card pairing-correction"
      >
        <view
          ><text class="panel-title">配对异常处理</text
          ><text class="muted"
            >仅在本轮任何实际对阵尚未录分前，可选择两场互换第二支队伍；轮空也可参与互换。</text
          ></view
        >
        <view class="pairing-picker-grid">
          <picker
            :range="pairingOptions"
            :value="pairingLeftIndex"
            @change="pairingLeftIndex = Number(($event.detail as any).value)"
          >
            <view
              ><text class="field-label">对阵 A</text
              ><view class="picker-value"
                >{{ pairingOptions[pairingLeftIndex] || "请选择" }} ›</view
              ></view
            >
          </picker>
          <picker
            :range="pairingOptions"
            :value="pairingRightIndex"
            @change="pairingRightIndex = Number(($event.detail as any).value)"
          >
            <view
              ><text class="field-label">对阵 B</text
              ><view class="picker-value"
                >{{ pairingOptions[pairingRightIndex] || "请选择" }} ›</view
              ></view
            >
          </picker>
        </view>
        <button
          class="secondary pairing-button"
          :loading="actionKey === `pairings:${eventDetail.id}:${currentRound}`"
          :disabled="
            loading ||
            Boolean(actionKey) ||
            !pairingsEditable ||
            pairingLeftIndex === pairingRightIndex
          "
          @tap="correctPairings"
        >
          互换对手并留审计
        </button>
        <text v-if="!pairingsEditable" class="correction-note"
          >本轮已有实际比分或确认动作，配对已锁定；后续只能走比分纠错。</text
        >
      </view>

      <view
        v-for="match in visibleMatches"
        :id="opsDeepLinkDomId('event-match', match.id)"
        :key="match.id"
        class="card match-card"
        :class="{ 'deep-link-target': focusedRecord === `event-match:${match.id}` }"
      >
        <view class="row match-heading"
          ><text class="court-label"
            >第 {{ match.round }} 轮 ·
            {{ match.courtLabel || "待分配场地" }}</text
          ><text class="status-badge" :class="match.status.toLowerCase()">{{
            statusLabel(match.status)
          }}</text></view
        >
        <view class="score-line">
          <text class="match-team">{{ teamName(match.teamAId) }}</text>
          <view class="score-block">
            <text class="final-score"
              >{{ match.scoreA ?? match.startingScoreA }} :
              {{ match.scoreB ?? match.startingScoreB }}</text
            >
            <text class="starting-score"
              >起始分 {{ match.startingScoreA }} :
              {{ match.startingScoreB }}</text
            >
          </view>
          <text class="match-team right">{{ teamName(match.teamBId) }}</text>
        </view>
        <text v-if="match.correctionReason" class="correction-note"
          >最近纠错：{{ match.correctionReason }}</text
        >
        <view
          v-if="canSubmitScore(match) || canCorrectScore(match)"
          class="match-actions"
        >
          <button
            v-if="canSubmitScore(match)"
            class="primary inline"
            :loading="actionKey === `score:${match.id}`"
            :disabled="loading || Boolean(actionKey)"
            @tap="score(match)"
          >
            录入比分
          </button>
          <button
            v-if="canCorrectScore(match)"
            class="secondary inline"
            :loading="actionKey === `correct:${match.id}`"
            :disabled="loading || Boolean(actionKey)"
            @tap="correctScore(match)"
          >
            纠错
          </button>
        </view>
      </view>
      <view v-if="currentRound === 0" class="empty card">尚未生成首轮对阵</view>
      <view v-else-if="!visibleMatches.length" class="empty card"
        >第 {{ selectedRound }} 轮没有对阵记录，请刷新或检查赛事数据</view
      >

      <view class="card boundary">
        <text class="boundary-title">操作边界</text>
        <text class="muted"
          >前台负责签到、未确认比分和库存实物经办；赛事管理员及管理员可以发布、生成轮次、纠错和完赛。奖品只能在完赛后发放，出库即原子扣减库存，签收另留操作者和审计证据。</text
        >
      </view>
    </template>
  </OperationsFrame>
</template>

<style scoped>
.metric-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14rpx;
  margin-top: 22rpx;
}
.create-event-form {
  display: grid;
  min-width: 0;
  gap: 16rpx;
}
.form-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14rpx;
}
.form-grid > view,
.form-grid > picker {
  min-width: 0;
}
.create-event-form .text-input,
.create-event-form .picker-value {
  width: 100%;
  min-height: 68rpx;
  box-sizing: border-box;
  padding: 16rpx 18rpx;
  color: #244c37;
  background: #f2f6f3;
  border: 1rpx solid #dfe9e2;
  border-radius: 16rpx;
  font-size: 23rpx;
  line-height: 1.4;
  overflow-wrap: anywhere;
}
.create-event-form .field-label {
  display: block;
  margin-bottom: 8rpx;
  color: #68756d;
  font-size: 21rpx;
}
.create-guardrail {
  color: #7b6940;
  font-size: 22rpx;
  line-height: 1.6;
}
.create-event-form .primary {
  width: 100%;
  min-height: 44px;
  margin: 0;
}
.error-panel {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16rpx;
  margin-top: 22rpx;
  color: #8a3636;
  background: #fff4f2;
}
.error-panel > view {
  flex: 1;
  min-width: 0;
  overflow-wrap: anywhere;
}
.panel-title,
.boundary-title {
  display: block;
  margin-bottom: 8rpx;
  font-size: 28rpx;
  font-weight: 800;
}
.queue-header,
.round-heading {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 18rpx;
  margin-top: 30rpx;
}
.queue-header > view,
.round-heading > view {
  flex: 1 1 auto;
  min-width: 0;
}
.queue-title,
.round-title {
  display: block;
  margin: 0 0 6rpx;
}
.section-note {
  display: block;
  color: #758079;
  font-size: 21rpx;
  font-weight: 400;
  line-height: 1.5;
  overflow-wrap: anywhere;
}
.refresh-button {
  min-width: 112rpx;
  min-height: 44px;
  margin: 0;
  padding: 0 16rpx;
  line-height: 1.3;
  font-size: 22rpx;
}
.event-scroll {
  box-sizing: border-box;
  max-width: 100%;
  width: 100%;
  margin-top: 16rpx;
  white-space: nowrap;
}
.event-list {
  display: inline-flex;
  min-width: 100%;
  gap: 14rpx;
  padding-bottom: 6rpx;
}
.event-option {
  flex: 0 0 auto;
  box-sizing: border-box;
  width: 520rpx;
  max-width: calc(100vw - 80rpx);
  min-height: 128rpx;
  margin: 0;
  padding: 20rpx;
  text-align: left;
  background: #fff;
  border: 2rpx solid transparent;
  border-radius: 24rpx;
  line-height: 1.3;
  white-space: normal;
}
.event-option.selected {
  border-color: #17653d;
  background: #f2f8f4;
}
.status-badge {
  display: inline-flex;
  flex: 0 0 auto;
  padding: 7rpx 14rpx;
  color: #456052;
  background: #eef2ef;
  border-radius: 999rpx;
  font-size: 21rpx;
  line-height: 1.2;
}
.status-badge.open,
.status-badge.in_progress,
.status-badge.paid,
.status-badge.checked_in,
.status-badge.confirmed,
.status-badge.corrected,
.status-badge.completed {
  color: #17653d;
  background: #e5f3e9;
}
.status-badge.draft,
.status-badge.pending,
.status-badge.submitted,
.status-badge.registered,
.status-badge.full {
  color: #9b6300;
  background: #fff2d6;
}
.status-badge.cancelled,
.status-badge.refunded {
  color: #8a3636;
  background: #fbeaea;
}
.option-top {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12rpx;
}
.option-name {
  flex: 1;
  min-width: 0;
  font-size: 26rpx;
  font-weight: 800;
  line-height: 1.4;
  overflow-wrap: anywhere;
  white-space: normal;
}
.option-meta {
  display: block;
  margin-top: 14rpx;
  color: #758079;
  font-size: 21rpx;
}
.event-summary {
  margin-top: 22rpx;
  padding: 26rpx;
}
.summary-top {
  align-items: flex-start;
}
.summary-copy {
  flex: 1;
  min-width: 0;
  overflow-wrap: anywhere;
}
.event-title,
.team-name {
  display: block;
  margin-bottom: 8rpx;
  font-size: 29rpx;
  font-weight: 800;
}
.summary-copy .muted {
  display: block;
  margin-top: 8rpx;
}
.workflow-hint {
  margin-top: 20rpx;
  padding: 18rpx 20rpx;
  color: #345846;
  background: #edf5ef;
  border-radius: 18rpx;
  font-size: 23rpx;
  line-height: 1.55;
}
.event-actions {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12rpx;
  margin-top: 20rpx;
}
.event-actions button {
  margin: 0;
  min-height: 44px;
  padding-top: 10rpx;
  padding-bottom: 10rpx;
  line-height: 1.35;
  font-size: 23rpx;
}
.event-actions button:only-child {
  grid-column: span 2;
}
button[disabled] {
  opacity: 0.46;
}
.team-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16rpx;
  margin-top: 14rpx;
  padding: 22rpx 24rpx;
}
.team-copy {
  min-width: 0;
  flex: 1;
}
.team-heading {
  justify-content: flex-start;
  flex-wrap: wrap;
}
.team-stat {
  display: block;
  margin-top: 12rpx;
  color: #456052;
  font-size: 22rpx;
}
.team-stat.warning {
  padding: 10rpx 12rpx;
  color: #8b5b00;
  background: #fff7e5;
  border-radius: 12rpx;
  line-height: 1.5;
}
.inline {
  min-width: 104rpx;
  min-height: 44px;
  margin: 0;
  padding: 0 14rpx;
  line-height: 1.3;
  font-size: 22rpx;
}
.round-heading {
  align-items: center;
}
.round-scroll {
  flex: 1;
  min-width: 0;
  max-width: 410rpx;
  white-space: nowrap;
}
.round-tabs {
  display: flex;
  justify-content: flex-end;
  gap: 10rpx;
}
.round-tab {
  min-width: 94rpx;
  min-height: 44px;
  margin: 0;
  padding: 0 14rpx;
  color: #456052;
  background: #e9eeea;
  border-radius: 999rpx;
  line-height: 1.3;
  font-size: 21rpx;
}
.round-tab.selected {
  color: #fff;
  background: #17653d;
}
.match-card {
  margin-top: 14rpx;
  padding: 24rpx;
}
.pairing-correction {
  display: grid;
  gap: 16rpx;
  margin-top: 14rpx;
  padding: 24rpx;
}
.pairing-picker-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14rpx;
}
.pairing-picker-grid > picker {
  min-width: 0;
}
.pairing-button {
  width: 100%;
  min-height: 44px;
  margin: 0;
}
.match-heading {
  padding-bottom: 16rpx;
  border-bottom: 1rpx solid #edf0ed;
}
.court-label {
  font-size: 24rpx;
  font-weight: 700;
}
.score-line {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
  align-items: center;
  gap: 14rpx;
  margin-top: 22rpx;
}
.match-team {
  min-width: 0;
  font-size: 25rpx;
  font-weight: 700;
  line-height: 1.4;
  overflow-wrap: anywhere;
}
.match-team.right {
  text-align: right;
}
.score-block {
  min-width: 126rpx;
  text-align: center;
}
.final-score {
  display: block;
  color: #155a37;
  font-size: 34rpx;
  font-weight: 900;
}
.starting-score {
  display: block;
  margin-top: 5rpx;
  color: #8a938d;
  font-size: 18rpx;
}
.correction-note {
  display: block;
  margin-top: 18rpx;
  padding: 14rpx 16rpx;
  color: #8b5b00;
  background: #fff7e5;
  border-radius: 14rpx;
  font-size: 21rpx;
  line-height: 1.5;
}
.match-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 12rpx;
  margin-top: 20rpx;
}
.loading-panel,
.empty {
  margin-top: 22rpx;
  color: #758079;
  text-align: center;
}
.boundary {
  margin-top: 28rpx;
  line-height: 1.7;
}
.boundary .muted {
  display: block;
}
.prize-pool-card,
.prize-form,
.prize-award {
  margin-top: 14rpx;
  padding: 24rpx;
}
.prize-pool-line {
  display: block;
  margin-top: 8rpx;
  color: #456052;
  font-size: 22rpx;
  line-height: 1.6;
}
.prize-field {
  min-width: 0;
  flex: 1;
}
.field-label {
  display: block;
  margin-bottom: 8rpx;
  color: #68756d;
  font-size: 21rpx;
}
.picker-value,
.text-input {
  width: 100%;
  min-height: 66rpx;
  box-sizing: border-box;
  padding: 16rpx 18rpx;
  color: #244c37;
  background: #f2f6f3;
  border: 1rpx solid #dfe9e2;
  border-radius: 16rpx;
  font-size: 23rpx;
  line-height: 1.45;
  overflow-wrap: anywhere;
}
.prize-form .prize-field {
  margin-top: 16rpx;
}
.prize-inputs {
  display: flex;
  gap: 14rpx;
}
.quantity-field {
  max-width: 150rpx;
}
.prize-form .primary {
  min-height: 44px;
  margin: 20rpx 0 0;
}
.prize-heading {
  align-items: flex-start;
}
.receipt-note {
  display: block;
  margin-top: 14rpx;
  padding: 12rpx 14rpx;
  color: #17653d;
  background: #e7f4ea;
  border-radius: 14rpx;
  font-size: 21rpx;
}
.receipt-button {
  display: block;
  margin: 18rpx 0 0 auto;
}
.status-badge.issued {
  color: #9b6300;
  background: #fff2d6;
}
.status-badge.received {
  color: #17653d;
  background: #e5f3e9;
}

.deep-link-target {
  border-color: #d69a24 !important;
  box-shadow: 0 0 0 4rpx rgba(214, 154, 36, 0.18);
}
@media (max-width: 420px) {
  .event-scroll {
    white-space: normal;
  }

  .event-list {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    width: 100%;
  }

  .event-option {
    width: 100%;
    max-width: 100%;
  }

  .form-grid,
  .pairing-picker-grid {
    grid-template-columns: minmax(0, 1fr);
  }

  .queue-header,
  .round-heading {
    align-items: stretch;
    flex-wrap: wrap;
  }

  .round-scroll {
    flex-basis: 100%;
    max-width: 100%;
  }

  .round-tabs {
    justify-content: flex-start;
  }

  .team-row {
    align-items: flex-start;
    flex-wrap: wrap;
  }

  .team-row > .inline {
    width: 100%;
  }

  .error-panel {
    align-items: stretch;
    flex-wrap: wrap;
  }

  .error-panel .inline,
  .refresh-button {
    width: 100%;
  }

  .event-actions {
    grid-template-columns: minmax(0, 1fr);
  }

  .event-actions button:only-child {
    grid-column: auto;
  }

  .prize-inputs {
    flex-wrap: wrap;
  }

  .prize-inputs .prize-field {
    flex: 1 1 220rpx;
  }

  .score-line {
    gap: 8rpx;
  }
}
</style>
