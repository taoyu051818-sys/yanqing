<script setup lang="ts">
import { computed, nextTick, ref } from "vue";
import { onLoad, onShow } from "@dcloudio/uni-app";

import MetricCard from "../../../../components/MetricCard.vue";
import OperationsFrame from "../../../../components/OperationsFrame.vue";
import StatusBadge from "../../../../components/StatusBadge.vue";
import { hasOperationsAccess } from "../../../../config/operations";
import { endpoints } from "../../../../services/api";
import { useSessionStore } from "../../../../stores/session";
import type { CourtAvailability } from "../../../../types/domain";
import { money, shortDate } from "../../../../utils/format";
import { withPendingCreationKey } from "../../../../utils/pending-creation-key";
import {
  findOpsDeepLinkRecord,
  opsDeepLinkDomId,
  parseOpsDeepLinkQuery,
  type OpsDeepLinkQuery,
} from "../../../../utils/work-item-deep-link";

const session = useSessionStore();
const games = ref<any[]>([]);
const availability = ref<CourtAvailability | null>(null);
const loading = ref(false);
const actionKey = ref("");
const errorMessage = ref("");
const selectedGameId = ref("");
const deepLinkQuery = ref<OpsDeepLinkQuery>({});
const deepLinkHandled = ref(false);
const focusedRecord = ref("");

const title = ref("");
const description = ref("");
const gameDate = ref(shanghaiDate(1));
const startTime = ref("13:00");
const endTime = ref("15:00");
const courtIndex = ref(0);
const capacityIndex = ref(0);
const levelIndex = ref(1);
const feeYuan = ref("68");
const capacityOptions = [4, 5, 6];
const levelOptions = [
  { label: "新手", value: "BEGINNER" },
  { label: "进阶", value: "INTERMEDIATE" },
  { label: "高阶", value: "ADVANCED" },
  { label: "混合", value: "MIXED" },
];

const mayOperate = computed(() =>
  hasOperationsAccess(session.roles, "games"),
);
const canManageAllGames = computed(() =>
  session.roles.some((role) => ["ADMIN", "SUPER_ADMIN"].includes(role)),
);
const roleLabel = computed(() => {
  if (session.roles.includes("SUPER_ADMIN")) return "超级管理员";
  if (session.roles.includes("ADMIN")) return "管理员";
  return "主理人";
});
const selectedGame = computed(
  () => games.value.find((game) => game.id === selectedGameId.value) || games.value[0],
);
const registrations = computed(() => selectedGame.value?.registrations || []);
const waitlisted = computed(() =>
  registrations.value
    .filter((item: any) => item.status === "WAITLISTED")
    .sort((left: any, right: any) =>
      new Date(left.createdAt || 0).getTime() - new Date(right.createdAt || 0).getTime(),
    ),
);
const seated = computed(() =>
  registrations.value.filter((item: any) =>
    ["REGISTERED", "PAID", "CHECKED_IN", "COMPLETED"].includes(item.status),
  ),
);
const checkedIn = computed(() =>
  registrations.value.filter((item: any) => item.status === "CHECKED_IN").length,
);
const hasPendingRegistrationRefund = computed(() =>
  registrations.value.some(
    (item: any) => item.order?.status === "REFUND_PENDING",
  ),
);
const selectableCourts = computed(() =>
  (availability.value?.courts || []).filter(
    (court) => court.enabled && !["TRAINING", "MAINTENANCE"].includes(court.usage),
  ),
);
const selectedCourt = computed(() => selectableCourts.value[courtIndex.value] || null);
const metrics = computed(() => [
  [canManageAllGames.value ? "全部球局" : "我的球局", String(games.value.length), "草稿与已发布"],
  ["有效报名", String(seated.value.length), "当前球局"],
  ["候补队列", String(waitlisted.value.length), "按报名时间排序"],
  ["已签到", String(checkedIn.value), "按实到结算"],
]);
const canCompleteSelectedGame = computed(() => Boolean(
  selectedGame.value &&
  ["OPEN", "FULL", "IN_PROGRESS"].includes(selectedGame.value.status) &&
  !hasPendingRegistrationRefund.value &&
  new Date(selectedGame.value.endsAt).getTime() <= Date.now(),
));
const canCancelSelectedGame = computed(() => Boolean(
  selectedGame.value &&
  ["DRAFT", "OPEN", "FULL"].includes(selectedGame.value.status) &&
  new Date(selectedGame.value.startsAt).getTime() > Date.now(),
));

function shanghaiDate(offsetDays = 0) {
  const value = new Date(Date.now() + offsetDays * 86_400_000);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function localIso(time: string) {
  return `${gameDate.value}T${time}:00+08:00`;
}

async function loadAvailability() {
  try {
    availability.value = await endpoints.availability(gameDate.value);
    if (courtIndex.value >= selectableCourts.value.length) courtIndex.value = 0;
  } catch (cause: any) {
    errorMessage.value = cause?.message || "场地可用状态加载失败。";
  }
}

async function load() {
  await session.hydrate();
  if (!mayOperate.value) {
    errorMessage.value = "当前账号没有主理人工作台权限。";
    return;
  }
  loading.value = true;
  errorMessage.value = "";
  try {
    const [managed] = await Promise.all([endpoints.managedGames(), loadAvailability()]);
    games.value = managed || [];
    if (
      !selectedGameId.value ||
      !games.value.some((game) => game.id === selectedGameId.value)
    ) {
      selectedGameId.value = games.value[0]?.id || "";
    }
  } catch (cause: any) {
    errorMessage.value = cause?.message || "球局工作台加载失败。";
  } finally {
    loading.value = false;
  }
  await applyHostDeepLink();
}

async function applyHostDeepLink() {
  if (deepLinkHandled.value || !deepLinkQuery.value.focus) return;
  deepLinkHandled.value = true;
  if (deepLinkQuery.value.focus !== "game") {
    uni.showToast({ title: `无法识别球局待办类型：${deepLinkQuery.value.focus}`, icon: "none" });
    return;
  }
  const game = findOpsDeepLinkRecord(games.value, deepLinkQuery.value, ["id"]);
  if (!game) {
    uni.showToast({ title: "未找到待办对应的球局，可能已结束或无权查看", icon: "none" });
    return;
  }
  selectedGameId.value = game.id;
  focusedRecord.value = `host-game:${game.id}`;
  await nextTick();
  uni.pageScrollTo({ selector: `#${opsDeepLinkDomId("host-game", game.id)}`, duration: 250 });
}

function changeDate(event: any) {
  gameDate.value = event.detail.value;
  loadAvailability();
}

function selectGame(game: any) {
  if (!actionKey.value) selectedGameId.value = game.id;
}

async function createGame() {
  if (!mayOperate.value || actionKey.value) return;
  errorMessage.value = "";
  const cleanTitle = title.value.trim();
  const cleanDescription = description.value.trim();
  const startsAt = localIso(startTime.value);
  const endsAt = localIso(endTime.value);
  const fee = Number(feeYuan.value);
  if (cleanTitle.length < 2 || cleanTitle.length > 120) {
    errorMessage.value = "球局标题需要 2-120 个字。";
    return;
  }
  if (!selectedCourt.value) {
    errorMessage.value = "请选择可用场地。";
    return;
  }
  if (new Date(startsAt) <= new Date() || new Date(endsAt) <= new Date(startsAt)) {
    errorMessage.value = "开始时间必须晚于当前时间，结束时间必须晚于开始时间。";
    return;
  }
  if (
    !Number.isFinite(fee) ||
    fee < 0 ||
    Math.abs(Math.round(fee * 100) - fee * 100) > 1e-6
  ) {
    errorMessage.value = "报名费用必须是非负金额，最多两位小数。";
    return;
  }
  const confirmed = await uni.showModal({
    title: "确认创建球局草稿",
    content: `${cleanTitle}\n${gameDate.value} ${startTime.value}-${endTime.value} · ${selectedCourt.value.name}\n${capacityOptions[capacityIndex.value]} 人 · ${money(Math.round(fee * 100))}\n创建后仍需发布才会开放报名。`,
    confirmText: "创建草稿",
  });
  if (!confirmed.confirm) return;
  actionKey.value = "create";
  try {
    const created: any = await endpoints.createGame({
      title: cleanTitle,
      description: cleanDescription || undefined,
      startsAt,
      endsAt,
      courtIds: [selectedCourt.value.id],
      capacity: capacityOptions[capacityIndex.value],
      level: levelOptions[levelIndex.value].value,
      feeCents: Math.round(fee * 100),
    });
    title.value = "";
    description.value = "";
    selectedGameId.value = created.id;
    uni.showToast({ title: "球局草稿已创建", icon: "success" });
    await load();
  } catch (cause: any) {
    errorMessage.value = cause?.message || "球局创建失败，请检查场地冲突。";
  } finally {
    actionKey.value = "";
  }
}

async function publishGame() {
  const game = selectedGame.value;
  if (!game || game.status !== "DRAFT" || actionKey.value) return;
  const modal = await uni.showModal({
    title: "确认发布球局",
    content: `“${game.title}”发布后会员可立即报名，时间、场地、人数与价格将作为履约依据。`,
    editable: true,
    placeholderText: "可填写发布说明（选填）",
    confirmText: "确认发布",
  });
  if (!modal.confirm) return;
  actionKey.value = `publish:${game.id}`;
  errorMessage.value = "";
  try {
    await endpoints.publishGame(game.id, {
      reason: String(modal.content || "").trim() || undefined,
    });
    uni.showToast({ title: "球局已发布", icon: "success" });
    await load();
  } catch (cause: any) {
    errorMessage.value = cause?.message || "球局发布失败。";
  } finally {
    actionKey.value = "";
  }
}

async function promoteWaitlist() {
  const game = selectedGame.value;
  const next = waitlisted.value[0];
  if (!game || !next || actionKey.value) return;
  const confirmed = await uni.showModal({
    title: "人工晋级候补",
    content: `确认将候补队首“${next.user?.displayName || next.displayName || "候补会员"}”晋级？系统会生成新的待支付订单；无空位时不会改变队列。`,
    confirmText: "确认晋级",
  });
  if (!confirmed.confirm) return;
  actionKey.value = `promote:${game.id}`;
  errorMessage.value = "";
  try {
    const result: any = await endpoints.promoteGameWaitlist(game.id);
    if (!result) {
      errorMessage.value = "当前没有可释放名额，候补队列未发生变化。";
    } else {
      uni.showToast({ title: "候补已晋级", icon: "success" });
    }
    await load();
  } catch (cause: any) {
    errorMessage.value = cause?.message || "候补晋级失败。";
  } finally {
    actionKey.value = "";
  }
}

async function checkIn(player: any) {
  const game = selectedGame.value;
  if (!game || player.status !== "PAID" || actionKey.value) return;
  const confirmed = await uni.showModal({
    title: "确认到场签到",
    content: `${player.user?.displayName || player.displayName || "报名球友"} · ${game.title}`,
  });
  if (!confirmed.confirm) return;
  const startsAt = new Date(game.startsAt).getTime();
  if (Number.isFinite(startsAt) && Date.now() < startsAt - 30 * 60_000) {
    errorMessage.value = "未到签到窗口，不能提前签到。";
    return;
  }
  let overrideReason: string | undefined;
  if (Number.isFinite(startsAt) && Date.now() > startsAt + 30 * 60_000) {
    if (!session.roles.some((role) => ["ADMIN", "SUPER_ADMIN"].includes(role))) {
      errorMessage.value = "已过签到窗口，请由管理员历史补录。";
      return;
    }
    const override = await uni.showModal({
      title: "历史补录签到",
      content: "",
      editable: true,
      placeholderText: "填写迟到补录原因（2-300字）",
      confirmText: "确认补录",
    });
    overrideReason = String(override.content || "").trim();
    if (!override.confirm || overrideReason.length < 2) return;
  }
  actionKey.value = `checkin:${player.id}`;
  errorMessage.value = "";
  try {
    await endpoints.checkInGame(
      game.id,
      player.id,
      overrideReason ? { overrideReason } : {},
    );
    uni.showToast({ title: "已签到", icon: "success" });
    await load();
  } catch (cause: any) {
    errorMessage.value = cause?.message || "签到失败。";
  } finally {
    actionKey.value = "";
  }
}

async function cancelGame() {
  const game = selectedGame.value;
  if (!game || !canCancelSelectedGame.value || actionKey.value) return;
  const modal = await uni.showModal({
    title: "取消球局",
    content: "已支付报名只生成待财务审批的退款申请，不会直接退款。",
    editable: true,
    placeholderText: "填写取消原因（2-300字）",
    confirmText: "确认取消",
  });
  const reason = String(modal.content || "").trim();
  if (!modal.confirm || reason.length < 2 || reason.length > 300) {
    if (modal.confirm) errorMessage.value = "取消原因需要 2-300 个字。";
    return;
  }
  actionKey.value = `cancel:${game.id}`;
  errorMessage.value = "";
  const command = { reason };
  try {
    const result: any = await withPendingCreationKey(
      `game.cancel.${game.id}`,
      command,
      (idempotencyKey) => endpoints.cancelGame(game.id, { reason, idempotencyKey }),
    );
    const refundCount = Number(result?.refundRequestCount || 0);
    uni.showToast({
      title: refundCount ? `已取消，${refundCount}笔退款待审` : "球局已取消",
      icon: "success",
    });
    await load();
  } catch (cause: any) {
    errorMessage.value = cause?.message || "球局取消失败。";
  } finally {
    actionKey.value = "";
  }
}

async function completeGame() {
  const game = selectedGame.value;
  if (!game || actionKey.value) return;
  const modal = await uni.showModal({
    title: "结束球局并结算",
    content: `按已签到 ${checkedIn.value} 人计算主理人羽毛球币激励。结束后不能继续签到，确认？`,
    confirmText: "确认结束",
  });
  if (!modal.confirm) return;
  actionKey.value = `complete:${game.id}`;
  errorMessage.value = "";
  try {
    await endpoints.completeGame(game.id);
    uni.showToast({ title: "球局已结束", icon: "success" });
    await load();
  } catch (cause: any) {
    errorMessage.value = cause?.message || "球局结束失败。";
  } finally {
    actionKey.value = "";
  }
}

onLoad((options) => {
  deepLinkQuery.value = parseOpsDeepLinkQuery(options);
  selectedGameId.value = deepLinkQuery.value.gameId || deepLinkQuery.value.id || "";
});
onShow(load);
</script>

<template>
  <OperationsFrame access="games" title="球局运营" eyebrow="GAME OPERATIONS" :role="roleLabel" :description="canManageAllGames ? '管理员可查看并处理全部主理人球局；主理人仍只操作本人球局。' : '从草稿创建、发布报名、候补晋级、现场签到到结束结算，主理人仅操作本人球局。'">
    <view v-if="errorMessage" class="card error-panel">
      <view><text class="panel-title">操作未完成</text><text class="muted">{{ errorMessage }}</text></view>
      <button class="secondary inline" :disabled="loading || Boolean(actionKey)" @tap="load">重试</button>
    </view>

    <view class="metric-grid"><MetricCard v-for="item in metrics" :key="item[0]" :label="item[0]" :value="item[1]" :note="item[2]" /></view>

    <view class="section-title">创建球局</view>
    <view class="card create-form">
      <input v-model="title" class="text-input" maxlength="120" placeholder="球局标题（必填）" />
      <textarea v-model="description" class="description-input" maxlength="500" placeholder="玩法、水平和现场说明（选填）" />
      <picker mode="date" :value="gameDate" :start="shanghaiDate()" @change="changeDate"><view class="field-row"><text>日期</text><text>{{ gameDate }} ›</text></view></picker>
      <view class="time-grid">
        <picker mode="time" :value="startTime" @change="startTime = ($event.detail as any).value"><view class="field-row"><text>开始</text><text>{{ startTime }}</text></view></picker>
        <picker mode="time" :value="endTime" @change="endTime = ($event.detail as any).value"><view class="field-row"><text>结束</text><text>{{ endTime }}</text></view></picker>
      </view>
      <picker :range="selectableCourts" range-key="name" :value="courtIndex" @change="courtIndex = Number(($event.detail as any).value)"><view class="field-row"><text>场地</text><text>{{ selectedCourt?.name || "暂无可用场地" }} ›</text></view></picker>
      <view class="time-grid">
        <picker :range="capacityOptions" :value="capacityIndex" @change="capacityIndex = Number(($event.detail as any).value)"><view class="field-row"><text>人数</text><text>{{ capacityOptions[capacityIndex] }} 人 ›</text></view></picker>
        <picker :range="levelOptions" range-key="label" :value="levelIndex" @change="levelIndex = Number(($event.detail as any).value)"><view class="field-row"><text>水平</text><text>{{ levelOptions[levelIndex].label }} ›</text></view></picker>
      </view>
      <view class="field-row"><text>报名费（元）</text><input v-model="feeYuan" class="fee-input" type="digit" /></view>
      <text class="guardrail">人数固定 4-6 人；创建会检查封场和预约冲突。草稿不会出现在会员报名入口，需再次确认发布。</text>
      <button class="primary" :loading="actionKey === 'create'" :disabled="loading || Boolean(actionKey) || !selectedCourt" @tap="createGame">创建球局草稿</button>
    </view>

    <view class="section-title">{{ canManageAllGames ? "全部球局" : "我的球局" }} <text class="section-note">{{ loading ? "同步中" : `${games.length} 场` }}</text></view>
    <scroll-view v-if="games.length" scroll-x class="game-tabs"><view class="tab-row"><button v-for="game in games" :key="game.id" class="game-tab" :class="{ active: selectedGame?.id === game.id }" :disabled="Boolean(actionKey)" @tap="selectGame(game)">{{ game.title }}<template v-if="canManageAllGames"> · {{ game.host?.displayName || "未知主理人" }}</template></button></view></scroll-view>
    <view v-if="loading && !selectedGame" class="empty card">球局数据同步中…</view>
    <view v-else-if="!selectedGame" class="empty card">尚未创建球局，请先建立草稿。</view>

    <template v-if="selectedGame">
      <view :id="opsDeepLinkDomId('host-game', selectedGame.id)" class="card game-summary" :class="{ 'deep-link-target': focusedRecord === `host-game:${selectedGame.id}` }">
        <view class="row"><view><text class="game-title">{{ selectedGame.title }}</text><text class="muted">{{ shortDate(selectedGame.startsAt) }} · {{ selectedGame.level || "公开组" }} · {{ money(selectedGame.feeCents) }}<template v-if="canManageAllGames"> · 主理人 {{ selectedGame.host?.displayName || "未识别" }}</template></text></view><StatusBadge :value="selectedGame.status" /></view>
        <text class="muted summary-copy">{{ selectedGame.description || "按实际签到人数结算激励" }}</text>
        <button v-if="selectedGame.status === 'DRAFT'" class="primary" :loading="actionKey === `publish:${selectedGame.id}`" :disabled="Boolean(actionKey)" @tap="publishGame">确认发布球局</button>
        <button v-else-if="canCompleteSelectedGame" class="primary" :loading="actionKey === `complete:${selectedGame.id}`" :disabled="Boolean(actionKey)" @tap="completeGame">结束球局并结算</button>
        <view v-else-if="['OPEN', 'FULL', 'IN_PROGRESS'].includes(selectedGame.status)" class="settled">尚未到结束时间，暂不能结束球局</view>
        <view v-else-if="selectedGame.status === 'COMPLETED'" class="settled">已结束 · 激励按实际签到人数进入观察期</view>
        <view v-else-if="selectedGame.status === 'CANCELLED'" class="settled">已取消 · 已支付报名退款进入财务审批队列</view>
        <button v-if="canCancelSelectedGame" class="danger" :loading="actionKey === `cancel:${selectedGame.id}`" :disabled="Boolean(actionKey)" @tap="cancelGame">取消球局并发起退款</button>
      </view>

      <view class="section-title">候补队列 <text class="section-note">{{ waitlisted.length }} 人 · FIFO</text></view>
      <view v-if="waitlisted.length" class="card waitlist-card">
        <view v-for="(player, index) in waitlisted" :key="player.id" class="wait-row"><text>第 {{ index + 1 }} 位 · {{ player.user?.displayName || player.displayName || "候补会员" }}</text><StatusBadge :value="player.status" /></view>
        <button v-if="['OPEN', 'FULL'].includes(selectedGame.status)" class="secondary" :loading="actionKey === `promote:${selectedGame.id}`" :disabled="Boolean(actionKey)" @tap="promoteWaitlist">人工晋级队首候补</button>
        <text v-else class="muted">该球局状态不允许继续晋级候补。</text>
      </view>
      <view v-else class="empty card">当前没有候补会员。</view>

      <view class="section-title">报名与现场签到 <text class="section-note">已到 {{ checkedIn }} / {{ seated.length }}</text></view>
      <view v-for="player in seated" :key="player.id" class="card player-row">
        <view><text class="player-name">{{ player.user?.displayName || player.displayName || "报名球友" }}</text><text class="muted">状态：{{ player.status }}</text></view>
        <button v-if="player.status === 'PAID' && player.order?.status !== 'REFUND_PENDING' && selectedGame.status !== 'COMPLETED'" class="secondary inline" :loading="actionKey === `checkin:${player.id}`" :disabled="Boolean(actionKey)" @tap="checkIn(player)">签到</button><StatusBadge v-else :value="player.order?.status === 'REFUND_PENDING' ? 'REFUND_PENDING' : player.status" />
      </view>
      <view v-if="!seated.length" class="empty card">当前球局暂无有效报名。</view>
    </template>

    <view class="card boundary"><text class="muted">边界：{{ canManageAllGames ? "管理员可处理全部球局，操作均保留实际执行人审计记录" : "主理人只能发布、晋级候补、签到和结束本人球局" }}；候补晋级仅在有空位时生成待支付订单，不跳过队首，不直接视为已支付。</text></view>
  </OperationsFrame>
</template>

<style scoped>
.metric-grid { display:grid; grid-template-columns:repeat(2,1fr); gap:14rpx; margin-top:22rpx; }.section-note { color:#758079; font-size:22rpx; font-weight:400; }.panel-title { display:block; margin-bottom:8rpx; font-size:28rpx; font-weight:800; }.error-panel { display:flex; align-items:center; justify-content:space-between; gap:16rpx; margin-top:22rpx; color:#8a3636; background:#fff4f2; }.error-panel .muted { display:block; line-height:1.5; }
.create-form { display:grid; gap:16rpx; }.text-input,.description-input,.field-row { box-sizing:border-box; width:100%; padding:20rpx; background:#f3f6f3; border-radius:16rpx; font-size:24rpx; }.description-input { min-height:120rpx; }.field-row { display:flex; align-items:center; justify-content:space-between; min-height:72rpx; }.time-grid { display:grid; grid-template-columns:1fr 1fr; gap:12rpx; }.fee-input { width:180rpx; text-align:right; }.guardrail { color:#7b6940; font-size:22rpx; line-height:1.6; }.create-form button { width:100%; margin:0; }
.game-tabs { margin-bottom:18rpx; white-space:nowrap; }.tab-row { display:flex; gap:12rpx; }.game-tab { flex:0 0 auto; max-width:400rpx; min-height:64rpx; margin:0; padding:0 22rpx; overflow:hidden; color:#667169; background:#e8efea; border-radius:18rpx; line-height:64rpx; text-overflow:ellipsis; white-space:nowrap; }.game-tab.active { color:#fff; background:#17653d; }.game-summary { padding:24rpx; }.game-title,.player-name { display:block; margin-bottom:8rpx; font-size:29rpx; font-weight:800; }.summary-copy { display:block; margin:18rpx 0; line-height:1.6; }.game-summary button { margin:0; width:100%; }.settled { padding:18rpx; color:#17653d; background:#e8f4eb; border-radius:16rpx; text-align:center; }
.waitlist-card { display:grid; gap:14rpx; }.wait-row { display:flex; align-items:center; justify-content:space-between; padding-bottom:12rpx; border-bottom:1rpx solid #edf0ed; font-size:24rpx; }.waitlist-card button { width:100%; margin:0; }.player-row { display:flex; align-items:center; justify-content:space-between; gap:12rpx; margin-top:14rpx; padding:20rpx 24rpx; }.inline { min-width:108rpx; min-height:56rpx; margin:0; padding:0 14rpx; line-height:56rpx; font-size:22rpx; }.empty { color:#758079; text-align:center; }.boundary { margin-top:22rpx; line-height:1.7; }.boundary .muted { display:block; }
.deep-link-target { border-color:#d69a24!important; box-shadow:0 0 0 4rpx rgba(214,154,36,.18); }
</style>
