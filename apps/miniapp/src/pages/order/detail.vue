<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { OrderView } from "@yanqing/shared";
import {
  onHide,
  onLoad,
  onPullDownRefresh,
  onShow,
  onUnload,
} from "@dcloudio/uni-app";
import ActionDialog from "../../components/ActionDialog.vue";
import AppIcon from "../../components/AppIcon.vue";
import GuestState from "../../components/GuestState.vue";
import SectionEmpty from "../../components/SectionEmpty.vue";
import OrderRefundDialog from "./OrderRefundDialog.vue";
import StatusBadge from "../../components/StatusBadge.vue";
import { canDirectRefund } from "../../utils/refund-action";
import { money } from "../../utils/format";
import { useSessionStore } from "../../stores/session";
import {
  requestMemberLogin,
  openMemberPage,
  openMemberRecord,
} from "../../utils/member-navigation";
import { gameDetailPath } from "../../utils/game-detail";
import { canCancelFreeVenue } from "../../utils/payment-confirmation";
import {
  businessTypeIcon,
  displayBusinessType,
  orderTimeLabel,
  canRequestOrderRefund,
  refundStatusLabels,
} from "./order-presentation";
import { useOrderList } from "./use-order-list";
import { useOrderActionScope } from "./order-action-scope";
import { useOrderPayment } from "./use-order-payment";
import { useOrderAftersales } from "./use-order-aftersales";
import { useOrderClock } from "./use-order-clock";

const navigateTo = (options: { url: string }) => uni.navigateTo(options);
const session = useSessionStore();
const requestedManagement = ref(false);
const management = computed(
  () =>
    requestedManagement.value &&
    session.roles.some((role) =>
      ["ADMIN", "SUPER_ADMIN", "FINANCE", "FRONT_DESK"].includes(role),
    ),
);
const canRefund = (order: OrderView) =>
  (!management.value ||
    session.roles.some((role) =>
      ["FRONT_DESK", "ADMIN", "SUPER_ADMIN"].includes(role),
    )) &&
  canRequestOrderRefund(
    order,
    management.value && canDirectRefund(session.roles),
  );
const directRefund = computed(() => canDirectRefund(session.roles));
const list = useOrderList(session);
const { orders, focusedId, loading, error, load: loadOrder } = list;
function load() {
  if (!focusedId.value) {
    error.value = "请从订单列表选择要查看的订单";
    uni.stopPullDownRefresh();
    return Promise.resolve();
  }
  return loadOrder();
}
const actions = useOrderActionScope();
const { actionKey } = actions;
const clock = useOrderClock(orders, load);
const { nowMs, deadlineExpired, paymentCountdown } = clock;
const payment = useOrderPayment(actions, list, session, deadlineExpired);
const {
  payingId,
  paymentChannel,
  paymentError,
  paymentQuote,
  balanceLoading,
  freeConfirmation,
  paymentChoices,
  confirmation,
  paymentConfirmation,
  preparePay,
  pay,
} = payment;
const aftersales = useOrderAftersales(
  actions,
  load,
  (id) => paymentConfirmation.value?.orderId === id,
  () => directRefund.value,
);
const { refundingId, refundError, refundFeedback, cancelPending, refund } =
  aftersales;
watch(
  [() => session.isAuthenticated, () => session.user?.id],
  () => {
    actions.reset();
    list.reset();
    payment.reset();
    aftersales.reset();
  },
  { flush: "sync" },
);
function openRelated(order: OrderView) {
  if (order.businessType === "GAME")
    return openMemberRecord(
      order.gameRegistration?.game?.id
        ? gameDetailPath(order.gameRegistration.game.id)
        : "/pages/community/index?tab=games&view=mine",
    );
  if (order.businessType === "EVENT")
    return openMemberPage(
      `/pages/community/index?tab=events&eventId=${encodeURIComponent(order.eventTeam?.event?.id || "")}&view=mine`,
    );
  if (order.businessType === "TRAINING")
    return openMemberPage("/pages/training/index?tab=mine");
}

let showGeneration = 0;
onLoad((query) => {
  list.configure(query);
  requestedManagement.value = query?.management === "1";
});
onShow(async () => {
  const generation = ++showGeneration;
  await session.hydrate();
  if (generation !== showGeneration) return;
  clock.start();
  confirmation.resume();
  void load();
});
onHide(() => {
  showGeneration++;
  clock.stop();
  confirmation.pause();
});
onUnload(() => {
  showGeneration++;
  clock.stop();
  actions.dispose();
  list.dispose();
  payment.reset();
  aftersales.reset();
});
onPullDownRefresh(() => load());
</script>

<template>
  <view class="page safe-bottom order-detail-page">
    <GuestState
      v-if="!session.isAuthenticated"
      title="我的订单"
      description="订场、活动和课程订单会在这里汇总，登录后可查看付款和使用进度。"
      @login="
        requestMemberLogin(
          focusedId
            ? `/pages/order/detail?id=${encodeURIComponent(focusedId)}${requestedManagement ? '&management=1' : ''}`
            : '/pages/order/index',
        )
      "
    />
    <button
      v-if="!management && focusedId"
      class="secondary all-orders"
      @tap="openMemberPage('/pages/order/index')"
    >
      查看全部订单
    </button>
    <view v-if="error" class="card load-error" role="alert" aria-live="polite"
      ><AppIcon name="warning" :size="32" tone="danger" /><text>{{
        error
      }}</text
      ><button class="secondary retry" :disabled="loading" @tap="load()">
        <AppIcon name="refresh" :size="26" />重试
      </button></view
    >
    <view v-if="loading && !orders.length" class="loading-stack"
      ><view class="card order-skeleton skeleton" /><view
        class="card order-skeleton skeleton"
    /></view>
    <view v-for="order in orders" :key="order.id" class="card order">
      <view class="row order-head"
        ><view class="order-identity"
          ><view class="order-icon"
            ><AppIcon
              :name="businessTypeIcon[order.businessType] || 'receipt'"
              :size="30" /></view
          ><text class="order-no">订单号 {{ order.orderNo }}</text></view
        ><StatusBadge
          :value="order.status"
          :label="order.status === 'PENDING' ? '待付款' : undefined"
      /></view>
      <text class="title">{{ order.title }}</text>
      <text v-if="management && order.member" class="use-note"
        >会员：{{ order.member.displayName }}</text
      >
      <view class="row order-meta"
        ><view class="order-meta-copy"
          ><text class="muted">{{ orderTimeLabel(order) }}</text
          ><text class="muted">{{
            displayBusinessType(order.businessType)
          }}</text></view
        ><text class="money">{{ money(order.payableCents) }}</text></view
      >
      <text
        v-if="order.bookings?.some((booking) => booking.operatorOverride)"
        class="use-note"
        >特殊代订 · 场次已由工作人员协调，请核对日期和时间后付款。</text
      >
      <text
        v-if="order.businessType === 'VENUE' && order.status === 'PAID'"
        class="use-note"
        >{{ order.bookings?.[0]?.court?.name }} ·
        到店向前台出示本订单，完成核销后入场。</text
      >
      <text v-if="order.status === 'CANCELLED'" class="use-note"
        >订单已取消，无需付款。{{
          order.businessType === "VENUE" ? "场地保留已解除。" : ""
        }}</text
      >
      <text
        v-if="order.businessType === 'GOODS' && order.status === 'PAID'"
        class="use-note"
        >请到场馆出示本订单领取商品，取货进度以工作人员确认为准。</text
      >
      <button
        v-if="
          !management &&
          order.businessType === 'RECHARGE' &&
          ['COMPLETED', 'REFUNDED', 'PARTIALLY_REFUNDED'].includes(order.status)
        "
        class="secondary related-order"
        @tap="openMemberPage('/pages/wallet/index')"
      >
        查看到账余额与明细
      </button>
      <button
        v-if="
          !management &&
          order.businessType === 'MEMBERSHIP' &&
          order.status === 'COMPLETED'
        "
        class="secondary related-order"
        @tap="openMemberPage('/pages/profile/index')"
      >
        查看我的会员权益
      </button>
      <text v-if="order.status === 'REFUND_PENDING'" class="use-note"
        >退款申请处理中，请在本订单查看处理结果。</text
      >
      <view v-if="management" class="management-links"
        ><button
          v-if="order.status === 'PENDING' && order.businessType === 'VENUE'"
          class="secondary"
          @tap="
            navigateTo({
              url:
                '/packages/ops/pages/frontdesk/index?focus=order&orderId=' +
                order.id,
            })
          "
        >
          办理现场收款</button
        ><button
          v-if="
            order.refunds?.some((r) =>
              ['REQUESTED', 'APPROVED', 'PROCESSING', 'FAILED'].includes(
                r.status,
              ),
            ) &&
            session.roles.some((r) =>
              ['FINANCE', 'ADMIN', 'SUPER_ADMIN'].includes(r),
            )
          "
          class="secondary"
          @tap="
            navigateTo({
              url:
                '/packages/ops/pages/finance/index?focus=refund&orderId=' +
                order.id +
                '&id=' +
                order.refunds.find((r) =>
                  ['REQUESTED', 'APPROVED', 'PROCESSING', 'FAILED'].includes(
                    r.status,
                  ),
                )?.id,
            })
          "
        >
          查看并处理退款
        </button></view
      >
      <view
        v-if="refundFeedback?.orderId === order.id && !order.refunds?.length"
        class="refund-result"
        role="status"
        aria-live="polite"
        ><text>{{ refundFeedback.message }}</text></view
      >
      <button
        v-if="
          order.refunds?.some((item) =>
            ['REQUESTED', 'APPROVED', 'PROCESSING'].includes(item.status),
          ) || refundFeedback?.orderId === order.id
        "
        class="secondary"
        :disabled="loading || Boolean(actionKey)"
        :loading="loading"
        @tap="load"
      >
        刷新退款进度
      </button>
      <view v-if="order.refunds?.length" class="refund-history"
        ><text v-for="item in order.refunds" :key="item.id"
          >退款 {{ money(item.amountCents) }} ·
          {{ refundStatusLabels[item.status] || "处理中" }}</text
        ></view
      >
      <view
        v-if="
          paymentConfirmation?.orderId === order.id &&
          order.status === 'PENDING'
        "
        class="payment-selection"
        role="status"
        aria-live="polite"
      >
        <text class="title">支付结果确认中</text>
        <text class="use-note">{{ paymentConfirmation?.message }}</text>
        <button
          class="secondary"
          :loading="paymentConfirmation?.checking"
          :disabled="paymentConfirmation?.checking"
          @tap="confirmation.start(order.id)"
        >
          {{ paymentConfirmation?.checking ? "正在查询…" : "重新查询支付结果" }}
        </button>
      </view>
      <view
        v-if="
          !management &&
          order.status === 'PENDING' &&
          paymentConfirmation?.orderId !== order.id
        "
        class="pending-panel detail-primary-action"
      >
        <view class="payment-window"
          ><AppIcon
            name="clock"
            :size="28"
            :tone="deadlineExpired(order) ? 'danger' : 'accent'"
          /><text>{{ paymentCountdown(order) }}</text></view
        >
        <view class="actions">
          <button
            v-if="
              [
                'VENUE',
                'GAME',
                'TRAINING',
                'MEMBERSHIP',
                'RECHARGE',
                'GOODS',
              ].includes(order.businessType)
            "
            class="danger small"
            :loading="actionKey === `cancel:${order.id}`"
            :disabled="Boolean(actionKey) || deadlineExpired(order)"
            @tap="cancelPending(order)"
          >
            <AppIcon name="close" :size="30" tone="danger" />取消订单
          </button>
          <button
            v-if="payingId !== order.id"
            class="primary small"
            :loading="actionKey === `pay:${order.id}`"
            :disabled="Boolean(actionKey) || deadlineExpired(order)"
            @tap="preparePay(order)"
          >
            <AppIcon name="finance" :size="30" tone="inverse" />{{
              order.payableCents === 0 ? "确认订单" : "立即支付"
            }}
          </button>
        </view>
      </view>
      <ActionDialog
        v-if="
          payingId === order.id &&
          !management &&
          order.status === 'PENDING' &&
          paymentConfirmation?.orderId !== order.id
        "
        title="确认付款"
        :busy="Boolean(actionKey)"
        @close="payingId = ''"
      >
        <text class="title">{{
          order.payableCents === 0 ? "确认免费订单" : "选择支付方式"
        }}</text>
        <text v-if="order.businessType === 'RECHARGE'" class="use-note"
          >充值订单仅支持微信支付，不可使用已有余额充值。</text
        >
        <text v-if="balanceLoading" class="use-note">正在核对订单…</text>
        <text v-if="freeConfirmation" class="use-note">{{
          paymentChoices[0]?.note
        }}</text>
        <button
          v-for="choice in freeConfirmation ? [] : paymentChoices"
          :key="choice.channel"
          class="payment-choice"
          :aria-pressed="paymentChannel === choice.channel"
          :disabled="Boolean(actionKey) || choice.disabled"
          @tap="paymentChannel = choice.channel"
        >
          <text
            >{{ paymentChannel === choice.channel ? "已选 · " : ""
            }}{{ choice.label }}</text
          ><text class="muted">{{ choice.note }}</text>
        </button>
        <button
          v-if="
            !balanceLoading && !actionKey && (!paymentQuote || paymentError)
          "
          class="secondary"
          @tap="preparePay(order)"
        >
          重新同步支付方式
        </button>
        <text v-if="paymentError" class="payment-error" role="alert">{{
          paymentError
        }}</text>
        <button
          class="primary"
          :loading="actionKey === 'pay:' + order.id"
          :disabled="
            Boolean(actionKey) ||
            deadlineExpired(order) ||
            !paymentChoices.some(
              (item) => item.channel === paymentChannel && !item.disabled,
            )
          "
          @tap="pay(order)"
        >
          {{
            order.payableCents === 0
              ? "免费确认"
              : "确认支付 " + money(order.payableCents)
          }}
        </button>
        <button
          class="secondary"
          :disabled="Boolean(actionKey)"
          @tap="payingId = ''"
        >
          {{ order.payableCents === 0 ? "稍后确认" : "暂不付款" }}
        </button>
      </ActionDialog>
      <button
        v-if="!management && canCancelFreeVenue(order, nowMs)"
        class="secondary related-order"
        :loading="actionKey === 'cancel:' + order.id"
        :disabled="Boolean(actionKey)"
        @tap="cancelPending(order)"
      >
        取消免费预约
      </button>
      <button
        v-if="
          !management &&
          ['GAME', 'EVENT', 'TRAINING'].includes(order.businessType)
        "
        class="secondary related-order"
        @tap="openRelated(order)"
      >
        {{
          order.businessType === "TRAINING"
            ? "查看课程与退费"
            : order.businessType === "EVENT"
              ? "查看报名与取消"
              : "查看球局安排"
        }}
      </button>
      <view v-if="canRefund(order)" class="actions detail-refund-action"
        ><button
          class="secondary small"
          :disabled="Boolean(actionKey)"
          @tap="
            refundingId = order.id;
            refundError = '';
          "
        >
          <AppIcon name="refund" :size="28" />{{
            directRefund ? "直接退款" : "申请退款"
          }}
        </button></view
      >
      <OrderRefundDialog
        v-if="refundingId === order.id && canRefund(order)"
        :key="order.id"
        :order="order"
        :direct="directRefund"
        :busy="Boolean(actionKey)"
        :error="refundError"
        @cancel="refundingId = ''"
        @submit="refund(order, $event)"
      />
    </view>
    <SectionEmpty
      v-if="session.isAuthenticated && !orders.length && !loading && !error"
      icon="receipt"
      title="未找到此订单"
      description="已预约或报名的记录会保存在这里。"
    />
    <button
      v-if="session.isAuthenticated && !orders.length && !loading && !error"
      class="secondary all-orders"
      @tap="openMemberPage('/pages/booking/index')"
    >
      去看看可订场地
    </button>
  </view>
</template>
<style scoped src="./page.css"></style>

<style scoped>
.refund-result {
  padding: 20rpx;
  margin: 20rpx 0;
  border-radius: 16rpx;
  background: #edf6ef;
  color: #17653d;
  font-size: 28rpx;
  line-height: 1.6;
}
</style>
