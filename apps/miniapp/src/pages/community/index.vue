<script setup lang="ts">
import { computed, ref } from "vue";
import { onShow } from "@dcloudio/uni-app";

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
const loading = ref(false);
const actionKey = ref("");
const errorMessage = ref("");
const hostApplication = ref<any | null>(null);

const isMember = computed(() => session.roles.includes("MEMBER"));
const isHost = computed(() => session.roles.includes("HOST"));

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
    events.value = (eventList as any[]).filter((event) =>
      ["OPEN", "FULL", "IN_PROGRESS", "COMPLETED"].includes(event.status),
    );
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
    content: "提交后由管理员审核服务记录。审核通过前不能创建或发布球局，是否继续？",
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
  if (event.status !== "OPEN") {
    errorMessage.value = "该赛事当前不在报名期。";
    return;
  }
  const input = await uni.showModal({
    title: "报名固定双打",
    editable: true,
    placeholderText: "队名/队员A/队员B",
  });
  if (!input.confirm) return;
  const [teamName, playerAName, playerBName, ...extra] = String(
    input.content || "",
  )
    .split("/")
    .map((value) => value.trim());
  if (!teamName || !playerAName || !playerBName || extra.length) {
    errorMessage.value = "请严格按“队名/队员A/队员B”填写。";
    return;
  }
  if (playerAName === playerBName) {
    errorMessage.value = "两名参赛队员不能相同。";
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
    title: "确认赛事报名",
    content: `${event.name}\n${teamName} · ${playerAName} / ${playerBName}\n提交后生成待支付订单。`,
    confirmText: "确认提交",
  });
  if (!confirmed.confirm) return;
  actionKey.value = `event:${event.id}`;
  errorMessage.value = "";
  try {
    const command = {
      eventId: event.id,
      name: teamName,
      playerAName,
      playerBName,
      category,
      sourceChannel: "MINI_PROGRAM",
    };
    const order: any = await withPendingCreationKey(
      "event.register",
      command,
      (creationIdempotencyKey) =>
        endpoints.registerEvent(event.id, {
          name: teamName,
          playerAName,
          playerBName,
          category,
          creationIdempotencyKey,
        }),
    );
    uni.showModal({
      title: "赛事报名已提交",
      content: `订单 ${order.orderNo} 待支付。`,
      showCancel: false,
    });
    await load();
  } catch (cause: any) {
    errorMessage.value = cause?.message || "赛事报名失败。";
  } finally {
    actionKey.value = "";
  }
}

onShow(load);
</script>

<template>
  <view class="page safe-bottom">
    <view class="tabs">
      <view :class="{ active: tab === 'games' }" @tap="tab = 'games'">日常球局</view>
      <view :class="{ active: tab === 'events' }" @tap="tab = 'events'">金羽积分赛</view>
    </view>

    <view v-if="errorMessage" class="card error-card">
      <view><text class="error-title">操作未完成</text><text class="error-copy">{{ errorMessage }}</text></view>
      <button class="secondary retry" :disabled="loading || Boolean(actionKey)" @tap="load">重试</button>
    </view>

    <view v-if="tab === 'games'" class="card host-entry">
      <view>
        <text class="host-title">发起自己的球局</text>
        <text class="muted">会员先申请主理人；审核通过后可创建草稿、发布、管理候补和签到。</text>
        <text v-if="hostApplication" class="application-state">申请状态：{{ hostApplication.status === "APPLIED" ? "待审核" : hostApplication.status }}</text>
      </view>
      <button v-if="isHost" class="primary host-button" @tap="openHostWorkbench">进入主理人工作台</button>
      <button v-else-if="isMember && hostApplication?.status !== 'APPLIED'" class="secondary host-button" :loading="actionKey === 'host-apply'" :disabled="loading || Boolean(actionKey)" @tap="applyHost">申请成为主理人</button>
      <button v-else-if="isMember" class="secondary host-button" disabled>申请审核中</button>
    </view>

    <view v-if="loading" class="card state-card">活动列表同步中…</view>

    <template v-else-if="tab === 'games'">
      <view v-for="game in games" :key="game.id" class="card activity">
        <view class="row"><StatusBadge :value="game.status" /><text class="muted">{{ shortDate(game.startsAt) }}</text></view>
        <text class="title">{{ game.title }}</text>
        <text class="muted">主理人 {{ game.host?.displayName || "待显示" }} · {{ game.level }} · {{ game._count?.registrations || 0 }}/{{ game.capacity }} 人</text>
        <view class="row footer">
          <text class="money">{{ money(game.feeCents) }}</text>
          <button v-if="isMember && ['OPEN', 'FULL'].includes(game.status)" class="secondary join" :loading="actionKey === `game:${game.id}`" :disabled="Boolean(actionKey)" @tap="joinGame(game)">{{ game.status === "FULL" ? "加入候补" : "立即报名" }}</button>
          <text v-else class="muted">{{ isMember ? "当前不可报名" : "会员账号可报名" }}</text>
        </view>
      </view>
      <SectionEmpty v-if="!games.length" title="暂无开放球局" />
    </template>

    <template v-else-if="!loading">
      <view class="rules card">
        <text class="rules-title">固定双打 · 五轮瑞士制</text>
        <text class="muted">单局21分，20平不加分；男双对女双让5分，男双对混双让2分，混双对女双让2分。</text>
      </view>
      <view v-for="event in events" :key="event.id" class="card activity">
        <view class="row"><StatusBadge :value="event.status" /><text class="muted">{{ shortDate(event.startsAt) }}</text></view>
        <text class="title">{{ event.name }}</text>
        <text class="muted">{{ event.minimumPeople }}人成赛 · {{ event.capacityPeople }}人封顶 · {{ event.totalRounds }}轮</text>
        <view class="row footer">
          <text class="money">{{ money(event.feeCents) }}</text>
          <button v-if="isMember && event.status === 'OPEN'" class="secondary join" :loading="actionKey === `event:${event.id}`" :disabled="Boolean(actionKey)" @tap="joinEvent(event)">固定搭档报名</button>
          <text v-else class="muted">{{ isMember ? "当前不可报名" : "会员账号可报名" }}</text>
        </view>
      </view>
      <SectionEmpty v-if="!events.length" title="赛事筹备中" />
    </template>
  </view>
</template>

<style scoped>
.tabs { display:grid; grid-template-columns:1fr 1fr; padding:8rpx; margin-bottom:26rpx; background:#e7ece8; border-radius:22rpx; text-align:center; }.tabs view { padding:20rpx; color:#788079; border-radius:17rpx; }.tabs .active { color:#174b30; background:#fff; box-shadow:0 6rpx 18rpx rgba(29,67,44,.08); font-weight:700; }
.error-card { display:flex; align-items:center; justify-content:space-between; gap:16rpx; color:#8a3636; background:#fff4f2; }.error-title,.error-copy { display:block; }.error-title { font-weight:800; }.error-copy { margin-top:8rpx; font-size:23rpx; line-height:1.5; }.retry { flex:0 0 auto; min-height:58rpx; margin:0; line-height:58rpx; font-size:22rpx; }
.host-entry { display:grid; gap:20rpx; background:#f8fbf8; }.host-title { display:block; margin-bottom:10rpx; font-size:29rpx; font-weight:800; }.host-entry .muted { display:block; line-height:1.6; }.application-state { display:block; margin-top:12rpx; color:#9b6300; font-size:23rpx; }.host-button { width:100%; margin:0; }
.state-card { color:#758079; text-align:center; }.activity .title { display:block; margin:26rpx 0 12rpx; font-size:34rpx; font-weight:800; }.footer { margin-top:26rpx; }.join { min-width:190rpx; padding:0 20rpx; margin:0; }.rules { background:linear-gradient(135deg,#153f2a,#23714a); }.rules-title { display:block; margin-bottom:12rpx; color:#fff; font-size:31rpx; font-weight:700; }.rules .muted { color:rgba(255,255,255,.76); line-height:1.7; }
</style>
