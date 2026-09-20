<script setup lang="ts">
import { ref, watch } from "vue";
import { onShow } from "@dcloudio/uni-app";
import AppIcon from "./AppIcon.vue";
import { endpoints } from "../services/api";
import { useSessionStore } from "../stores/session";
import { openMemberPage } from "../utils/member-navigation";
import { orderTimeLabel } from "../pages/order/order-presentation";
import type { OrderView } from "@yanqing/shared";
import {
  captureAuthSession,
  isAuthSessionCurrent,
} from "../services/auth-session";

const session = useSessionStore();
const next = ref<OrderView | null>(null);
const failed = ref(false);
let generation = 0;
async function load() {
  const run = ++generation,
    owner = captureAuthSession();
  next.value = null;
  failed.value = false;
  if (!session.isAuthenticated) return;
  try {
    const result = await endpoints.nextOrder();
    if (
      run === generation &&
      isAuthSessionCurrent(owner) &&
      session.isAuthenticated
    )
      next.value = result;
  } catch {
    if (
      run === generation &&
      isAuthSessionCurrent(owner) &&
      session.isAuthenticated
    )
      failed.value = true;
  }
}
watch([() => session.isAuthenticated, () => session.user?.id], load);
onShow(load);
</script>

<template>
  <view
    v-if="session.isAuthenticated && (next || failed)"
    class="next-step card"
  >
    <template v-if="next">
      <view class="next-heading"
        ><AppIcon
          :name="next.status === 'PENDING' ? 'clock' : 'booking'"
          :size="32"
        /><text>{{
          next.status === "PENDING" ? "你有待付款订单" : "接下来的安排"
        }}</text></view
      >
      <text class="next-title">{{ next.title }}</text>
      <text class="muted">{{ orderTimeLabel(next) }}</text>
      <button
        class="secondary"
        @tap="
          openMemberPage(`/pages/order/index?id=${encodeURIComponent(next.id)}`)
        "
      >
        {{
          next.status === "PENDING"
            ? next.businessType === "VENUE"
              ? "去付款"
              : "查看订单与付款"
            : "查看订单与安排"
        }}<AppIcon name="chevron" :size="28" />
      </button>
    </template>
    <text v-if="failed" class="muted"
      >部分订单暂未同步，不能据此判断没有待办。</text
    >
    <button v-if="!next && failed" class="secondary" @tap="load">
      重新同步订单
    </button>
  </view>
</template>

<style scoped>
.next-step {
  border-left: 6rpx solid var(--color-primary);
}
.next-heading {
  display: flex;
  align-items: center;
  gap: 12rpx;
  color: var(--color-primary);
  font-size: 26rpx;
  font-weight: 700;
}
.next-title {
  display: block;
  margin: 16rpx 0 8rpx;
  font-size: 30rpx;
  font-weight: 750;
  overflow-wrap: anywhere;
}
.next-step .muted {
  display: block;
}
.next-step button {
  width: 100%;
  margin: 20rpx 0 0;
}
</style>
