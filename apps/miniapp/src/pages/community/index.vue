<script setup lang="ts">
import { computed, ref } from "vue";
import {
  onLoad,
  onShareAppMessage,
  onShareTimeline,
  onShow,
} from "@dcloudio/uni-app";

import SectionEmpty from "../../components/SectionEmpty.vue";
import StatusBadge from "../../components/StatusBadge.vue";
import { endpoints } from "../../services/api";
import { useSessionStore } from "../../stores/session";
import { money, shortDate } from "../../utils/format";
import { withPendingCreationKey } from "../../utils/pending-creation-key";

const session = useSessionStore();
const tab = ref<"games" | "events">("games");
const games = ref<any[]>([]);
const events = ref<any[]>([]);
const eventRegistrations = ref<Record<string, any>>({});
const loading = ref(false);
const actionKey = ref("");
const errorMessage = ref("");
const hostApplication = ref<any | null>(null);
const targetGameId = ref("");
const targetEventId = ref("");
const eventPartnerInvites = ref<
  Record<
    string,
    {
      partnerInviteCode: string;
      partnerDisplayName: string;
      expiresAt: string;
    }
  >
>({});
const activeShare = ref<{ type: "game" | "event"; id: string } | null>(null);

const isMember = computed(() => session.roles.includes("MEMBER"));
const isHost = computed(() => session.roles.includes("HOST"));
const visibleGames = computed(() => {
  if (!targetGameId.value) return games.value;
  return [...games.value].sort((left, right) => {
    if (left.id === targetGameId.value) return -1;
    if (right.id === targetGameId.value) return 1;
    return 0;
  });
});

const gameLevelLabel: Record<string, string> = {
  BEGINNER: "新手友好",
  BASIC: "基础",
  INTERMEDIATE: "进阶",
  ADVANCED: "高水平",
  RECREATIONAL: "休闲",
  ALL_LEVELS: "不限水平",
};
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

function displayGameLevel(level?: string) {
  return gameLevelLabel[level || ""] || "不限水平";
}

function displayApplicationStatus(status?: string) {
  return applicationStatusLabel[status || ""] || "状态更新中";
}

function displayRegistrationStatus(status?: string) {
  return registrationStatusLabel[status || ""] || "状态更新中";
}

function displayRefundStatus(status?: string) {
  return refundStatusLabel[status || ""] || "状态更新中";
}

async function load() {
  const ready = await session.hydrate();
  if (!ready) return;
  loading.value = true;
  errorMessage.value = "";
  try {
    const [gameList, eventList] = await Promise.all([
      endpoints.games(),
      endpoints.events(),
    ]);
    games.value = (gameList as any[]).filter((game) =>
      ["OPEN", "FULL"].includes(game.status),
    );
    const visibleEvents = (eventList as any[]).filter((event) =>
      ["OPEN", "FULL", "IN_PROGRESS", "COMPLETED", "CANCELLED"].includes(
        event.status,
      ),
    );
    const hydratedEvents = await Promise.all(
      visibleEvents.map(async (event) => {
        if (event.status !== "COMPLETED") return event;
        try {
          return await endpoints.event(event.id);
        } catch {
          return event;
        }
      }),
    );
    events.value = targetEventId.value
      ? [...hydratedEvents].sort((left, right) => {
          if (left.id === targetEventId.value) return -1;
          if (right.id === targetEventId.value) return 1;
          return 0;
        })
      : hydratedEvents;
    if (isMember.value) {
      const registrations = await Promise.all(
        visibleEvents.map(async (event) => {
          try {
            return [
              event.id,
              await endpoints.myEventRegistration(event.id),
            ] as const;
          } catch {
            return [event.id, null] as const;
          }
        }),
      );
      eventRegistrations.value = Object.fromEntries(registrations);
    } else {
      eventRegistrations.value = {};
    }
  } catch (cause: any) {
    errorMessage.value = cause?.message || "活动列表加载失败，请稍后重试。";
  } finally {
    loading.value = false;
  }
}

async function applyHost() {
  if (!isMember.value || actionKey.value) return;
  const confirmed = await uni.showModal({
    title: "申请成为球局主理人",
    content:
      "提交后由管理员审核服务记录。审核通过前不能创建或发布球局，是否继续？",
    confirmText: "提交申请",
  });
  if (!confirmed.confirm) return;
  actionKey.value = "host-apply";
  errorMessage.value = "";
  try {
    hostApplication.value = await endpoints.applyHost();
    uni.showModal({
      title: "申请已提交",
      content: "当前状态：待审核。重复提交不会生成第二条申请。",
      showCancel: false,
    });
  } catch (cause: any) {
    errorMessage.value = cause?.message || "主理人申请提交失败。";
  } finally {
    actionKey.value = "";
  }
}

function openHostWorkbench() {
  uni.navigateTo({ url: "/packages/ops/pages/host/index" });
}

async function joinGame(game: any) {
  if (!isMember.value || actionKey.value) return;
  if (!["OPEN", "FULL"].includes(game.status)) {
    errorMessage.value = "该球局当前不在报名期。";
    return;
  }
  const confirmed = await uni.showModal({
    title: game.status === "FULL" ? "加入候补队列" : "确认报名球局",
    content: `${game.title}\n${shortDate(game.startsAt)} · ${money(game.feeCents)}\n${game.status === "FULL" ? "当前满员，提交后按先后顺序候补。" : "提交后生成待支付订单。"}`,
    confirmText: game.status === "FULL" ? "确认候补" : "确认报名",
  });
  if (!confirmed.confirm) return;
  actionKey.value = `game:${game.id}`;
  errorMessage.value = "";
  try {
    const command = { gameId: game.id, sourceChannel: "MINI_PROGRAM" };
    const result: any = await withPendingCreationKey(
      "game.register",
      command,
      (creationIdempotencyKey) =>
        endpoints.registerGame(game.id, creationIdempotencyKey),
    );
    if (
      result?.status === "WAITLISTED" ||
      result?.registration?.status === "WAITLISTED"
    ) {
      uni.showModal({
        title: "已进入候补",
        content: `当前候补第 ${result.waitlistPosition || "—"} 位。有名额释放并被人工晋级后，再完成订单支付。`,
        showCancel: false,
      });
    } else {
      uni.showModal({
        title: "报名成功",
        content: `已生成订单 ${result.orderNo}，请前往订单支付。`,
        showCancel: false,
      });
    }
    await load();
  } catch (cause: any) {
    errorMessage.value = cause?.message || "球局报名失败。";
  } finally {
    actionKey.value = "";
  }
}

async function joinEvent(event: any) {
  if (!isMember.value || actionKey.value) return;
  if (!["OPEN", "FULL"].includes(event.status)) {
    errorMessage.value = "该赛事当前不在报名期。";
    return;
  }
  const teamInput = await uni.showModal({
    title: "填写队伍名称",
    editable: true,
    placeholderText: "例如：金羽搭档",
  });
  if (!teamInput.confirm) return;
  const teamName = String(teamInput.content || "").trim();
  if (!teamName) {
    errorMessage.value = "请填写队伍名称。";
    return;
  }
  const partnerInput = await uni.showModal({
    title: "填写搭档授权码",
    content: "请粘贴搭档本人刚刚为本赛事生成的一次性授权码。",
    editable: true,
    placeholderText: "以 EP_ 开头的授权码",
  });
  if (!partnerInput.confirm) return;
  const partnerInviteCode = String(partnerInput.content || "").trim();
  if (!partnerInviteCode) {
    errorMessage.value = "请填写搭档授权码。";
    return;
  }
  let partnerPreview: {
    partnerDisplayName: string;
    expiresAt: string;
  };
  try {
    partnerPreview = await endpoints.previewEventPartnerInvite(
      event.id,
      partnerInviteCode,
    );
  } catch (cause: any) {
    errorMessage.value = cause?.message || "搭档授权码无效或已过期。";
    return;
  }
  let categoryResult: UniApp.ShowActionSheetRes;
  try {
    categoryResult = await uni.showActionSheet({
      itemList: ["男双", "女双", "混双"],
    });
  } catch {
    return;
  }
  const category = ["MEN_DOUBLES", "WOMEN_DOUBLES", "MIXED_DOUBLES"][
    categoryResult.tapIndex
  ];
  const confirmed = await uni.showModal({
    title: event.status === "FULL" ? "确认加入候补" : "确认赛事报名",
    content: `${event.name}\n${teamName} · ${session.user?.displayName || "当前会员"} / ${partnerPreview.partnerDisplayName}\n搭档已通过本人账号授权。${event.status === "FULL" ? "满员后按提交顺序进入持久候补，不会提前收费。" : "提交后生成限时待支付订单。"}`,
    confirmText: event.status === "FULL" ? "加入候补" : "确认提交",
  });
  if (!confirmed.confirm) return;
  actionKey.value = `event:${event.id}`;
  errorMessage.value = "";
  try {
    const command = {
      eventId: event.id,
      name: teamName,
      partnerInviteCode,
      category,
      sourceChannel: "MINI_PROGRAM",
    };
    const result: any = await withPendingCreationKey(
      "event.register",
      command,
      (creationIdempotencyKey) =>
        endpoints.registerEvent(event.id, {
          name: teamName,
          partnerInviteCode,
          category,
          creationIdempotencyKey,
        }),
    );
    if (
      result?.status === "WAITLISTED" ||
      result?.registration?.status === "WAITLISTED"
    ) {
      uni.showModal({
        title: "已进入赛事候补",
        content: `当前第 ${result.waitlistPosition || "—"} 位。释放名额后系统按先后顺序晋级，晋级前不会生成订单或收费。`,
        showCancel: false,
      });
    } else {
      const dueAt = result?.eventTeam?.paymentDueAt;
      uni.showModal({
        title: "赛事报名已提交",
        content: `订单 ${result.orderNo} 待支付${dueAt ? `，请于 ${new Date(dueAt).toLocaleString()} 前完成` : ""}。`,
        showCancel: false,
      });
    }
    await load();
  } catch (cause: any) {
    errorMessage.value = cause?.message || "赛事报名失败。";
  } finally {
    actionKey.value = "";
  }
}

async function createEventPartnerInvite(event: any) {
  if (!isMember.value || actionKey.value) return;
  actionKey.value = `event-partner-invite:${event.id}`;
  errorMessage.value = "";
  try {
    const invite = await endpoints.createEventPartnerInvite(event.id);
    eventPartnerInvites.value = {
      ...eventPartnerInvites.value,
      [event.id]: invite,
    };
    let copied = true;
    try {
      await uni.setClipboardData({ data: invite.partnerInviteCode });
    } catch {
      // The code remains visible in the modal when a browser denies clipboard.
      copied = false;
    }
    uni.showModal({
      title: copied ? "搭档授权码已复制" : "搭档授权码",
      content: `${invite.partnerInviteCode}\n\n把此码私下发给队长。授权码仅用于“${event.name}”，15分钟内一次有效；队长报名成功后即失效。`,
      showCancel: false,
    });
  } catch (cause: any) {
    errorMessage.value = cause?.message || "搭档授权码生成失败。";
  } finally {
    actionKey.value = "";
  }
}

async function copyEventPartnerInvite(eventId: string) {
  const invite = eventPartnerInvites.value[eventId];
  if (!invite) return;
  try {
    await uni.setClipboardData({ data: invite.partnerInviteCode });
  } catch {
    uni.showToast({ title: "复制失败，请长按授权码复制", icon: "none" });
  }
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
    ["OPEN", "FULL"].includes(event.status) &&
    ["WAITLISTED", "REGISTERED", "PAID"].includes(registration?.status) &&
    !registration?.cancellationPending &&
    !registration?.cancelIdempotencyKey,
  );
}

async function cancelEventRegistration(event: any) {
  if (!canCancelEventRegistration(event) || actionKey.value) return;
  const registration = eventRegistration(event.id)?.registration;
  const input = await uni.showModal({
    title: registration.status === "PAID" ? "申请退出并退款" : "退出赛事报名",
    editable: true,
    placeholderText: "请填写退出原因（至少2个字）",
    confirmText: "下一步",
  });
  if (!input.confirm) return;
  const reason = String(input.content || "").trim();
  if (reason.length < 2) {
    errorMessage.value = "退出原因至少需要2个字。";
    return;
  }
  const confirmed = await uni.showModal({
    title: "确认退出",
    content:
      registration.status === "PAID"
        ? "提交后进入财务退款审批；审批成功前仍占用席位，但不能签到。驳回后报名会恢复。"
        : registration.status === "WAITLISTED"
          ? "提交后立即退出候补队列，不会产生订单或费用。"
          : "提交后取消待支付订单并立即释放席位，系统会按进入队列先后顺序晋级候补。",
    confirmText: "确认提交",
  });
  if (!confirmed.confirm) return;
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
    uni.showModal({
      title:
        result?.outcome === "REFUND_REQUESTED"
          ? "退款申请已提交"
          : "已退出报名",
      content:
        result?.outcome === "REFUND_REQUESTED"
          ? "财务审批成功后才会释放席位并原路退款；审批期间不可签到。"
          : "报名/候补已取消，席位流转已完成。",
      showCancel: false,
    });
    await load();
  } catch (cause: any) {
    errorMessage.value = cause?.message || "退出赛事报名失败。";
  } finally {
    actionKey.value = "";
  }
}

function openOrders() {
  uni.navigateTo({ url: "/pages/order/index" });
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

function eventShareTitle(event: any) {
  const champion = rankedTeams(event)[0];
  return champion
    ? `${event.name}冠军榜｜${champion.name}夺冠`
    : `${event.name}｜固定双打五轮瑞士积分赛`;
}

function gameShareTitle(game: any) {
  const joined = Number(game._count?.registrations || 0);
  const remaining = Math.max(0, Number(game.capacity || 0) - joined);
  return game.status === "FULL"
    ? `${game.title}已满员，可加入候补`
    : `${game.title}还差${remaining || "几"}位球友，一起来打球`;
}

// TODO(api): gameId is a temporary routing fallback. Production sharing
// should use a server-signed opaque token carrying game, inviter and expiry.
function gameSharePath(game: any) {
  return `/pages/community/index?tab=games&gameId=${encodeURIComponent(game.id)}`;
}

function rememberShare(type: "game" | "event", id: string) {
  activeShare.value = { type, id };
}

onShareAppMessage((options: any) => {
  const shareType = String(options?.target?.dataset?.shareType || "");
  const gameId = String(options?.target?.dataset?.gameId || "");
  const eventId = String(options?.target?.dataset?.eventId || "");
  if (shareType === "game") {
    const game = games.value.find((item) => item.id === gameId);
    if (game) return { title: gameShareTitle(game), path: gameSharePath(game) };
  }
  if (shareType === "event-result") {
    const event = events.value.find((item) => item.id === eventId);
    if (event) {
      return {
        title: eventShareTitle(event),
        path: `/pages/community/index?tab=events&eventId=${encodeURIComponent(event.id)}`,
      };
    }
  }
  return {
    title: "延庆金羽｜找球搭子与积分赛",
    path: "/pages/community/index",
  };
});

onShareTimeline(() => {
  if (activeShare.value?.type === "game") {
    const game = games.value.find((item) => item.id === activeShare.value?.id);
    if (game) {
      return {
        title: gameShareTitle(game),
        query: `tab=games&gameId=${encodeURIComponent(game.id)}`,
      };
    }
  }
  if (activeShare.value?.type === "event") {
    const event = events.value.find((item) => item.id === activeShare.value?.id);
    if (event) {
      return {
        title: eventShareTitle(event),
        query: `tab=events&eventId=${encodeURIComponent(event.id)}`,
      };
    }
  }
  return { title: "延庆金羽｜找球搭子与积分赛" };
});

onLoad((options: any) => {
  if (options?.tab === "events") tab.value = "events";
  if (options?.gameId) {
    tab.value = "games";
    targetGameId.value = String(options.gameId);
  }
  if (options?.eventId) {
    tab.value = "events";
    targetEventId.value = String(options.eventId);
  }
});

onShow(load);
</script>

<template>
  <view class="page safe-bottom">
    <view class="tabs">
      <view :class="{ active: tab === 'games' }" @tap="tab = 'games'"
        >日常球局</view
      >
      <view :class="{ active: tab === 'events' }" @tap="tab = 'events'"
        >金羽积分赛</view
      >
    </view>

    <view class="card invite-guide">
      <text class="invite-guide-title">邀请与报名不要混用</text>
      <text v-if="tab === 'games'" class="invite-guide-copy"
        >“邀请球友”只分享当前拼场球局；邀请好友首次使用小程序，请到“我的”页面。</text
      >
      <text v-else class="invite-guide-copy"
        >积分赛采用真实搭档确认：搭档本人生成赛事授权码，队长确认姓名后再报名。该授权码不是拉新邀请码。</text
      >
    </view>

    <view v-if="errorMessage" class="card error-card">
      <view
        ><text class="error-title">操作未完成</text
        ><text class="error-copy">{{ errorMessage }}</text></view
      >
      <button
        class="secondary retry"
        :disabled="loading || Boolean(actionKey)"
        @tap="load"
      >
        重试
      </button>
    </view>

    <view v-if="tab === 'games'" class="card host-entry">
      <view>
        <text class="host-title">发起自己的球局</text>
        <text class="muted"
          >会员先申请主理人；审核通过后可创建草稿、发布、管理候补和签到。</text
        >
        <text v-if="hostApplication" class="application-state"
          >申请状态：{{ displayApplicationStatus(hostApplication.status) }}</text
        >
      </view>
      <button
        v-if="isHost"
        class="primary host-button"
        @tap="openHostWorkbench"
      >
        进入主理人工作台
      </button>
      <button
        v-else-if="isMember && hostApplication?.status !== 'APPLIED'"
        class="secondary host-button"
        :loading="actionKey === 'host-apply'"
        :disabled="loading || Boolean(actionKey)"
        @tap="applyHost"
      >
        申请成为主理人
      </button>
      <button v-else-if="isMember" class="secondary host-button" disabled>
        申请审核中
      </button>
    </view>

    <view v-if="loading" class="card state-card">活动列表同步中…</view>

    <template v-else-if="tab === 'games'">
      <view
        v-for="game in visibleGames"
        :key="game.id"
        class="card activity"
        :class="{ 'invited-game': targetGameId === game.id }"
      >
        <view class="row"
          ><StatusBadge :value="game.status" /><text class="muted">{{
            shortDate(game.startsAt)
          }}</text></view
        >
        <text class="title">{{ game.title }}</text>
        <text v-if="targetGameId === game.id" class="invite-context"
          >好友邀请你加入这场球局</text
        >
        <text class="muted"
          >主理人 {{ game.host?.displayName || "待显示" }} · {{ displayGameLevel(game.level) }} ·
          {{ game._count?.registrations || 0 }}/{{ game.capacity }} 人</text
        >
        <view class="row footer">
          <text class="money">{{ money(game.feeCents) }}</text>
          <view class="game-actions">
            <button
              v-if="['OPEN', 'FULL'].includes(game.status)"
              class="secondary join invite-game"
              open-type="share"
              data-share-type="game"
              :data-game-id="game.id"
              @tap="rememberShare('game', game.id)"
            >
              邀请球友
            </button>
            <button
              v-if="isMember && ['OPEN', 'FULL'].includes(game.status)"
              class="primary join"
              :loading="actionKey === `game:${game.id}`"
              :disabled="Boolean(actionKey)"
              @tap="joinGame(game)"
            >
              {{ game.status === "FULL" ? "加入候补" : "立即报名" }}
            </button>
            <text v-else class="muted">{{
              isMember ? "当前不可报名" : "会员账号可报名"
            }}</text>
          </view>
        </view>
      </view>
      <SectionEmpty v-if="!games.length" title="暂无开放球局" />
    </template>

    <template v-else-if="!loading">
      <view class="rules card">
        <text class="rules-title">固定双打 · 五轮瑞士制</text>
        <text class="muted"
          >单局21分，20平不加分；男双对女双让5分，男双对混双让2分，混双对女双让2分。</text
        >
      </view>
      <view
        v-for="event in events"
        :key="event.id"
        class="card activity"
        :class="{ 'invited-event': targetEventId === event.id }"
      >
        <view class="row"
          ><StatusBadge :value="event.status" /><text class="muted">{{
            shortDate(event.startsAt)
          }}</text></view
        >
        <text class="title">{{ event.name }}</text>
        <text v-if="targetEventId === event.id" class="invite-context"
          >好友分享了这场赛事的战绩</text
        >
        <text class="muted"
          >{{ event.minimumPeople }}人成赛 · {{ event.capacityPeople }}人封顶 ·
          {{ event.totalRounds }}轮</text
        >
        <text v-if="event.sponsor" class="sponsor"
          >合作伙伴：{{ event.sponsor }}</text
        >
        <view
          v-if="
            isMember &&
            ['OPEN', 'FULL'].includes(event.status) &&
            !hasActiveEventRegistration(event.id)
          "
          class="event-signup-guide"
        >
          <text class="event-signup-title">固定双打 · 两人确认</text>
          <text class="event-signup-copy"
            >1. 搭档本人生成授权码并私下发给队长；2. 队长点击报名，核对双方姓名后提交。</text
          >
          <view
            v-if="eventPartnerInvites[event.id]"
            class="partner-invite-result"
          >
            <text class="partner-invite-label">我的赛事搭档授权码</text>
            <text class="partner-invite-code">{{
              eventPartnerInvites[event.id].partnerInviteCode
            }}</text>
            <text class="partner-invite-expiry"
              >15 分钟内一次有效，报名成功后立即失效</text
            >
            <button
              class="secondary partner-copy-button"
              @tap="copyEventPartnerInvite(event.id)"
            >
              再次复制
            </button>
          </view>
        </view>
        <view
          v-if="eventRegistration(event.id)?.registration"
          class="registration-card"
        >
          <template
            v-if="eventRegistration(event.id).registration.cancellationPending"
          >
            <text class="registration-title">退出退款待财务审批</text>
            <text class="muted"
              >报名席位暂时保留且不可签到；财务成功退款后释放，驳回后恢复报名。</text
            >
            <text v-if="latestRegistrationRefund(event.id)" class="refund-state"
              >退款状态：{{ displayRefundStatus(latestRegistrationRefund(event.id).status) }} ·
              {{ money(latestRegistrationRefund(event.id).amountCents) }}</text
            >
          </template>
          <template
            v-else-if="
              eventRegistration(event.id).registration.status === 'WAITLISTED'
            "
          >
            <text class="registration-title"
              >我的候补：第
              {{ eventRegistration(event.id).waitlistPosition || "—" }} 位</text
            >
            <text class="muted"
              >按进入队列先后顺序晋级；晋级前无订单、不会收费。</text
            >
          </template>
          <template
            v-else-if="
              eventRegistration(event.id).registration.status === 'CANCELLED'
            "
          >
            <text class="registration-title">报名已取消</text>
            <text class="muted"
              >{{
                eventRegistration(event.id).registration.cancelReason ||
                "退出已处理"
              }}；待支付订单已关闭，席位已释放。</text
            >
          </template>
          <template
            v-else-if="
              eventRegistration(event.id).registration.status === 'REFUNDED'
            "
          >
            <text class="registration-title">退出退款已完成</text>
            <text class="muted">报名费用已退，席位已释放并触发候补晋级。</text>
          </template>
          <template
            v-else-if="
              latestRegistrationRefund(event.id)?.status === 'REJECTED'
            "
          >
            <text class="registration-title">退款申请未通过，报名已恢复</text>
            <text class="muted"
              >当前仍是有效已支付报名，可联系场馆了解驳回原因。</text
            >
          </template>
          <template v-else>
            <text class="registration-title"
              >我的报名：{{
                displayRegistrationStatus(eventRegistration(event.id).registration.status)
              }}</text
            >
            <text
              v-if="eventRegistration(event.id).registration.paymentDueAt"
              class="muted"
              >支付保留至
              {{
                new Date(
                  eventRegistration(event.id).registration.paymentDueAt,
                ).toLocaleString()
              }}</text
            >
          </template>
        </view>
        <view v-if="event.status === 'CANCELLED'" class="cancel-card">
          <text class="registration-title">赛事已取消</text>
          <text class="muted"
            >{{
              event.cancelReason || "运营方已取消赛事"
            }}。已支付报名费会生成退款申请，由财务复核后原路处理。</text
          >
        </view>
        <view
          v-if="event.status === 'COMPLETED' && rankedTeams(event).length"
          class="ranking-card"
        >
          <text class="ranking-title">冠军榜</text>
          <text
            v-for="team in rankedTeams(event).slice(0, 3)"
            :key="`${team.finalRank}-${team.name}`"
            class="ranking-line"
            >第{{ team.finalRank }}名 · {{ team.name }} ·
            {{ team.points || 0 }}分 · {{ team.wins || 0 }}胜</text
          >
          <text v-if="myEventTeam(event)" class="my-result"
            >我的战绩：第{{ myEventTeam(event).finalRank }}名 ·
            {{ myEventTeam(event).points || 0 }}分 · 净胜分
            {{ myEventTeam(event).scoreDiff || 0 }}</text
          >
        </view>
        <view class="row footer">
          <text class="money">{{ money(event.feeCents) }}</text>
          <view class="event-actions">
            <button
              v-if="
                isMember &&
                ['OPEN', 'FULL'].includes(event.status) &&
                !hasActiveEventRegistration(event.id)
              "
              class="secondary join partner-invite"
              :loading="actionKey === `event-partner-invite:${event.id}`"
              :disabled="Boolean(actionKey)"
              @tap="createEventPartnerInvite(event)"
            >
              搭档生成码
            </button>
            <button
              v-if="
                eventRegistration(event.id)?.registration?.status ===
                'REGISTERED'
              "
              class="secondary join"
              @tap="openOrders"
            >
              去支付
            </button>
            <button
              v-if="canCancelEventRegistration(event)"
              class="secondary join danger"
              :loading="actionKey === `event-cancel-registration:${event.id}`"
              :disabled="Boolean(actionKey)"
              @tap="cancelEventRegistration(event)"
            >
              退出报名
            </button>
            <button
              v-else-if="
                eventRegistration(event.id)?.registration?.cancellationPending
              "
              class="secondary join"
              disabled
            >
              退款审核中
            </button>
            <button
              v-else-if="
                isMember &&
                ['OPEN', 'FULL'].includes(event.status) &&
                !hasActiveEventRegistration(event.id)
              "
              class="secondary join"
              :loading="actionKey === `event:${event.id}`"
              :disabled="Boolean(actionKey)"
              @tap="joinEvent(event)"
            >
              {{ event.status === "FULL" ? "队长候补" : "队长报名" }}
            </button>
            <button
              v-else-if="event.status === 'COMPLETED'"
              class="secondary join"
              open-type="share"
              data-share-type="event-result"
              :data-event-id="event.id"
              @tap="rememberShare('event', event.id)"
            >
              分享战绩
            </button>
            <text v-else class="muted">{{
              isMember ? "当前不可报名" : "会员账号可报名"
            }}</text>
          </view>
        </view>
      </view>
      <SectionEmpty v-if="!events.length" title="赛事筹备中" />
    </template>
  </view>
</template>

<style scoped>
.tabs {
  display: grid;
  grid-template-columns: 1fr 1fr;
  padding: 8rpx;
  margin-bottom: 26rpx;
  background: #e7ece8;
  border-radius: 22rpx;
  text-align: center;
}
.tabs view {
  padding: 20rpx;
  color: #788079;
  border-radius: 17rpx;
}
.tabs .active {
  color: #174b30;
  background: #fff;
  box-shadow: 0 6rpx 18rpx rgba(29, 67, 44, 0.08);
  font-weight: 700;
}
.error-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16rpx;
  color: #8a3636;
  background: #fff4f2;
}
.error-card > view {
  flex: 1 1 auto;
  min-width: 0;
}
.error-title,
.error-copy {
  display: block;
}
.error-title {
  font-weight: 800;
}
.error-copy {
  margin-top: 8rpx;
  font-size: 23rpx;
  line-height: 1.5;
}
.retry {
  flex: 0 0 auto;
  min-height: 58rpx;
  margin: 0;
  line-height: 58rpx;
  font-size: 22rpx;
}
.host-entry {
  display: grid;
  gap: 20rpx;
  background: #f8fbf8;
}
.host-title {
  display: block;
  margin-bottom: 10rpx;
  font-size: 29rpx;
  font-weight: 800;
}
.host-entry .muted {
  display: block;
  line-height: 1.6;
}
.application-state {
  display: block;
  margin-top: 12rpx;
  color: #9b6300;
  font-size: 23rpx;
}
.host-button {
  width: 100%;
  margin: 0;
}
.state-card {
  color: #758079;
  text-align: center;
}
.activity .title {
  display: block;
  margin: 26rpx 0 12rpx;
  font-size: 34rpx;
  font-weight: 800;
  overflow-wrap: anywhere;
}
.footer {
  align-items: flex-end;
  flex-wrap: wrap;
  margin-top: 26rpx;
}
.join {
  min-width: 170rpx;
  min-height: 72rpx;
  padding: 14rpx 20rpx;
  margin: 0;
  line-height: 1.35;
  font-size: 24rpx;
  white-space: normal;
}
.game-actions {
  display: flex;
  flex: 1 1 360rpx;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 12rpx;
}
.game-actions .join {
  flex: 0 1 auto;
}
.invite-game {
  color: #17653d;
  background: #fff;
  border: 1rpx solid #bdd7c6;
}
.invited-game {
  border-color: rgba(23, 101, 61, 0.45);
  box-shadow: 0 12rpx 36rpx rgba(23, 101, 61, 0.14);
}
.invited-event {
  border-color: rgba(23, 101, 61, 0.45);
  box-shadow: 0 12rpx 36rpx rgba(23, 101, 61, 0.14);
}
.invite-guide {
  padding: 22rpx 24rpx;
  background: #f8fbf8;
}
.invite-guide-title,
.invite-guide-copy {
  display: block;
}
.invite-guide-title {
  color: #174b30;
  font-size: 25rpx;
  font-weight: 800;
}
.invite-guide-copy {
  margin-top: 8rpx;
  color: #647169;
  font-size: 22rpx;
  line-height: 1.6;
  overflow-wrap: anywhere;
}
.invite-context {
  display: inline-flex;
  max-width: 100%;
  padding: 8rpx 14rpx;
  margin-bottom: 12rpx;
  color: #765e1e;
  background: #fff5d6;
  border-radius: 999rpx;
  font-size: 22rpx;
  line-height: 1.5;
  overflow-wrap: anywhere;
}
.rules {
  background: linear-gradient(135deg, #153f2a, #23714a);
}
.rules-title {
  display: block;
  margin-bottom: 12rpx;
  color: #fff;
  font-size: 31rpx;
  font-weight: 700;
}
.rules .muted {
  color: rgba(255, 255, 255, 0.76);
  line-height: 1.7;
}
.sponsor {
  display: block;
  margin-top: 10rpx;
  color: #846b25;
  font-size: 22rpx;
}
.event-signup-guide {
  margin-top: 18rpx;
  padding: 18rpx;
  color: #345846;
  background: #edf5ef;
  border-radius: 16rpx;
}
.event-signup-title,
.event-signup-copy,
.partner-invite-label,
.partner-invite-code,
.partner-invite-expiry {
  display: block;
}
.event-signup-title,
.partner-invite-label {
  font-size: 23rpx;
  font-weight: 800;
}
.event-signup-copy {
  margin-top: 8rpx;
  font-size: 21rpx;
  line-height: 1.65;
  overflow-wrap: anywhere;
}
.partner-invite-result {
  margin-top: 16rpx;
  padding: 16rpx;
  background: #fff;
  border: 1rpx solid #d6e7dc;
  border-radius: 14rpx;
}
.partner-invite-code {
  margin-top: 10rpx;
  padding: 12rpx 14rpx;
  color: #174b30;
  background: #f4f7f4;
  border-radius: 12rpx;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 21rpx;
  line-height: 1.5;
  overflow-wrap: anywhere;
  word-break: break-all;
  white-space: normal;
  user-select: text;
}
.partner-invite-expiry {
  margin-top: 8rpx;
  color: #758079;
  font-size: 20rpx;
  line-height: 1.5;
}
.partner-copy-button {
  width: 100%;
  min-height: 72rpx;
  margin: 14rpx 0 0;
  line-height: 1.35;
  font-size: 22rpx;
}
.ranking-card {
  margin-top: 18rpx;
  padding: 18rpx;
  background: #f4f8f5;
  border-radius: 16rpx;
}
.ranking-title {
  display: block;
  margin-bottom: 10rpx;
  color: #17653d;
  font-weight: 800;
}
.ranking-line {
  display: block;
  margin-top: 7rpx;
  color: #456052;
  font-size: 22rpx;
}
.my-result {
  display: block;
  margin-top: 12rpx;
  padding-top: 12rpx;
  color: #765e1e;
  border-top: 1rpx solid #dce7df;
  font-size: 22rpx;
  font-weight: 700;
}
.registration-card,
.cancel-card {
  margin-top: 18rpx;
  padding: 18rpx;
  background: #f4f8f5;
  border-radius: 16rpx;
}
.cancel-card {
  background: #fff3ef;
}
.registration-title {
  display: block;
  margin-bottom: 8rpx;
  color: #17653d;
  font-size: 24rpx;
  font-weight: 800;
}
.cancel-card .registration-title {
  color: #9a493d;
}
.refund-state {
  display: block;
  margin-top: 10rpx;
  color: #9b6300;
  font-size: 22rpx;
  font-weight: 700;
}
.event-actions {
  display: flex;
  flex: 1 1 360rpx;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 12rpx;
}
.event-actions .join {
  flex: 1 1 210rpx;
  min-width: 0;
}
.event-actions .danger {
  color: #9a493d;
  border-color: #d8aaa2;
}
.event-actions .partner-invite {
  color: #17653d;
  border-color: #bdd7c6;
  background: #fff;
}
@media (max-width: 420px) {
  .error-card { align-items: stretch; flex-wrap: wrap; }
  .retry { width: 100%; }
  .footer { align-items: stretch; }
  .footer > .money { width: 100%; }
  .game-actions,.event-actions { flex-basis: 100%; justify-content: stretch; }
  .game-actions .join,.event-actions .join { flex: 1 1 220rpx; min-width: 0; }
}
</style>
