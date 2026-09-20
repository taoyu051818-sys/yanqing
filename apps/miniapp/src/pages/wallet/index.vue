<script setup lang="ts">
import { computed, ref, watch } from "vue";
import GuestState from "../../components/GuestState.vue";
import {
  captureAuthSession,
  isAuthSessionCurrent,
  useAccessToken,
} from "../../services/auth-session";
import { onShow } from "@dcloudio/uni-app";
import { useSessionStore } from "../../stores/session";
import {
  accountAmount,
  accountLabels,
  relevantAccounts,
  walletGroup,
} from "../../utils/member-wallet";
import {
  openMemberPage,
  requestMemberLogin,
} from "../../utils/member-navigation";
const session = useSessionStore();
const loading = ref(false);
const error = ref("");
const showAll = ref(false);
const showRules = ref(false);
const accounts = computed(() =>
  relevantAccounts(session.user?.accounts || [], [], showAll.value),
);
const groups = computed(() =>
  ["场馆余额", "奖励权益", "运动记录"]
    .map((title) => ({
      title,
      accounts: accounts.value.filter(
        (account) => walletGroup(account.type) === title,
      ),
    }))
    .filter((group) => group.accounts.length),
);
function clearPrivateState() {
  error.value = "";
}
watch(useAccessToken(), clearPrivateState, { flush: "sync" });
async function load() {
  if (!session.isAuthenticated) {
    clearPrivateState();
    return;
  }
  const owner = captureAuthSession();
  loading.value = true;
  error.value = "";
  try {
    const refreshed = await session.hydrate();
    if (!isAuthSessionCurrent(owner)) return;
    if (!refreshed) throw new Error("余额暂未同步，请重试；这不代表余额为零。");
  } catch (cause: any) {
    if (isAuthSessionCurrent(owner))
      error.value = cause?.message || "钱包暂未同步，请稍后重试";
  } finally {
    loading.value = false;
  }
}
onShow(load);
</script>
<template>
  <view class="page safe-bottom">
    <GuestState
      v-if="!session.isAuthenticated"
      title="钱包与权益"
      description="这里汇总你的余额、奖励权益与收支记录。可以先查看余额使用说明和会员方案。"
      action-text="登录查看我的钱包"
      @login="requestMemberLogin('/pages/wallet/index')"
    />
    <view v-if="error" class="card load-error"
      ><text>{{ error }}</text
      ><button class="secondary" @tap="load">重试</button></view
    >
    <view v-if="loading" class="muted">正在同步余额与记录…</view>
    <view
      v-for="group in groups.filter(
        (item) => showAll || item.title === '场馆余额',
      )"
      :key="group.title"
    >
      <text class="section-title">{{ group.title }}</text>
      <view class="card wallet-group">
        <view
          v-for="account in group.accounts"
          :key="account.id"
          class="balance-row"
          ><view
            ><text class="account-label">{{
              accountLabels[account.type] || "其他权益"
            }}</text
            ><text v-if="account.frozenBalance" class="muted"
              >其中暂不可用
              {{ accountAmount(account.type, account.frozenBalance) }}</text
            ></view
          ><text class="balance">{{
            accountAmount(account.type, account.balance)
          }}</text></view
        >
      </view>
    </view>
    <view class="wallet-actions"
      ><button
        class="secondary"
        @tap="openMemberPage('/pages/membership/index')"
      >
        充值与会员</button
      ><button class="secondary" @tap="openMemberPage('/pages/coupon/index')">
        我的卡券
      </button></view
    >
    <view class="disclosures" :class="{ guest: !session.isAuthenticated }"
      ><button v-if="session.isAuthenticated" @tap="showAll = !showAll">
        {{ showAll ? "收起其他权益" : "羽球币与积分" }}</button
      ><button @tap="showRules = !showRules">
        {{ showRules ? "收起说明" : "余额使用说明" }}
      </button></view
    >
    <view v-if="showRules" class="card rules"
      >充值余额与赠送余额分别记录，适用范围以支付页为准。羽毛球币和积分不是现金，不与余额合计。退款与暂不可用金额可在相关订单中查看。</view
    >
    <button
      v-if="session.isAuthenticated"
      class="secondary history-entry"
      @tap="openMemberPage('/pages/wallet/history')"
    >
      账户明细与历史记录 ›
    </button>
  </view>
</template>
<style scoped>
.history-entry {
  width: 100%;
  margin-top: 24rpx;
}
.wallet-group {
  padding: 4rpx 26rpx;
}
.balance-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20rpx;
  padding: 26rpx 0;
  border-bottom: 1rpx solid var(--color-border);
}
.balance-row:last-child {
  border: 0;
}
.balance-row > view {
  flex: 1;
  min-width: 0;
}
.account-label {
  display: block;
  font-size: 28rpx;
}
.balance-row .muted {
  display: block;
  margin-top: 8rpx;
  font-size: 23rpx;
}
.balance {
  font-size: 34rpx;
  font-weight: 800;
  color: var(--color-primary-strong);
  overflow-wrap: anywhere;
}
.wallet-actions,
.disclosures.guest {
  grid-template-columns: 1fr;
}
.disclosures {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14rpx;
}
.wallet-actions button,
.disclosures button {
  width: 100%;
  margin: 0;
  font-size: 26rpx;
}
.disclosures.guest {
  grid-template-columns: 1fr;
}
.disclosures {
  margin-top: 18rpx;
}
.disclosures button {
  color: var(--color-muted);
  background: transparent;
  font-size: 24rpx;
}
.rules {
  font-size: 25rpx;
  line-height: 1.7;
  color: var(--color-muted);
}
.record-filter {
  padding: 20rpx;
  margin-bottom: 20rpx;
  background: var(--color-surface);
  border-radius: 16rpx;
  font-size: 25rpx;
}
.transaction {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 18rpx;
}
.transaction > view {
  flex: 1;
  min-width: 0;
}
.reason {
  display: block;
  margin-bottom: 8rpx;
  font-size: 27rpx;
  overflow-wrap: anywhere;
}
.amount {
  max-width: 42%;
  font-size: 28rpx;
  font-weight: 700;
  overflow-wrap: anywhere;
}
.load-error {
  display: grid;
  gap: 16rpx;
  color: var(--color-danger);
}
</style>
