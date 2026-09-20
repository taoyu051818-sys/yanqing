<script setup lang="ts">
import { computed, ref } from "vue";
import { onShow } from "@dcloudio/uni-app";
import SectionEmpty from "../../components/SectionEmpty.vue";
import { endpoints } from "../../services/api";
import { money } from "../../utils/format";
import { withPendingCreationKey } from "../../utils/pending-creation-key";
import { useSessionStore } from "../../stores/session";
import {
  openMemberPage,
  requestMemberLogin,
} from "../../utils/member-navigation";

const tab = ref("recharge"),
  selectedId = ref("");
const selectedPlan = computed(() =>
  (tab.value === "recharge" ? rechargePlans.value : products.value).find(
    (item) => item.id === selectedId.value,
  ),
);
function selectTab(value: string) {
  tab.value = value;
  selectedId.value = "";
  actionError.value = "";
}
const session = useSessionStore();
const busy = ref("");
const actionError = ref("");
const products = ref<any[]>([]);
const rechargePlans = ref<any[]>([]);
const loading = ref(false);
const error = ref("");
const levelName: Record<string, string> = {
  REGULAR: "年度会员",
  GOLD: "金卡会员",
  BLACK: "黑金会员",
};
const benefitName: Record<string, string> = {
  booking: "订场权益",
  discount: "会员折扣",
  guest: "同行权益",
  training: "培训权益",
  event: "赛事权益",
};
function benefitText(key: string, value: unknown) {
  const label = benefitName[key] || "会员权益";
  if (typeof value === "string" || typeof value === "number")
    return `${label}：${value}`;
  if (value === true) return label;
  return `${label}：以场馆公示为准`;
}
async function load() {
  loading.value = true;
  error.value = "";
  try {
    const [productResult, planResult] = await Promise.all([
      endpoints.membershipProducts(),
      endpoints.rechargePlans(),
    ]);
    products.value = productResult;
    rechargePlans.value = planResult;
  } catch (cause: any) {
    error.value = cause?.message || "会员方案加载失败，请稍后重试";
  } finally {
    loading.value = false;
  }
}
async function purchase(product: any) {
  if (!session.isAuthenticated)
    return requestMemberLogin("/pages/membership/index");
  if (busy.value) return;
  busy.value = product.id;
  actionError.value = "";
  try {
    const command = { productId: product.id };
    const order: any = await withPendingCreationKey(
      "membership.purchase",
      command,
      (creationIdempotencyKey) =>
        endpoints.purchaseMembership(product.id, creationIdempotencyKey),
    );
    await openMemberPage(
      `/pages/order/index?id=${encodeURIComponent(order.id)}`,
    );
  } catch (cause: any) {
    actionError.value = cause.message || "下单失败，请重试";
  } finally {
    busy.value = "";
  }
}
async function recharge(plan: any) {
  if (!session.isAuthenticated)
    return requestMemberLogin("/pages/membership/index");
  if (busy.value) return;
  busy.value = plan.id;
  actionError.value = "";
  try {
    const command = { planId: plan.id };
    const order: any = await withPendingCreationKey(
      "membership.recharge",
      command,
      (creationIdempotencyKey) =>
        endpoints.recharge(plan.id, creationIdempotencyKey),
    );
    await openMemberPage(
      `/pages/order/index?id=${encodeURIComponent(order.id)}`,
    );
  } catch (cause: any) {
    actionError.value = cause.message || "下单失败，请重试";
  } finally {
    busy.value = "";
  }
}
onShow(load);
</script>
<template>
  <view class="page safe-bottom">
    <view class="membership-tabs"
      ><button
        :class="{ active: tab === 'recharge' }"
        @tap="selectTab('recharge')"
      >
        余额充值</button
      ><button
        :class="{ active: tab === 'membership' }"
        @tap="selectTab('membership')"
      >
        开通会员
      </button></view
    >
    <view v-if="error" class="card load-error"
      ><text>{{ error }}</text
      ><button class="secondary retry" @tap="load">重试</button></view
    >
    <view v-if="actionError" class="card load-error" role="alert">{{
      actionError
    }}</view>
    <template v-if="tab === 'recharge'">
      <view
        v-for="plan in rechargePlans"
        :key="plan.id"
        class="card recharge-plan"
      >
        <view class="plan-copy"
          ><text class="name">{{ plan.name }}</text
          ><text class="muted"
            >本金 {{ money(plan.principalCents) }} · 赠送
            {{ money(plan.giftCents) }}，分账到账</text
          ></view
        >
        <button
          class="secondary plan-button"
          :aria-pressed="selectedId === plan.id"
          :disabled="Boolean(busy)"
          @tap="selectedId = plan.id"
        >
          {{ selectedId === plan.id ? "已选择" : "选择" }}
        </button>
      </view>
      <SectionEmpty
        v-if="!rechargePlans.length && !loading && !error"
        title="暂无可用充值计划"
      /> </template
    ><template v-else>
      <view
        v-for="product in products"
        :key="product.id"
        class="card product"
        :class="product.level.toLowerCase()"
      >
        <view class="row product-head"
          ><text class="pill">{{ levelName[product.level] || "会员方案" }}</text
          ><text class="muted">有效期 {{ product.durationDays }} 天</text></view
        >
        <text class="name">{{ product.name }}</text>
        <view class="benefits"
          ><text v-for="(value, key) in product.benefits" :key="key"
            >✓ {{ benefitText(String(key), value) }}</text
          ></view
        >
        <view class="row purchase-row"
          ><text class="price">{{ money(product.priceCents) }}</text
          ><button
            class="secondary buy"
            :aria-pressed="selectedId === product.id"
            :disabled="Boolean(busy)"
            @tap="selectedId = product.id"
          >
            {{ selectedId === product.id ? "已选择" : "选择方案" }}
          </button></view
        >
      </view>
      <SectionEmpty
        v-if="!products.length && !loading && !error"
        title="暂无会员产品"
      /> </template
    ><view class="membership-dock"
      ><view
        ><text>{{ selectedPlan ? selectedPlan.name : "请选择方案" }}</text
        ><text v-if="selectedPlan" class="price">{{
          money(
            tab === "recharge"
              ? selectedPlan.principalCents
              : selectedPlan.priceCents,
          )
        }}</text></view
      ><button
        class="primary"
        :disabled="!selectedPlan || Boolean(busy)"
        :loading="Boolean(busy)"
        @tap="
          tab === 'recharge' ? recharge(selectedPlan) : purchase(selectedPlan)
        "
      >
        下一步付款
      </button></view
    >
  </view>
</template>
<style scoped>
.page {
  padding-bottom: calc(210rpx + env(safe-area-inset-bottom));
}
.membership-tabs {
  display: flex;
  gap: 12rpx;
  margin-bottom: 24rpx;
}
.membership-tabs button {
  flex: 1;
  margin: 0;
  background: white;
  font-size: 30rpx;
}
.membership-tabs .active {
  background: var(--color-primary-soft);
  color: var(--color-primary);
}
.membership-dock {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  display: flex;
  align-items: center;
  gap: 20rpx;
  padding: 24rpx 28rpx calc(24rpx + env(safe-area-inset-bottom));
  background: white;
  border-top: 1rpx solid var(--color-border);
}
.membership-dock > view {
  flex: 1;
  min-width: 0;
}
.membership-dock text {
  display: block;
}
.membership-dock button {
  margin: 0;
  font-size: 28rpx;
}
.plan-button[aria-pressed="true"],
.buy[aria-pressed="true"] {
  outline: 2rpx solid var(--color-primary);
}
.hero {
  padding: 38rpx;
  margin-bottom: 24rpx;
  color: #fff;
  background: linear-gradient(145deg, #181f1b, #315940);
  border-radius: 30rpx;
}
.eyebrow {
  opacity: 0.7;
  font-size: 20rpx;
  letter-spacing: 2rpx;
}
.hero-title {
  display: block;
  margin: 28rpx 0 14rpx;
  font-size: 40rpx;
  font-weight: 800;
}
.hero-note {
  color: rgba(255, 255, 255, 0.72);
  font-size: 22rpx;
  line-height: 1.6;
}
.recharge-plan {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18rpx;
  margin-bottom: 14rpx;
}
.plan-copy {
  flex: 1 1 260rpx;
  min-width: 0;
}
.recharge-plan .name {
  margin: 0 0 8rpx;
  font-size: 29rpx;
}
.plan-button {
  flex: 0 1 auto;
  min-height: 72rpx;
  margin: 0;
  padding: 0 24rpx;
  font-size: 22rpx;
  line-height: 72rpx;
  white-space: normal;
}
.section-title {
  margin: 28rpx 0 16rpx;
  font-size: 31rpx;
  font-weight: 800;
}
.name {
  display: block;
  margin: 25rpx 0;
  font-size: 35rpx;
  font-weight: 800;
  overflow-wrap: anywhere;
}
.benefits {
  display: flex;
  flex-wrap: wrap;
  gap: 12rpx;
  margin-bottom: 28rpx;
}
.benefits text {
  max-width: 100%;
  padding: 9rpx 14rpx;
  color: #5f695f;
  background: #f3f6f2;
  border-radius: 999rpx;
  font-size: 21rpx;
  line-height: 1.5;
  overflow-wrap: anywhere;
}
.price {
  color: #17492f;
  font-size: 38rpx;
  font-weight: 800;
}
.buy {
  min-width: 180rpx;
  margin: 0;
}
.product-head,
.purchase-row {
  flex-wrap: wrap;
}
.black {
  border-top: 8rpx solid #262d29;
}
.gold {
  border-top: 8rpx solid #c8aa51;
}
.load-error {
  display: flex;
  align-items: center;
  gap: 18rpx;
  color: #9a3e36;
  background: #fff4f2;
}
.load-error text {
  flex: 1;
  min-width: 0;
  line-height: 1.5;
  overflow-wrap: anywhere;
}
.retry {
  flex: 0 0 auto;
  min-height: 64rpx;
  margin: 0;
  padding: 0 22rpx;
  line-height: 64rpx;
  font-size: 23rpx;
}
@media (max-width: 360px) {
  .recharge-plan {
    align-items: stretch;
    flex-wrap: wrap;
  }
  .plan-copy,
  .plan-button {
    flex-basis: 100%;
    width: 100%;
  }
  .purchase-row {
    align-items: stretch;
  }
  .purchase-row .price {
    width: 100%;
  }
  .buy {
    width: 100%;
  }
}
</style>
