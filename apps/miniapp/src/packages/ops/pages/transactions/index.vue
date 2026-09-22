<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { onLoad, onShow, onPullDownRefresh } from "@dcloudio/uni-app";
import OperationsFrame from "../../components/OperationsFrame.vue";
import OperationsTabs from "../../components/OperationsTabs.vue";
import ActionDialog from "../../../../components/ActionDialog.vue";
import StatusBadge from "../../../../components/StatusBadge.vue";
import SectionEmpty from "../../../../components/SectionEmpty.vue";
import { useSessionStore } from "../../../../stores/session";
import { hasOperationsAccess } from "../../../../config/operations";
import {
  money,
  today,
  shortDate,
  venueDateKey,
} from "../../../../utils/format";
import { accountAmount, accountLabels } from "../../../../utils/member-wallet";
import { endpoints } from "../../../../services/api";
import {
  captureAuthSession,
  useAccessToken,
  isAuthSessionCurrent,
} from "../../../../services/auth-session";
import { orderTimeLabel } from "../../../../pages/order/order-presentation";
import { useTransactions } from "./use-transactions";
const session = useSessionStore(),
  data = useTransactions();
const {
  view,
  keyword,
  dateFrom,
  dateTo,
  status,
  businessType,
  channel,
  scope,
  dateBasis,
  items,
  summary,
  total,
  loading,
  error,
  hasMore,
  load,
  changeView,
} = data;
onLoad(options => {
  if (options?.view !== 'orders' && options?.view !== 'refunds') return;
  view.value = options.view;
  if (typeof options.before === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(options.before)) { dateFrom.value = ''; dateTo.value = options.before; }
  if (options.dateBasis === 'usage') dateBasis.value = 'usage';
});
const searchText = ref("");
let savedFilters: string[] = [];
function showFilters() {
  savedFilters = [
    dateFrom.value,
    dateTo.value,
    status.value,
    businessType.value,
    channel.value,
    dateBasis.value,
  ];
  filtersOpen.value = true;
}
function closeFilters() {
  [
    dateFrom.value,
    dateTo.value,
    status.value,
    businessType.value,
    channel.value,
    dateBasis.value,
  ] = savedFilters;
  filtersOpen.value = false;
}
function search() {
  keyword.value = searchText.value;
  void load();
}
const filtersOpen = ref(false),
  ledgerDetail = ref<any>(null),
  selectedOrderId = ref("");
const canSeeAccounts = computed(() =>
  session.roles.some((r) => ["FINANCE", "ADMIN", "SUPER_ADMIN"].includes(r)),
);
const tabs = [
  { key: "orders", title: "订单" },
  { key: "ledger", title: "收支流水" },
  { key: "refunds", title: "退款" },
];
const types = [
  ["", "全部业务"],
  ["VENUE", "订场"],
  ["GAME", "球局"],
  ["EVENT", "赛事"],
  ["TRAINING", "课程"],
  ["RECHARGE", "充值"],
  ["MEMBERSHIP", "会员"],
  ["GOODS", "商品"],
  ["ALLIANCE", "联盟"],
];
const channels = [
  ["", "全部方式"],
  ["WECHAT", "微信支付"],
  ["OFFLINE_CASH", "现金"],
  ["CASH_PRINCIPAL", "充值余额"],
  ["GIFT_BALANCE", "赠送余额"],
  ["BADMINTON_COIN", "羽球币"],
  ["COUPON", "卡券"],
];
const statuses = computed(() =>
  view.value === "refunds"
    ? [
        ["", "待处理及进行中"],
        ["ALL", "全部退款"],
        ["REQUESTED", "待处理"],
        ["PROCESSING", "处理中"],
        ["SUCCEEDED", "已退款"],
        ["FAILED", "失败"],
        ["REJECTED", "已驳回"],
      ]
    : [
        ["", "全部状态"],
        ["PENDING", "待付款"],
        ["PAID", "已付款"],
        ["CHECKED_IN", "已签到"],
        ["COMPLETED", "已完成"],
        ["REFUND_PENDING", "退款中"],
        ["PARTIALLY_REFUNDED", "部分退款"],
        ["REFUNDED", "已退款"],
        ["CANCELLED", "已取消"],
      ],
);
const dateLabel = computed(() =>
  !dateFrom.value && !dateTo.value
    ? "全部日期"
    : dateFrom.value === dateTo.value
      ? dateFrom.value
      : `${dateFrom.value || "不限"} 至 ${dateTo.value || "不限"}`,
);
const timeBasis = computed(() =>
  view.value === "orders"
    ? dateBasis.value === "usage"
      ? "使用日期"
      : "下单日期"
    : view.value === "refunds"
      ? "申请日期"
      : "发生日期",
);
const groupDate = (row: any) =>
  venueDateKey(row.at || row.requestedAt || row.createdAt) || "日期未记录";
const channelLabel = (value: string) =>
  channels.find((x) => x[0] === value)?.[1] || accountLabels[value] || value;
function open(row: any) {
  const id = view.value === "orders" ? row.id : row.orderId;
  if (!id) {
    ledgerDetail.value = row;
    return;
  }
  selectedOrderId.value = id;
  uni.navigateTo({
    url: "/pages/order/detail?id=" + encodeURIComponent(id) + "&management=1",
  });
}
function apply() {
  filtersOpen.value = false;
  void load();
}
function quickDate(days: number | null) {
  dateFrom.value = days === null ? "" : today(days);
  dateTo.value = days === null ? "" : today();
  apply();
}
let initialized = false;
watch(
  [useAccessToken(), () => session.user?.id],
  () => {
    initialized = false;
    selectedOrderId.value = "";
    data.clear();
    scope.value = "EXTERNAL";
  },
  { flush: "sync" },
);
onShow(async () => {
  await session.hydrate();
  if (!hasOperationsAccess(session.roles, "transactions")) {
    data.clear();
    return;
  }
  if (!initialized) {
    initialized = true;
    await load();
    return;
  }
  if (selectedOrderId.value) {
    const owner = captureAuthSession();
    const id = selectedOrderId.value;
    selectedOrderId.value = "";
    try {
      const row = await endpoints.order(id);
      if (!isAuthSessionCurrent(owner)) return;
      if (view.value === "orders") {
        if (status.value && row.status !== status.value) {
          await load(false, true);
        } else
          items.value = items.value.map((x) => (x.id === row.id ? row : x));
      } else {
        await load(false, true);
      }
    } catch {
      if (isAuthSessionCurrent(owner))
        error.value = "最新状态未同步，请下拉刷新";
    }
  }
});

onPullDownRefresh(() => load());
</script>
<template>
  <OperationsFrame
    access="transactions"
    title="订单与流水"
    icon="receipt"
    eyebrow=""
    role=""
    description=""
  >
    <view class="sticky-controls"
      ><OperationsTabs
        :model-value="view"
        :items="tabs"
        label="记录类型"
        @update:model-value="changeView"
      /><view class="search"
        ><input
          v-model="searchText"
          aria-label="搜索订单号、会员姓名或手机号"
          placeholder="订单号、会员姓名或手机号"
          maxlength="50"
          confirm-type="search"
          @confirm="search"
        /><button @tap="search">搜索</button></view
      ><view class="filter-line"
        ><button @tap="showFilters">{{ dateLabel }} · {{ timeBasis }}⌄</button
        ><button @tap="showFilters">
          筛选{{ status || businessType || channel ? " · 已选" : "" }}
        </button></view
      ></view
    >
    <view v-if="view === 'ledger'" class="ledger-scope"
      ><button
        :class="{ selected: scope === 'EXTERNAL' }"
        @tap="
          scope = 'EXTERNAL';
          load();
        "
      >
        外部收付款</button
      ><button
        v-if="canSeeAccounts"
        :class="{ selected: scope === 'ACCOUNTS' }"
        @tap="
          scope = 'ACCOUNTS';
          load();
        "
      >
        账户变动</button
      ><text class="muted">{{
        scope === "EXTERNAL"
          ? "微信与现金收付款，不含余额消费及未实际付款的结算。"
          : "各账户分别记录；冻结/解冻不计入增减合计。"
      }}</text></view
    >
    <view v-if="!loading && !error && summary.length" class="summary"
      ><view v-for="item in summary" :key="item.channel"
        ><text>{{ channelLabel(item.channel) }} · {{ item.count }} 笔</text
        ><text
          >增加
          {{
            scope === "EXTERNAL"
              ? money(item.incoming)
              : accountAmount(item.channel, item.incoming)
          }}
          · 减少
          {{
            scope === "EXTERNAL"
              ? money(item.outgoing)
              : accountAmount(item.channel, item.outgoing)
          }}</text
        ></view
      ><text class="muted">当前筛选范围全量汇总</text></view
    >
    <text v-if="total != null" class="result-count">共 {{ total }} 笔</text>
    <view v-if="error" class="card" role="alert"
      ><text>{{ error }}</text
      ><button class="secondary" @tap="load()">重新加载</button></view
    >
    <view v-if="loading && !items.length" class="card skeleton"
      >正在读取记录…</view
    >
    <template v-for="(row, index) in items" :key="row.id"
      ><text
        v-if="index === 0 || groupDate(row) !== groupDate(items[index - 1])"
        class="day-heading"
        >{{ groupDate(row) }}</text
      ><button class="record" @tap="open(row)">
        <view class="record-heading"
          ><text>{{
            view === "refunds"
              ? row.order?.member?.displayName
              : row.memberName || row.member?.displayName || "会员"
          }}</text
          ><text v-if="view === 'ledger'" class="record-amount"
            >{{ row.amount > 0 ? "+" : ""
            }}{{
              scope === "EXTERNAL"
                ? money(row.amount)
                : accountAmount(row.channel, row.amount)
            }}</text
          ><text v-else class="record-amount">{{
            money(
              view === "refunds"
                ? row.amountCents
                : row.status === "PENDING"
                  ? row.payableCents
                  : row.paidCents,
            )
          }}</text></view
        ><text class="record-title">{{
          row.title || row.order?.title || row.reason || "账户变动"
        }}</text
        ><view class="record-heading"
          ><text class="muted"
            >{{ shortDate(row.at || row.requestedAt || row.createdAt)
            }}{{
              view === "ledger" ? " · " + channelLabel(row.channel) : ""
            }}</text
          ><StatusBadge
            v-if="view !== 'ledger'"
            :value="row.status"
            :domain="view === 'refunds' ? 'refund' : 'general'"
          /><text v-else class="muted">{{ row.reason }} ›</text
          ><text
            v-if="
              view === 'orders' &&
              (row.bookings?.length || row.gameRegistration || row.eventTeam)
            "
            class="muted"
            >{{ orderTimeLabel(row) }}</text
          ></view
        >
      </button></template
    >
    <button
      v-if="hasMore"
      class="secondary more"
      :loading="loading"
      :disabled="loading"
      @tap="load(true)"
    >
      加载更多
    </button>
    <SectionEmpty
      v-if="!loading && !error && !items.length"
      title="没有符合条件的记录"
      description="试试其他日期或清除筛选条件。"
    />
    <button
      v-if="!loading && !items.length && (dateFrom || dateTo)"
      class="secondary more"
      @tap="quickDate(null)"
    >
      扩大到全部日期
    </button>
    <ActionDialog v-if="filtersOpen" title="筛选记录" @close="closeFilters"
      ><view class="filters"
        ><view class="quick-dates"
          ><button @tap="quickDate(0)">今天</button
          ><button
            @tap="
              dateFrom = today(-1);
              dateTo = dateFrom;
              apply();
            "
          >
            昨天</button
          ><button @tap="quickDate(-6)">近7天</button
          ><button @tap="quickDate(null)">全部日期</button></view
        ><label
          >开始日期<picker
            mode="date"
            :value="dateFrom || today()"
            @change="dateFrom = $event.detail.value"
            ><view>{{ dateFrom || "不限" }} ›</view></picker
          ></label
        ><label
          >结束日期<picker
            mode="date"
            :value="dateTo || today()"
            @change="dateTo = $event.detail.value"
            ><view>{{ dateTo || "不限" }} ›</view></picker
          ></label
        ><label v-if="view === 'orders'"
          >日期口径<picker
            :range="['下单日期', '使用日期（场地/活动）']"
            :value="dateBasis === 'usage' ? 1 : 0"
            @change="
              dateBasis = Number($event.detail.value) ? 'usage' : 'created'
            "
            ><view>{{ timeBasis }} ›</view></picker
          ></label
        ><label v-if="view !== 'ledger'"
          >状态<picker
            :range="statuses.map((x) => x[1])"
            :value="
              Math.max(
                0,
                statuses.findIndex((x) => x[0] === status),
              )
            "
            @change="status = statuses[Number($event.detail.value)][0]"
            ><view
              >{{
                statuses.find((x) => x[0] === status)?.[1] || "全部"
              }}
              ›</view
            ></picker
          ></label
        ><template v-if="view === 'orders'"
          ><label
            >业务<picker
              :range="types.map((x) => x[1])"
              :value="
                Math.max(
                  0,
                  types.findIndex((x) => x[0] === businessType),
                )
              "
              @change="businessType = types[Number($event.detail.value)][0]"
              ><view
                >{{ types.find((x) => x[0] === businessType)?.[1] }} ›</view
              ></picker
            ></label
          ><label
            >支付方式<picker
              :range="channels.map((x) => x[1])"
              :value="
                Math.max(
                  0,
                  channels.findIndex((x) => x[0] === channel),
                )
              "
              @change="channel = channels[Number($event.detail.value)][0]"
              ><view>{{ channelLabel(channel) }} ›</view></picker
            ></label
          ></template
        ></view
      ><template #footer
        ><button class="primary more" @tap="apply">查看结果</button></template
      ></ActionDialog
    >
    <ActionDialog
      v-if="ledgerDetail"
      title="流水详情"
      @close="ledgerDetail = null"
      ><view class="filters"
        ><text>{{ ledgerDetail.reason }}</text
        ><text>{{ shortDate(ledgerDetail.at) }}</text
        ><text
          >{{ channelLabel(ledgerDetail.channel) }}
          {{ accountAmount(ledgerDetail.channel, ledgerDetail.amount) }}</text
        ><text>操作人：{{ ledgerDetail.operatorName || "系统" }}</text></view
      ></ActionDialog
    >
  </OperationsFrame>
</template>
<style scoped>
.sticky-controls {
  position: sticky;
  top: var(--window-top, 0px);
  z-index: 10;
  background: #f5f6f8;
  padding-bottom: 12rpx;
}
.search {
  display: flex;
  gap: 12rpx;
  background: white;
  border-radius: 20rpx;
  padding: 8rpx 16rpx;
}
.search input {
  min-width: 0;
  flex: 1;
  font-size: 28rpx;
  height: 88rpx;
}
.search button,
.filter-line button {
  margin: 0;
  background: transparent;
  color: var(--color-primary);
  font-size: 26rpx;
}
.filter-line,
.record-heading {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12rpx;
}
.filter-line {
  flex-wrap: wrap;
}
.record {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 12rpx;
  text-align: left;
  width: 100%;
  padding: 26rpx;
  margin: 0;
  background: white;
  border-radius: 0;
  border-bottom: 1rpx solid var(--color-border);
  font-size: 28rpx;
}
.record-heading > text:first-child {
  min-width: 0;
  overflow-wrap: anywhere;
}
.record-title {
  font-size: 30rpx;
  font-weight: 600;
  overflow-wrap: anywhere;
}
.record-amount {
  flex-shrink: 0;
  font-size: 30rpx;
}
.day-heading {
  display: block;
  font-size: 26rpx;
  color: #626d66;
  padding: 24rpx 0 12rpx;
}
.more {
  width: 100%;
  margin: 24rpx 0 0;
}
.filters {
  display: grid;
  gap: 24rpx;
}
.filters label {
  display: grid;
  gap: 12rpx;
}
.filters picker {
  background: #f5f6f8;
  padding: 20rpx;
  border-radius: 16rpx;
}
.quick-dates {
  display: flex;
  gap: 8rpx;
}
.quick-dates button {
  font-size: 26rpx;
  flex: 1;
  margin: 0;
}
.ledger-scope {
  display: flex;
  flex-wrap: wrap;
  gap: 12rpx;
}
.ledger-scope button {
  margin: 0;
  background: white;
  font-size: 26rpx;
}
.ledger-scope .selected {
  background: var(--color-primary-soft);
  color: var(--color-primary);
}
.ledger-scope > text {
  width: 100%;
  line-height: 1.5;
}
.summary {
  display: grid;
  gap: 12rpx;
  padding: 24rpx;
  background: white;
  border-radius: 20rpx;
  margin-top: 20rpx;
  font-size: 26rpx;
}
.summary > view {
  display: grid;
  gap: 6rpx;
}
.result-count {
  display: block;
  margin: 20rpx 0;
  color: #626d66;
  font-size: 26rpx;
}
</style>
