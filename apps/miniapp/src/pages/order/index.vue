<script setup lang="ts">
import { watch } from "vue";
import type { OrderView } from "@yanqing/shared";
import {
  onHide,
  onLoad,
  onPullDownRefresh,
  onShow,
  onUnload,
} from "@dcloudio/uni-app";
import AppIcon from "../../components/AppIcon.vue";
import SectionEmpty from "../../components/SectionEmpty.vue";
import ReasonForm from "../../components/ReasonForm.vue";
import StatusBadge from "../../components/StatusBadge.vue";
import { money } from "../../utils/format";
import { useSessionStore } from "../../stores/session";
import {
  openMemberPage,
  openMemberRecord,
} from "../../utils/member-navigation";
import { gameDetailPath } from "../../utils/game-detail";
import { canCancelFreeVenue } from "../../utils/payment-confirmation";
import {
  businessTypeIcon,
  displayBusinessType,
  orderTimeLabel,
  refundableAmount,
  canRequestOrderRefund,
  refundStatusLabels,
} from "./order-presentation";
import { useOrderList, orderFilters as filters } from "./use-order-list";
import { useOrderActionScope } from "./order-action-scope";
import { useOrderPayment } from "./use-order-payment";
import { useOrderAftersales } from "./use-order-aftersales";
import { useOrderClock } from "./use-order-clock";

const session = useSessionStore();
const list = useOrderList(session);
const {
  orders,
  focusedId,
  statusFilter,
  total,
  loading,
  error,
  load,
  filterOrders,
} = list;
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
);
const { refundingId, refundError, cancelPending, refund } = aftersales;
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

onLoad(list.configure);
onShow(() => {
  clock.start();
  confirmation.resume();
  void load();
});
onHide(() => {
  clock.stop();
  confirmation.pause();
});
onUnload(() => {
  clock.stop();
  actions.dispose();
  list.dispose();
  payment.reset();
  aftersales.reset();
});
onPullDownRefresh(() => load());
</script>

<template>
  <view class="page safe-bottom">
    <button
      v-if="focusedId"
      class="secondary all-orders"
      @tap="filterOrders('')"
    >
      查看全部订单
    </button>
    <view v-else class="order-filters"
      ><button
        v-for="filter in filters"
        :key="filter.label"
        :class="{ selected: statusFilter === filter.status }"
        :aria-pressed="statusFilter === filter.status"
        @tap="filterOrders(filter.status)"
      >
        {{ filter.label }}
      </button></view
    >
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
          order.businessType === 'MEMBERSHIP' && order.status === 'COMPLETED'
        "
        class="secondary related-order"
        @tap="openMemberPage('/pages/profile/index')"
      >
        查看我的会员权益
      </button>
      <text v-if="order.status === 'REFUND_PENDING'" class="use-note"
        >退款申请处理中，请在本订单查看处理结果。</text
      >
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
          order.status === 'PENDING' &&
          paymentConfirmation?.orderId !== order.id
        "
        class="pending-panel"
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
      <view
        v-if="
          payingId === order.id &&
          order.status === 'PENDING' &&
          paymentConfirmation?.orderId !== order.id
        "
        class="payment-selection"
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
      </view>
      <button
        v-if="canCancelFreeVenue(order, nowMs)"
        class="secondary related-order"
        :loading="actionKey === 'cancel:' + order.id"
        :disabled="Boolean(actionKey)"
        @tap="cancelPending(order)"
      >
        取消免费预约
      </button>
      <button
        v-if="['GAME', 'EVENT', 'TRAINING'].includes(order.businessType)"
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
      <view v-if="canRequestOrderRefund(order)" class="actions"
        ><button
          class="secondary small"
          :disabled="Boolean(actionKey)"
          @tap="
            refundingId = order.id;
            refundError = '';
          "
        >
          <AppIcon name="refund" :size="28" />申请退款
        </button></view
      >
      <ReasonForm
        v-if="refundingId === order.id && canRequestOrderRefund(order)"
        :key="order.id"
        title="申请退款"
        :description="
          '申请金额 ' +
          money(refundableAmount(order)) +
          '。提交后由工作人员按订单状态和退款规则审核，进度在本订单查看。'
        "
        :busy="Boolean(actionKey)"
        :error="refundError"
        confirm-text="确认申请退款"
        @cancel="refundingId = ''"
        @submit="refund(order, $event)"
      />
    </view>
    <button
      v-if="!focusedId && !error && orders.length > 0 && orders.length < total"
      class="secondary all-orders"
      :loading="loading"
      :disabled="loading"
      @tap="load(true)"
    >
      加载更多订单
    </button>
    <SectionEmpty
      v-if="!orders.length && !loading && !error"
      icon="receipt"
      :title="statusFilter ? '暂无这类订单' : '还没有订单'"
      description="已预约或报名的记录会保存在这里。"
    />
    <button
      v-if="!orders.length && !loading && !error"
      class="secondary all-orders"
      @tap="openMemberPage('/pages/booking/index')"
    >
      去看看可订场地
    </button>
  </view>
</template>
<style scoped src="./page.css"></style>
