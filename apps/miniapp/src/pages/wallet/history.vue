<script setup lang="ts">
import type { LedgerEntry } from "@yanqing/shared";
import { ref, watch } from "vue";
import { onShow, onUnload, onPullDownRefresh } from "@dcloudio/uni-app";
import GuestState from "../../components/GuestState.vue";
import SectionEmpty from "../../components/SectionEmpty.vue";
import { endpoints } from "../../services/api";
import {
  captureAuthSession,
  useAccessToken,
  isAuthSessionCurrent,
} from "../../services/auth-session";
import { useSessionStore } from "../../stores/session";
import { requestMemberLogin } from "../../utils/member-navigation";
import { accountLabels, accountAmount } from "../../utils/member-wallet";
import { shortDate, today } from "../../utils/format";
const session = useSessionStore(),
  items = ref<LedgerEntry[]>([]),
  cursor = ref<string | null>(null),
  accountType = ref(""),
  dateFrom = ref(""),
  dateTo = ref(""),
  loading = ref(false),
  error = ref("");
const types = [
  "",
  ...Object.keys(accountLabels).filter((x) => x !== "YOUTH_GROWTH_POINTS"),
];
let generation = 0,
  alive = true,
  initialized = false;
function clear() {
  initialized = false;
  generation++;
  items.value = [];
  cursor.value = null;
  error.value = "";
  loading.value = false;
}
watch([useAccessToken(), () => session.user?.id], clear, { flush: "sync" });
async function load(more = false) {
  if (!session.isAuthenticated) {
    clear();
    return;
  }
  if (more && loading.value) return;
  if (!more) {
    items.value = [];
    cursor.value = null;
  }
  const run = ++generation,
    owner = captureAuthSession();
  loading.value = true;
  error.value = "";
  try {
    const result = await endpoints.memberLedger({
      pageSize: 30,
      cursor: more ? cursor.value : undefined,
      accountType: accountType.value || undefined,
      dateFrom: dateFrom.value || undefined,
      dateTo: dateTo.value || undefined,
    });
    if (alive && run === generation && isAuthSessionCurrent(owner)) {
      items.value = more ? [...items.value, ...result.items] : result.items;
      cursor.value = result.nextCursor;
    }
  } catch (e: any) {
    if (run === generation && isAuthSessionCurrent(owner))
      error.value = e?.message || "明细加载失败";
  } finally {
    if (run === generation) {
      loading.value = false;
      uni.stopPullDownRefresh();
    }
  }
}
function openOrder(id: string) {
  uni.navigateTo({ url: "/pages/order/detail?id=" + encodeURIComponent(id) });
}
onShow(async () => {
  if (!session.isAuthenticated) {
    clear();
    return;
  }
  await session.hydrate();
  if (!initialized) {
    initialized = true;
    await load();
  }
});
onPullDownRefresh(() => load());
onUnload(() => {
  alive = false;
  clear();
});
</script>
<template>
  <view class="page safe-bottom"
    ><GuestState
      v-if="!session.isAuthenticated"
      title="账户明细"
      description="登录后查看自己的收支与权益变动。"
      @login="requestMemberLogin('/pages/wallet/history')" /><view
      class="history-filters"
      ><picker
        :range="types.map((x) => accountLabels[x] || '全部账户')"
        @change="
          accountType = types[Number($event.detail.value)];
          load();
        "
        ><view>{{ accountLabels[accountType] || "全部账户" }} ›</view></picker
      ><picker
        mode="date"
        :value="dateFrom || today()"
        @change="
          dateFrom = $event.detail.value;
          load();
        "
        ><view>从 {{ dateFrom || "不限日期" }}</view></picker
      ><picker
        mode="date"
        :value="dateTo || today()"
        @change="
          dateTo = $event.detail.value;
          load();
        "
        ><view>至 {{ dateTo || "不限日期" }}</view></picker
      ><button
        @tap="
          dateFrom = '';
          dateTo = '';
          accountType = '';
          load();
        "
      >
        清除筛选
      </button></view
    ><text v-if="error" role="alert">{{ error }}</text
    ><button v-if="error" class="secondary" @tap="load()">重试</button
    ><view v-for="item in items" :key="item.id" class="history-row"
      ><view class="row"
        ><text>{{ item.reason }}</text
        ><text
          >{{ item.amount > 0 ? "+" : ""
          }}{{ accountAmount(item.channel, item.amount) }}</text
        ></view
      ><text class="muted"
        >{{ shortDate(item.at) }} · {{ accountLabels[item.channel] }}</text
      ><button v-if="item.orderId" @tap="openOrder(item.orderId)">
        查看相关订单 ›
      </button></view
    ><button
      v-if="cursor"
      class="secondary"
      :loading="loading"
      :disabled="loading"
      @tap="load(true)"
    >
      加载更多</button
    ><text v-if="loading">正在加载…</text
    ><SectionEmpty
      v-if="session.isAuthenticated && !loading && !error && !items.length"
      title="暂无符合条件的记录"
  /></view>
</template>
<style scoped>
.history-filters {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16rpx;
  margin-bottom: 24rpx;
}
.history-filters picker {
  padding: 20rpx;
  background: white;
  border-radius: 16rpx;
  font-size: 26rpx;
}
.history-filters button {
  font-size: 26rpx;
  margin: 0;
}
.history-row {
  padding: 24rpx;
  background: white;
  border-bottom: 1rpx solid var(--color-border);
  display: grid;
  gap: 12rpx;
  font-size: 28rpx;
}
.history-row .row {
  gap: 16rpx;
  align-items: flex-start;
}
.history-row button {
  font-size: 26rpx;
  margin: 0;
  background: transparent;
  color: var(--color-primary);
  text-align: left;
}
</style>
