<script setup lang="ts">
import GameListings from "./sections/GameListings.vue";
import EventRegistrations from "./sections/EventRegistrations.vue";
import HostApplication from "./sections/HostApplication.vue";

import { computed, ref, watch } from "vue";
import type { GameListItem } from "../../types/game";
import {
  onLoad,
  onShareAppMessage,
  onShareTimeline,
  onShow,
} from "@dcloudio/uni-app";

import AppIcon from "../../components/AppIcon.vue";
import SectionEmpty from "../../components/SectionEmpty.vue";
import ReasonForm from "../../components/ReasonForm.vue";
import StatusBadge from "../../components/StatusBadge.vue";
import { endpoints } from "../../services/api";
import { captureAuthSession, isAuthSessionCurrent, useAccessToken } from "../../services/auth-session";
import { useSessionStore } from "../../stores/session";
import { money, shortDate } from "../../utils/format";
import { withPendingCreationKey } from "../../utils/pending-creation-key";
import {
  gameDetailPath,
  gameLevelLabel as displayGameLevel,
} from "../../utils/game-detail";
import { eventDetailPath, eventShareTitle } from "../../utils/event-detail";
import { SHARE_CARD_IMAGES } from "../../config/share";
import {
  consumeCommunityIntent,
  openMemberPage,
  requestMemberLogin,
} from "../../utils/member-navigation";

const session = useSessionStore();
const tab = ref<"games" | "events">("games");
const view = ref<"browse" | "mine">("browse");
const showPast = ref(false);
const showHostApplication = ref(false);
const expanded = ref<Record<string, boolean>>({});
const games = ref<GameListItem[]>([]);
const events = ref<any[]>([]);
const eventRegistrations = ref<Record<string, any>>({});
const loading = ref(false);
const actionKey = ref("");
const errorMessage = ref("");
const cancellingEventId = ref("");
const cancelError = ref("");
function eventCancelDescription(event: any) {
  const registration = eventRegistration(event.id)?.registration;
  const status = registration?.status;
  if (
    status === "PAID" &&
    registration.order?.payableCents === 0 &&
    registration.order?.paidCents === 0
  ) {
    return "确认后退出报名，无需退款，释放席位并按顺序晋级候补。";
  }
  return status === "PAID"
    ? "确认后进入退款审批；审批成功前仍占用席位且不能签到，驳回后恢复报名。"
    : status === "WAITLISTED"
      ? "确认后退出候补队列，不会产生订单或费用。"
      : "确认后取消待付款订单，释放席位并按顺序晋级候补。";
}
const hostApplication = ref<any | null>(null);
const targetGameId = ref("");
const targetEventId = ref("");
const activeShare = ref<{ type: "event"; id: string } | null>(null);

const isMember = computed(() => session.isAuthenticated && session.roles.includes("MEMBER"));
const isHost = computed(() => session.isAuthenticated && session.roles.includes("HOST"));
const visibleGames = computed(() =>
  games.value.filter((game) =>
    view.value === "mine"
      ? Boolean(game.myRegistration)
      : showPast.value || ["OPEN", "FULL", "IN_PROGRESS"].includes(game.status),
  ),
);

const visibleEvents = computed(() =>
  events.value.filter((event) =>
    view.value === "mine"
      ? Boolean(eventRegistrations.value[event.id]?.registration) ||
        event.id === targetEventId.value
      : showPast.value ||
        ["OPEN", "FULL", "IN_PROGRESS"].includes(event.status) ||
        event.id === targetEventId.value,
  ),
);

const applicationStatusLabel: Record<string, string> = {
  APPLIED: "待审核",
  APPROVED: "已通过",
  REJECTED: "未通过",
  CANCELLED: "已撤回",
};
const registrationStatusLabel: Record<string, string> = {
  WAITLISTED: "候补中",
  REGISTERED: "已报名，待支付",
  PAID: "已支付",
  CHECKED_IN: "已签到",
  NO_SHOW: "未到场",
  COMPLETED: "已完成",
  CANCELLED: "已取消",
  REFUNDED: "已退款",
};
const refundStatusLabel: Record<string, string> = {
  PENDING: "待审核",
  REQUESTED: "待审核",
  APPROVED: "已通过",
  REJECTED: "未通过",
  PROCESSING: "退款处理中",
  SUCCEEDED: "退款完成",
  FAILED: "退款失败",
  CANCELLED: "已取消",
};

function displayApplicationStatus(status?: string) {
  return applicationStatusLabel[status || ""] || "状态更新中";
}

function displayRegistrationStatus(status?: string) {
  return registrationStatusLabel[status || ""] || "状态更新中";
}

function displayRefundStatus(status?: string) {
  return refundStatusLabel[status || ""] || "状态更新中";
}

let loadGeneration = 0;
function clearPrivateState() {
  loadGeneration++;
  games.value = games.value.map(game => ({ ...game, myRegistration: null }));
  eventRegistrations.value = {};
  hostApplication.value = null;
  cancellingEventId.value = "";
  cancelError.value = "";
  actionKey.value = "";
  errorMessage.value = "";
  loading.value = false;
}
watch(useAccessToken(), clearPrivateState, { flush: "sync" });
watch(() => session.user?.id, (id, previous) => {
  if (previous && id !== previous) clearPrivateState();
}, { flush: "sync" });

async function load() {
  const run = ++loadGeneration;
  const owner = captureAuthSession();
  const current = () => run === loadGeneration && isAuthSessionCurrent(owner);
  loading.value = true;
  errorMessage.value = "";
  try {
    // Public content must render even when there is no account or an old login expired.
    const [gameList, eventList] = await Promise.all([endpoints.publicGames(), endpoints.events()]);
    if (!current()) return;
    games.value = gameList;
    const visible = eventList.filter(event =>
      ["OPEN", "FULL", "IN_PROGRESS", "COMPLETED", "CANCELLED"].includes(event.status));
    events.value = targetEventId.value ? [...visible].sort((left, right) =>
      left.id === targetEventId.value ? -1 : right.id === targetEventId.value ? 1 : 0) : visible;
    eventRegistrations.value = {};
    loading.value = false;
    if (!session.isAuthenticated) return;
    const ready = await session.hydrate();
    if (!current()) return;
    if (!ready) { errorMessage.value = "个人报名暂未同步，可继续浏览活动或稍后重试。"; return; }
    const [personalGames, hydratedEvents, registrations] = await Promise.all([
      endpoints.games(),
      Promise.all(events.value.map(async event => {
        if (event.status !== "COMPLETED") return event;
        try { return await endpoints.event(event.id); } catch { return event; }
      })),
      isMember.value ? Promise.all(visible.map(async event => {
        try { return [event.id, await endpoints.myEventRegistration(event.id)] as const; }
        catch { return [event.id, null] as const; }
      })) : Promise.resolve([]),
    ]);
    if (!current()) return;
    games.value = personalGames;
    events.value = hydratedEvents;
    eventRegistrations.value = Object.fromEntries(registrations);
  } catch (cause: any) {
    if (current()) errorMessage.value = cause?.message || "活动列表加载失败，请稍后重试。";
  } finally {
    if (current()) loading.value = false;
  }
}

function loginForRegistrations() {
  requestMemberLogin("/pages/community/index?tab=" + tab.value + "&view=mine");
}

async function applyHost() {
  if (!isMember.value || actionKey.value) return;
  const owner = captureAuthSession();
  const confirmed = await uni.showModal({
    title: "申请成为球局主理人",
    content:
      "提交后由管理员审核服务记录。审核通过前不能创建或发布球局，是否继续？",
    confirmText: "提交申请",
  });
  if (!confirmed.confirm || !isAuthSessionCurrent(owner)) return;
  actionKey.value = "host-apply";
  errorMessage.value = "";
  try {
    const application = await endpoints.applyHost();
    if (!isAuthSessionCurrent(owner)) return;
    hostApplication.value = application;
    uni.showModal({
      title: "申请已提交",
      content: "当前状态：待审核。重复提交不会生成第二条申请。",
      showCancel: false,
    });
  } catch (cause: any) {
    if (isAuthSessionCurrent(owner)) errorMessage.value = cause?.message || "主理人申请提交失败。";
  } finally {
    if (isAuthSessionCurrent(owner)) actionKey.value = "";
  }
}

function openHostWorkbench() {
  uni.navigateTo({ url: "/packages/ops/pages/host/index" });
}

function joinEvent(event: any) {
  if (!isMember.value || actionKey.value) return;
  openMemberPage(
    "/pages/event-signup/index?id=" + encodeURIComponent(event.id),
  );
}

function eventRegistration(eventId: string) {
  return eventRegistrations.value[eventId] || null;
}

function latestRegistrationRefund(eventId: string) {
  return eventRegistration(eventId)?.registration?.order?.refunds?.[0] || null;
}

function hasActiveEventRegistration(eventId: string) {
  return [
    "WAITLISTED",
    "REGISTERED",
    "PAID",
    "CHECKED_IN",
    "COMPLETED",
  ].includes(eventRegistration(eventId)?.registration?.status);
}

function canCancelEventRegistration(event: any) {
  const registration = eventRegistration(event.id)?.registration;
  return Boolean(
    isMember.value &&
    registration?.isCaptain !== false &&
    ["OPEN", "FULL"].includes(event.status) &&
    ["WAITLISTED", "REGISTERED", "PAID"].includes(registration?.status) &&
    !registration?.cancellationPending &&
    !registration?.cancelIdempotencyKey,
  );
}

async function cancelEventRegistration(event: any, reason: string) {
  if (!canCancelEventRegistration(event) || actionKey.value) return;
  const registration = eventRegistration(event.id)?.registration;
  if (reason.trim().length < 2) return;
  const owner = captureAuthSession();
  cancelError.value = "";
  actionKey.value = `event-cancel-registration:${event.id}`;
  errorMessage.value = "";
  try {
    const command = { eventId: event.id, teamId: registration.id, reason };
    const result: any = await withPendingCreationKey(
      "event.registration.cancel",
      command,
      (idempotencyKey) =>
        endpoints.cancelEventRegistration(event.id, {
          reason,
          idempotencyKey,
        }),
    );
    if (!isAuthSessionCurrent(owner)) return;
    cancellingEventId.value = "";
    uni.showToast({
      title:
        result?.outcome === "REFUND_REQUESTED"
          ? "退款申请已提交"
          : "已退出报名",
      icon: "success",
    });
    await load();
  } catch (cause: any) {
    if (isAuthSessionCurrent(owner)) cancelError.value = cause?.message || "退出赛事报名失败，请重试。";
  } finally {
    if (isAuthSessionCurrent(owner)) actionKey.value = "";
  }
}

function openEventOrder(event: any) {
  const id = eventRegistration(event.id)?.registration?.order?.id;
  openMemberPage(
    id
      ? "/pages/order/index?id=" + encodeURIComponent(id)
      : "/pages/order/index?status=PENDING",
  );
}

function rankedTeams(event: any) {
  return [...(event.standings || [])]
    .filter((team: any) => Number(team.finalRank || 0) > 0)
    .sort(
      (left: any, right: any) =>
        Number(left.finalRank) - Number(right.finalRank),
    );
}

function myEventTeam(event: any) {
  const registration = eventRegistration(event.id)?.registration;
  return Number(registration?.finalRank || 0) > 0 ? registration : null;
}

function rememberShare(type: "event", id: string) {
  activeShare.value = { type, id };
}

onShareAppMessage((options: any) => {
  const shareType = String(options?.target?.dataset?.shareType || "");
  const eventId = String(options?.target?.dataset?.eventId || "");
  if (shareType === "event-result") {
    const event = events.value.find((item) => item.id === eventId);
    if (event) {
      return {
        title: eventShareTitle(event),
        path: eventDetailPath(event.id, true),
        imageUrl: SHARE_CARD_IMAGES.competition,
      };
    }
  }
  return {
    title: "延庆金羽｜找球搭子与积分赛",
    path: "/pages/community/index",
    imageUrl: SHARE_CARD_IMAGES.competition,
  };
});

onShareTimeline(() => {
  if (activeShare.value?.type === "event") {
    const event = events.value.find(
      (item) => item.id === activeShare.value?.id,
    );
    if (event) {
      return {
        title: eventShareTitle(event),
        query: `tab=events&eventId=${encodeURIComponent(event.id)}`,
        imageUrl: SHARE_CARD_IMAGES.competition,
      };
    }
  }
  return {
    title: "延庆金羽｜找球搭子与积分赛",
    imageUrl: SHARE_CARD_IMAGES.competition,
  };
});

function applyNavigation(options: any) {
  if (options?.tab === "games" || options?.tab === "events")
    tab.value = options.tab;
  if (options?.view === "mine" || options?.view === "browse")
    view.value = options.view;
  if (options?.gameId) {
    tab.value = "games";
    targetGameId.value = String(options.gameId);
  }
  if (options?.eventId) {
    tab.value = "events";
    targetEventId.value = String(options.eventId);
    expanded.value[String(options.eventId)] = true;
  }
}
function changeView(next: "browse" | "mine") {
  view.value = next;
  targetGameId.value = "";
  targetEventId.value = "";
}
onLoad(applyNavigation);
onShow(() => {
  const intent = consumeCommunityIntent();
  if (intent) {
    targetGameId.value = "";
    targetEventId.value = "";
    applyNavigation(intent);
  }
  if (targetGameId.value) {
    const destination = gameDetailPath(targetGameId.value, true);
    targetGameId.value = "";
    // Consume old game invitations once; returning to this tab must not reopen it.
    uni.navigateTo({ url: destination });
    return;
  }
  if (targetEventId.value && view.value !== "mine") {
    const destination = eventDetailPath(targetEventId.value, true);
    targetEventId.value = "";
    uni.navigateTo({ url: destination });
    return;
  }
  void load();
});
</script>

<template>
  <view class="page safe-bottom">
    <view class="journey-tabs"
      ><button
        :class="{ active: view === 'browse' }"
        @tap="changeView('browse')"
      >
        找活动</button
      ><button :class="{ active: view === 'mine' }" @tap="changeView('mine')">
        我的报名
      </button></view
    >
    <view class="tabs" role="tablist" aria-label="活动类型">
      <view
        class="tab-option"
        :class="{ active: tab === 'games' }"
        role="tab"
        tabindex="0"
        :aria-selected="tab === 'games'"
        @tap="tab = 'games'"
        @keyup.enter="tab = 'games'"
      >
        <AppIcon
          name="sport"
          :size="30"
          :tone="tab === 'games' ? 'primary' : 'muted'"
        /><text>日常球局</text>
      </view>
      <view
        class="tab-option"
        :class="{ active: tab === 'events' }"
        role="tab"
        tabindex="0"
        :aria-selected="tab === 'events'"
        @tap="tab = 'events'"
        @keyup.enter="tab = 'events'"
      >
        <AppIcon
          name="event"
          :size="30"
          :tone="tab === 'events' ? 'primary' : 'muted'"
        /><text>金羽积分赛</text>
      </view>
    </view>

    <view v-if="errorMessage" class="card error-card">
      <view class="error-icon"
        ><AppIcon name="warning" :size="34" tone="danger"
      /></view>
      <view
        ><text class="error-title">操作未完成</text
        ><text class="error-copy">{{ errorMessage }}</text></view
      >
      <button
        class="secondary retry"
        :disabled="loading || Boolean(actionKey)"
        @tap="load"
      >
        <AppIcon name="refresh" :size="26" />重试
      </button>
    </view>

    <view v-if="view === 'mine' && !session.isAuthenticated" class="card guest-registration">
      <text class="guest-title">登录后查看我的报名</text>
      <text class="muted">你可以先浏览球局和赛事，报名时再登录。</text>
      <button class="primary" @tap="loginForRegistrations">去登录</button>
      <button class="secondary" @tap="changeView('browse')">继续找活动</button>
    </view>
    <view v-else-if="loading" class="loading-stack"
      ><view class="card activity-skeleton skeleton" /><view
        class="card activity-skeleton skeleton"
    /></view>

    <GameListings
      v-else-if="tab === 'games'"
      :tab="tab"
      :visibleGames="visibleGames"
      :displayRegistrationStatus="displayRegistrationStatus"
      :errorMessage="errorMessage"
      :view="view"
    />

    <EventRegistrations
      v-else-if="!loading"
      :loading="loading"
      :visibleEvents="visibleEvents"
      :targetEventId="targetEventId"
      :view="view"
      :expanded="expanded"
      :isMember="isMember"
      :hasActiveEventRegistration="hasActiveEventRegistration"
      :eventRegistration="eventRegistration"
      :latestRegistrationRefund="latestRegistrationRefund"
      :displayRefundStatus="displayRefundStatus"
      :displayRegistrationStatus="displayRegistrationStatus"
      :rankedTeams="rankedTeams"
      :myEventTeam="myEventTeam"
      :openEventOrder="openEventOrder"
      :canCancelEventRegistration="canCancelEventRegistration"
      :actionKey="actionKey"
      v-model:cancellingEventId="cancellingEventId"
      v-model:cancelError="cancelError"
      :joinEvent="joinEvent"
      :rememberShare="rememberShare"
      :eventCancelDescription="eventCancelDescription"
      :cancelEventRegistration="cancelEventRegistration"
      :errorMessage="errorMessage"
    />
    <button
      v-if="view === 'browse'"
      class="quiet-entry"
      @tap="showPast = !showPast"
    >
      {{ showPast ? "收起往期活动" : "查看往期活动" }}
    </button>
    <button
      v-else
      class="quiet-entry"
      @tap="openMemberPage('/pages/order/index')"
    >
      查看全部订单（含已取消）
    </button>
    <button
      v-if="tab === 'games'"
      class="quiet-entry"
      @tap="showHostApplication = !showHostApplication"
    >
      {{ showHostApplication ? "收起组织球局入口" : "我想组织球局" }}
    </button>
    <HostApplication
      v-if="tab === 'games' && showHostApplication"
      :tab="tab"
      :showHostApplication="showHostApplication"
      :hostApplication="hostApplication"
      :displayApplicationStatus="displayApplicationStatus"
      :isHost="isHost"
      :openHostWorkbench="openHostWorkbench"
      :isMember="isMember"
      :actionKey="actionKey"
      :loading="loading"
      :applyHost="applyHost"
    />
  </view>
</template>

<style scoped src="./page.css"></style>
