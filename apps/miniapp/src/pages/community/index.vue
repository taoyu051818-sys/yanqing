<script setup lang="ts">
import { computed, ref } from "vue";
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
import { useSessionStore } from "../../stores/session";
import { money, shortDate } from "../../utils/format";
import { withPendingCreationKey } from "../../utils/pending-creation-key";
import { gameDetailPath, gameLevelLabel as displayGameLevel } from "../../utils/game-detail";
import { SHARE_CARD_IMAGES } from "../../config/share";
import { consumeCommunityIntent, openMemberPage, requestMemberLogin } from "../../utils/member-navigation";

const session = useSessionStore();
const tab = ref<"games" | "events">("games");
const view = ref<'browse' | 'mine'>('browse');
const showPast = ref(false);
const showHostApplication = ref(false);
const expanded = ref<Record<string, boolean>>({});
const games = ref<any[]>([]);
const events = ref<any[]>([]);
const eventRegistrations = ref<Record<string, any>>({});
const loading = ref(false);
const actionKey = ref("");
const errorMessage = ref("");
const cancellingEventId = ref("");
const cancelError = ref("");
function eventCancelDescription(event: any) {
  const status = eventRegistration(event.id)?.registration?.status;
  return status === 'PAID'
    ? '确认后进入退款审批；审批成功前仍占用席位且不能签到，驳回后恢复报名。'
    : status === 'WAITLISTED'
      ? '确认后退出候补队列，不会产生订单或费用。'
      : '确认后取消待付款订单，释放席位并按顺序晋级候补。';
}
const hostApplication = ref<any | null>(null);
const targetGameId = ref("");
const targetEventId = ref("");
const activeShare = ref<{ type: "event"; id: string } | null>(null);

const isMember = computed(() => session.roles.includes("MEMBER"));
const isHost = computed(() => session.roles.includes("HOST"));
const visibleGames = computed(() => games.value.filter((game) => view.value === 'mine'
  ? Boolean(game.myRegistration)
  : showPast.value || ['OPEN', 'FULL', 'IN_PROGRESS'].includes(game.status)));

const visibleEvents = computed(() => events.value.filter((event) => view.value === 'mine'
  ? Boolean(eventRegistrations.value[event.id]?.registration) || event.id === targetEventId.value
  : showPast.value || ['OPEN', 'FULL', 'IN_PROGRESS'].includes(event.status) || event.id === targetEventId.value));

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
  if (!session.isAuthenticated) return requestMemberLogin('/pages/community/index?tab=' + tab.value + '&view=' + view.value
    + (targetEventId.value ? '&eventId=' + encodeURIComponent(targetEventId.value) : ''));
  const ready = await session.hydrate();
  if (!ready) { errorMessage.value = '活动暂未同步，请重试。'; return; }
  loading.value = true;
  errorMessage.value = "";
  try {
    const [gameList, eventList] = await Promise.all([
      endpoints.games(),
      endpoints.events(),
    ]);
    games.value = (gameList as any[]).filter((game) =>
      ["OPEN", "FULL", "IN_PROGRESS", "COMPLETED", "CANCELLED"].includes(game.status),
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

function joinEvent(event: any) {
  if (!isMember.value || actionKey.value) return;
  openMemberPage('/pages/event-signup/index?id=' + encodeURIComponent(event.id));
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
    isMember.value && registration?.isCaptain !== false &&
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
  cancelError.value = '';
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
    cancellingEventId.value = '';
    uni.showToast({ title: result?.outcome === 'REFUND_REQUESTED' ? '退款申请已提交' : '已退出报名', icon: 'success' });
    await load();
  } catch (cause: any) {
    cancelError.value = cause?.message || "退出赛事报名失败，请重试。";
  } finally {
    actionKey.value = "";
  }
}

function openEventOrder(event: any) {
  const id = eventRegistration(event.id)?.registration?.order?.id;
  openMemberPage(id ? "/pages/order/index?id=" + encodeURIComponent(id) : "/pages/order/index?status=PENDING");
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
        path: `/pages/community/index?tab=events&eventId=${encodeURIComponent(event.id)}`,
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
    const event = events.value.find((item) => item.id === activeShare.value?.id);
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
  if (options?.tab === 'games' || options?.tab === 'events') tab.value = options.tab;
  if (options?.view === 'mine' || options?.view === 'browse') view.value = options.view;
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
function changeView(next: 'browse' | 'mine') { view.value = next; targetGameId.value = ''; targetEventId.value = ''; }
onLoad(applyNavigation);
onShow(() => {
  const intent = consumeCommunityIntent();
  if (intent) { targetGameId.value = ''; targetEventId.value = ''; applyNavigation(intent); }
  if (targetGameId.value) {
    const destination = gameDetailPath(targetGameId.value, true);
    targetGameId.value = '';
    // Consume old game invitations once; returning to this tab must not reopen it.
    uni.navigateTo({ url: destination });
    return;
  }
  void load();
});
</script>

<template>
  <view class="page safe-bottom">
    <view class="journey-tabs"><button :class="{ active: view === 'browse' }" @tap="changeView('browse')">找活动</button><button :class="{ active: view === 'mine' }" @tap="changeView('mine')">我的报名</button></view>
    <view class="tabs" role="tablist" aria-label="活动类型">
      <view class="tab-option" :class="{ active: tab === 'games' }" role="tab" tabindex="0" :aria-selected="tab === 'games'" @tap="tab = 'games'" @keyup.enter="tab = 'games'">
        <AppIcon name="sport" :size="30" :tone="tab === 'games' ? 'primary' : 'muted'" /><text>日常球局</text>
      </view>
      <view class="tab-option" :class="{ active: tab === 'events' }" role="tab" tabindex="0" :aria-selected="tab === 'events'" @tap="tab = 'events'" @keyup.enter="tab = 'events'">
        <AppIcon name="event" :size="30" :tone="tab === 'events' ? 'primary' : 'muted'" /><text>金羽积分赛</text>
      </view>
    </view>

    <view v-if="errorMessage" class="card error-card">
      <view class="error-icon"><AppIcon name="warning" :size="34" tone="danger" /></view>
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

    <view v-if="loading" class="loading-stack"><view class="card activity-skeleton skeleton" /><view class="card activity-skeleton skeleton" /></view>

    <template v-else-if="tab === 'games'">
      <view
        v-for="game in visibleGames"
        :key="game.id"
        class="card activity"
      >
        <view class="row"
          ><StatusBadge :value="game.status" /><text class="muted">{{
            shortDate(game.startsAt)
          }}</text></view
        >
        <view class="activity-title-row"><view class="activity-icon"><AppIcon name="sport" :size="32" /></view><text class="title">{{ game.title }}</text></view>
        <text class="muted"
          >主理人 {{ game.host?.displayName || "待显示" }} · {{ displayGameLevel(game.level) }} ·
          {{ game._count?.registrations || 0 }}/{{ game.capacity }} 人</text
        >
        <text v-if="game.myRegistration" class="game-list-status">我的报名：{{ displayRegistrationStatus(game.myRegistration.status) }}</text>
        <view class="activity-summary">
          <text class="money">{{ money(game.feeCents) }} / 人</text>
          <button class="secondary" @tap="openMemberPage(gameDetailPath(game.id))">查看球局详情<AppIcon name="chevron" :size="28" /></button>
        </view>
      </view>
      <SectionEmpty v-if="!visibleGames.length && !errorMessage" icon="sport" :title="view === 'mine' ? '还没有球局报名' : '暂无开放球局'" description="可以切换活动类型，或改天再来看看。" />
    </template>

    <template v-else-if="!loading">
      <view
        v-for="event in visibleEvents"
        :key="event.id"
        class="card activity"
        :class="{ 'invited-event': targetEventId === event.id }"
      >
        <view class="row"
          ><StatusBadge :value="event.status" /><text class="muted">{{
            shortDate(event.startsAt)
          }}</text></view
        >
        <view class="activity-title-row"><view class="activity-icon"><AppIcon name="event" :size="32" /></view><text class="title">{{ event.name }}</text></view>
        <text v-if="targetEventId === event.id" class="invite-context"
          >好友分享了这场赛事的战绩</text
        >
        <text class="muted"
          >{{ event.minimumPeople }}人成赛 · {{ event.capacityPeople }}人封顶 ·
          {{ event.totalRounds }}轮</text
        >
        <view class="activity-summary"><text class="money">{{ money(event.feeCents) }}</text><button class="secondary" :aria-expanded="Boolean(expanded[event.id])" @tap="expanded[event.id] = !expanded[event.id]">{{ expanded[event.id] ? '收起详情' : eventRegistration(event.id)?.registration ? '查看我的报名' : '查看详情' }}</button></view>
        <template v-if="expanded[event.id]">
      <view class="rules card">
        <view class="rules-heading"><AppIcon name="event" :size="34" tone="accent" /><text class="rules-title">固定双打 · 五轮瑞士制</text></view>
        <text class="muted"
          >单局21分，20平不加分；男双对女双让5分，男双对混双让2分，混双对女双让2分。</text
        >
      </view>

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
          <text class="event-signup-title">固定双打 · 一次报名两人</text>
          <text class="event-signup-copy"
            >可直接填写两位选手的姓名和联系电话，搭档无需注册；也可分享微信卡片，邀请搭档确认。</text
          >
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
                eventRegistration(event.id)?.registration?.status ===
                'REGISTERED'
              "
              class="secondary join"
              @tap="openEventOrder(event)"
            >
              <AppIcon name="finance" :size="27" />去支付
            </button>
            <button
              v-if="canCancelEventRegistration(event)"
              class="secondary join danger"
              :loading="actionKey === `event-cancel-registration:${event.id}`"
              :disabled="Boolean(actionKey)"
              @tap="cancellingEventId = event.id; cancelError = ''"
            >
              <AppIcon name="refund" :size="27" tone="danger" />退出报名
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
              <AppIcon name="share" :size="27" />分享战绩
            </button>
            <text v-else class="muted">{{
              isMember ? "当前不可报名" : "会员账号可报名"
            }}</text>
          </view>
        </view>
        <ReasonForm v-if="cancellingEventId === event.id && canCancelEventRegistration(event)" :key="event.id" title="确认退出本次赛事" :description="eventCancelDescription(event)" :busy="Boolean(actionKey)" :error="cancelError" confirm-text="确认退出报名" @cancel="cancellingEventId = ''" @submit="cancelEventRegistration(event, $event)" />
        </template>
      </view>
      <SectionEmpty v-if="!visibleEvents.length && !errorMessage" icon="event" :title="view === 'mine' ? '还没有赛事报名' : '暂无开放赛事'" />
    </template>
    <button v-if="view === 'browse'" class="quiet-entry" @tap="showPast = !showPast">{{ showPast ? '收起往期活动' : '查看往期活动' }}</button>
    <button v-else class="quiet-entry" @tap="openMemberPage('/pages/order/index')">查看全部订单（含已取消）</button>
    <button v-if="tab === 'games'" class="quiet-entry" @tap="showHostApplication = !showHostApplication">{{ showHostApplication ? '收起组织球局入口' : '我想组织球局' }}</button>
    <view v-if="tab === 'games' && showHostApplication" class="card host-entry">
      <view class="host-copy">
        <view class="host-heading"><view class="host-icon"><AppIcon name="add" :size="30" /></view><text class="host-title">发起自己的球局</text></view>
        <text class="muted"
          >申请通过后，可以组织球局并管理报名与签到。</text
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
        <AppIcon name="work" :size="28" tone="inverse" />进入主理人工作台
      </button>
      <button
        v-else-if="isMember && hostApplication?.status !== 'APPLIED'"
        class="secondary host-button"
        :loading="actionKey === 'host-apply'"
        :disabled="loading || Boolean(actionKey)"
        @tap="applyHost"
      >
        <AppIcon name="add" :size="28" />申请成为主理人
      </button>
      <button v-else-if="isMember" class="secondary host-button" disabled>
        申请审核中
      </button>
    </view>


  </view>
</template>

<style scoped>
.journey-tabs { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:12rpx; margin-bottom:22rpx; }
.journey-tabs button { width:100%; margin:0; padding:16rpx; color:var(--color-muted); background:transparent; font-size:30rpx; }
.journey-tabs .active { color:var(--color-primary); background:var(--color-surface); font-weight:800; }
.activity-summary { display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:16rpx; margin-top:22rpx; }
.activity-summary button { margin:0; font-size:26rpx; }
.quiet-entry { width:100%; margin:12rpx 0; color:var(--color-muted); background:transparent; font-size:25rpx; }
.tabs {
  display: grid;
  grid-template-columns: 1fr 1fr;
  padding: 8rpx;
  margin-bottom: 26rpx;
  background: #e7ece8;
  border-radius: 22rpx;
  text-align: center;
}
.tab-option {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10rpx;
  min-height: 44px;
  padding: 20rpx;
  color: #788079;
  border-radius: 17rpx;
  box-sizing: border-box;
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
.error-card > .error-icon {
  display: grid;
  flex: 0 0 auto;
  place-items: center;
  width: 54rpx;
  height: 54rpx;
  background: #fff0ef;
  border-radius: 16rpx;
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
.host-copy { min-width: 0; }
.host-heading { display:flex; align-items:center; gap:12rpx; margin-bottom:10rpx; }
.host-icon { display:grid; flex:0 0 auto; place-items:center; width:52rpx; height:52rpx; background:#e7f4eb; border-radius:16rpx; }
.host-title {
  display: block;
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
.loading-stack { display:grid; gap:14rpx; }
.activity-skeleton { min-height:310rpx; }
.activity-title-row { display:flex; align-items:center; min-width:0; gap:12rpx; margin:26rpx 0 12rpx; }
.activity-icon { display:grid; flex:0 0 auto; place-items:center; width:54rpx; height:54rpx; background:#e7f4eb; border-radius:16rpx; }
.activity .title {
  display: block;
  min-width: 0;
  margin: 0;
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
  min-height: 88rpx;
  padding: 18rpx 20rpx;
  margin: 0;
  line-height: 1.35;
  font-size: 24rpx;
  white-space: normal;
}
.game-list-status { display: block; margin-top: 16rpx; color: var(--color-primary); font-size: 25rpx; }
.invited-event {
  border-color: rgba(23, 101, 61, 0.45);
  box-shadow: 0 12rpx 36rpx rgba(23, 101, 61, 0.14);
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
.rules-heading { display:flex; align-items:center; gap:12rpx; margin-bottom:12rpx; }
.rules-title {
  display: block;
  min-width: 0;
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
.event-signup-title, .event-signup-copy { display: block; }
.event-signup-title { font-size: 23rpx; font-weight: 800; }
.event-signup-copy {
  margin-top: 8rpx;
  font-size: 21rpx;
  line-height: 1.65;
  overflow-wrap: anywhere;
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

@media (max-width: 420px) {
  .error-card { align-items: stretch; flex-wrap: wrap; }
  .retry { width: 100%; }
  .footer { align-items: stretch; }
  .footer > .money { width: 100%; }
  .event-actions { flex-basis: 100%; justify-content: stretch; }
  .event-actions .join { flex: 1 1 220rpx; min-width: 0; }
}
</style>
