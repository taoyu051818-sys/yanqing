<script setup lang="ts">
import { toRefs, computed } from "vue";
import AppIcon from "../../../components/AppIcon.vue";
import SectionEmpty from "../../../components/SectionEmpty.vue";
import ReasonForm from "../../../components/ReasonForm.vue";
import StatusBadge from "../../../components/StatusBadge.vue";
import { money, shortDate } from "../../../utils/format";
import { eventDetailPath } from "../../../utils/event-detail";
import { openMemberPage } from "../../../utils/member-navigation";

const props = defineProps<{
  loading: boolean;
  visibleEvents: any[];
  targetEventId: string;
  view: "browse" | "mine";
  expanded: Record<string, boolean>;
  isMember: boolean;
  hasActiveEventRegistration: (eventId: string) => boolean;
  eventRegistration: (eventId: string) => any;
  latestRegistrationRefund: (eventId: string) => any;
  displayRefundStatus: (status?: string) => string;
  displayRegistrationStatus: (status?: string) => string;
  rankedTeams: (event: any) => any[];
  myEventTeam: (event: any) => any;
  openEventOrder: (event: any) => void;
  canCancelEventRegistration: (event: any) => boolean;
  actionKey: string;
  cancellingEventId: string;
  cancelError: string;
  joinEvent: (event: any) => void;
  rememberShare: (type: "event", id: string) => void;
  eventCancelDescription: (
    event: any,
  ) =>
    | "确认后退出报名，无需退款，释放席位并按顺序晋级候补。"
    | "确认后进入退款审批；审批成功前仍占用席位且不能签到，驳回后恢复报名。"
    | "确认后退出候补队列，不会产生订单或费用。"
    | "确认后取消待付款订单，释放席位并按顺序晋级候补。";
  cancelEventRegistration: (event: any, reason: string) => Promise<void>;
  errorMessage: string;
}>();
const emit = defineEmits<{
  (event: "update:cancellingEventId", value: string): void;
  (event: "update:cancelError", value: string): void;
}>();
const {
  loading,
  visibleEvents,
  targetEventId,
  view,
  expanded,
  isMember,
  hasActiveEventRegistration,
  eventRegistration,
  latestRegistrationRefund,
  displayRefundStatus,
  displayRegistrationStatus,
  rankedTeams,
  myEventTeam,
  openEventOrder,
  canCancelEventRegistration,
  actionKey,
  joinEvent,
  rememberShare,
  eventCancelDescription,
  cancelEventRegistration,
  errorMessage,
} = toRefs(props);
const cancellingEventId = computed({
  get: () => props.cancellingEventId,
  set: (value) => emit("update:cancellingEventId", value),
});
const cancelError = computed({
  get: () => props.cancelError,
  set: (value) => emit("update:cancelError", value),
});
</script>

<template>
  <view>
    <template v-if="!loading">
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
        <view class="activity-title-row"
          ><view class="activity-icon"><AppIcon name="event" :size="32" /></view
          ><text class="title">{{ event.name }}</text></view
        >
        <text v-if="targetEventId === event.id" class="invite-context"
          >好友分享了这场赛事</text
        >
        <text class="muted"
          >{{ event.minimumPeople }}人成赛 · {{ event.capacityPeople }}人封顶 ·
          {{ event.totalRounds }}轮</text
        >
        <view class="activity-summary"
          ><text class="money">{{ money(event.feeCents) }}</text
          ><button
            class="secondary"
            :aria-expanded="
              view === 'mine' ? Boolean(expanded[event.id]) : undefined
            "
            @tap="
              view === 'mine'
                ? (expanded[event.id] = !expanded[event.id])
                : openMemberPage(eventDetailPath(event.id))
            "
          >
            {{
              view === "browse"
                ? "查看赛事详情"
                : expanded[event.id]
                  ? "收起详情"
                  : "查看我的报名"
            }}
          </button></view
        >
        <template v-if="expanded[event.id]">
          <view class="rules card">
            <view class="rules-heading"
              ><AppIcon name="event" :size="34" tone="accent" /><text
                class="rules-title"
                >固定双打 · 五轮瑞士制</text
              ></view
            >
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
              v-if="
                eventRegistration(event.id).registration.cancellationPending
              "
            >
              <text class="registration-title">退出退款待财务审批</text>
              <text class="muted"
                >报名席位暂时保留且不可签到；财务成功退款后释放，驳回后恢复报名。</text
              >
              <text
                v-if="latestRegistrationRefund(event.id)"
                class="refund-state"
                >退款状态：{{
                  displayRefundStatus(latestRegistrationRefund(event.id).status)
                }}
                ·
                {{
                  money(latestRegistrationRefund(event.id).amountCents)
                }}</text
              >
            </template>
            <template
              v-else-if="
                eventRegistration(event.id).registration.status === 'WAITLISTED'
              "
            >
              <text class="registration-title"
                >我的候补：第
                {{ eventRegistration(event.id).waitlistPosition || "—" }}
                位</text
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
              <text class="muted"
                >报名费用已退，席位已释放并触发候补晋级。</text
              >
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
                  displayRegistrationStatus(
                    eventRegistration(event.id).registration.status,
                  )
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
                @tap="
                  cancellingEventId = event.id;
                  cancelError = '';
                "
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
          <ReasonForm
            v-if="
              cancellingEventId === event.id &&
              canCancelEventRegistration(event)
            "
            :key="event.id"
            title="确认退出本次赛事"
            :description="eventCancelDescription(event)"
            :busy="Boolean(actionKey)"
            :error="cancelError"
            confirm-text="确认退出报名"
            @cancel="cancellingEventId = ''"
            @submit="cancelEventRegistration(event, $event)"
          />
        </template>
      </view>
      <SectionEmpty
        v-if="!visibleEvents.length && !errorMessage"
        icon="event"
        :title="view === 'mine' ? '还没有赛事报名' : '暂无开放赛事'"
      />
    </template>
  </view>
</template>

<style scoped src="../page.css"></style>
