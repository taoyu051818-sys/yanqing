<script setup lang="ts">
import { ref, watch } from "vue";
import { onLoad, onShow, onUnload, onPullDownRefresh } from "@dcloudio/uni-app";
import type { OrderView } from "@yanqing/shared";
import AppIcon from "../../components/AppIcon.vue";
import StatusBadge from "../../components/StatusBadge.vue";
import GuestState from "../../components/GuestState.vue";
import SectionEmpty from "../../components/SectionEmpty.vue";
import { useSessionStore } from "../../stores/session";
import { endpoints } from "../../services/api";
import {
  captureAuthSession,
  isAuthSessionCurrent,
} from "../../services/auth-session";
import { requestMemberLogin } from "../../utils/member-navigation";
import { money } from "../../utils/format";
import { useOrderList, orderFilters as filters } from "./use-order-list";
import { orderTimeLabel, displayBusinessType } from "./order-presentation";
const session = useSessionStore(),
  list = useOrderList(session);
const { orders, statusFilter, total, loading, error, load, filterOrders } =
  list;
const selectedId = ref("");
let initialized = false,
  redirected = false;
onLoad((query) => {
  if (query?.id) {
    redirected = true;
    uni.redirectTo({
      url: "/pages/order/detail?id=" + encodeURIComponent(query.id),
    });
    return;
  }
  list.configure(query);
});
function openOrder(order: OrderView) {
  selectedId.value = order.id;
  uni.navigateTo({
    url: "/pages/order/detail?id=" + encodeURIComponent(order.id),
  });
}
watch(
  () => session.user?.id,
  () => {
    initialized = false;
    selectedId.value = "";
    list.reset();
  },
  { flush: "sync" },
);
onShow(async () => {
  if (redirected) return;
  await session.hydrate();
  if (!initialized) {
    initialized = true;
    await load();
    return;
  }
  if (selectedId.value) {
    const owner = captureAuthSession();
    try {
      const order = await endpoints.order(selectedId.value);
      if (isAuthSessionCurrent(owner)) {
        if (statusFilter.value && order.status !== statusFilter.value)
          await load();
        else list.replaceOrder(order);
      }
    } catch {
      if (isAuthSessionCurrent(owner))
        error.value = "订单状态暂未同步，请刷新重试";
    }
  }
});
onPullDownRefresh(() => load());
onUnload(list.dispose);
</script>
<template>
  <view class="page safe-bottom">
    <GuestState
      v-if="!session.isAuthenticated"
      title="我的订单"
      description="登录后查看订单与付款进度，也可以继续浏览场地和活动。"
      @login="requestMemberLogin('/pages/order/index')"
    />
    <view class="order-filters"
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
    <view v-if="error" class="card load-error" role="alert"
      ><text>{{ error }}</text
      ><button class="secondary retry" @tap="load()">重试</button></view
    >
    <view
      v-if="loading && !orders.length"
      class="card skeleton order-skeleton"
    />
    <view class="order-list"
      ><button
        v-for="order in orders"
        :key="order.id"
        class="order-list-row"
        @tap="openOrder(order)"
      >
        <view class="row"
          ><text class="muted">{{
            displayBusinessType(order.businessType)
          }}</text
          ><StatusBadge
            :value="order.status"
            :label="order.status === 'PENDING' ? '待付款' : undefined" /></view
        ><text class="list-title">{{ order.title }}</text
        ><text class="muted">{{ orderTimeLabel(order) }}</text
        ><view class="row"
          ><text class="money"
            >{{ order.status === "PENDING" ? "应付" : "实付" }}
            {{
              money(
                order.status === "PENDING"
                  ? order.payableCents
                  : order.paidCents,
              )
            }}</text
          ><text class="list-link"
            >{{ order.status === "PENDING" ? "去付款" : "查看详情" }}
            <AppIcon name="chevron" :size="24" /></text
        ></view></button
    ></view>
    <button
      v-if="orders.length && orders.length < total"
      class="secondary all-orders"
      :loading="loading"
      :disabled="loading"
      @tap="load(true)"
    >
      加载更多订单
    </button>
    <SectionEmpty
      v-if="session.isAuthenticated && !orders.length && !loading && !error"
      title="暂无这类订单"
      description="可切换分类，或到首页看看可订场地。"
    />
  </view>
</template>
<style scoped src="./page.css"></style>
<style scoped>
.order-list {
  background: #fff;
  border-radius: 24rpx;
  overflow: hidden;
  margin-bottom: 24rpx;
}
.order-list-row {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 14rpx;
  text-align: left;
  width: 100%;
  padding: 28rpx;
  margin: 0;
  background: #fff;
  border-radius: 0;
  border-bottom: 1rpx solid var(--color-border);
  font-weight: 400;
}
.order-list-row:last-child {
  border: 0;
}
.list-title {
  font-size: 32rpx;
  font-weight: 600;
  overflow-wrap: anywhere;
}
.list-link {
  display: flex;
  align-items: center;
  color: var(--color-primary);
  font-size: 26rpx;
}
.order-list-row .muted {
  font-size: 26rpx;
}
</style>
