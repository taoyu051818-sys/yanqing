<script setup lang="ts">
import { useBookingCoupons } from "./use-booking-coupons";
import { useBookingAvailability } from "./use-booking-availability";
import MemberDirectorySearch from "../../components/MemberDirectorySearch.vue";
import VenueSummary from "../../components/VenueSummary.vue";
import { useVenueProfile } from "../../composables/use-venue-profile";
const venue = useVenueProfile();
import { computed, ref, watch } from "vue";
import { onHide, onShow, onUnload } from "@dcloudio/uni-app";
import AppIcon from "../../components/AppIcon.vue";
import SectionEmpty from "../../components/SectionEmpty.vue";
import ActionDialog from "../../components/ActionDialog.vue";
import BookingMemberPicker from "../../components/BookingMemberPicker.vue";
import { endpoints } from "../../services/api";
import {
  captureAuthSession,
  isAuthSessionCurrent,
} from "../../services/auth-session";
import { useSessionStore } from "../../stores/session";
import type { MemberDirectoryItem } from "../../types/domain";
import { money, today } from "../../utils/format";
import { withPendingCreationKey } from "../../utils/pending-creation-key";
import {
  requestMemberLogin,
  openMemberPage,
} from "../../utils/member-navigation";

import { consumeBookingIntent } from "../../utils/member-navigation";

const session = useSessionStore();
const bookingMode = ref<"SELF" | "ASSISTED">("SELF");
const targetMember = ref<MemberDirectoryItem | null>(null);
const showMembers = ref(false);
const canAssist = computed(() =>
  session.roles.some((role) =>
    ["FRONT_DESK", "ADMIN", "SUPER_ADMIN"].includes(role),
  ),
);
const assisted = computed(
  () => canAssist.value && bookingMode.value === "ASSISTED",
);
const showBookingReview = ref(false);
const reviewNeedsOverride = ref(false);
const overrideReason = ref("");
const submitting = ref(false);
const submissionError = ref("");
const assistedOrder = ref<{
  id: string;
  orderNo: string;
  memberId: string;
  memberName: string;
  courtName: string;
  date: string;
  slotRange: string;
  payableCents: number;
} | null>(null);
function resetBookingReview() {
  showBookingReview.value = false;
  reviewNeedsOverride.value = false;
  overrideReason.value = "";
}
function setMode(mode: "SELF" | "ASSISTED") {
  if (submitting.value || (mode === "ASSISTED" && !canAssist.value)) return;
  bookingMode.value = mode;
  targetMember.value = null;
  submissionError.value = "";
  couponCode.value = "";
  showCoupon.value = false;
  resetBookingReview();
  showMembers.value = false;
  void load(true);
}
function selectMember(member: MemberDirectoryItem) {
  if (submitting.value) return;
  resetBookingReview();
  targetMember.value = member;
  showMembers.value = false;
  submissionError.value = "";
}
function continueAssistedBooking(sameMember: boolean) {
  if (submitting.value || !assistedOrder.value) return;
  // Keeping a member must be an explicit choice for this completed order.
  if (!sameMember || targetMember.value?.id !== assistedOrder.value.memberId)
    targetMember.value = null;
  assistedOrder.value = null;
  selected.value = null;
  resetBookingReview();
  submissionError.value = "";
  couponCode.value = "";
  showCoupon.value = false;
  showMembers.value = false;
}
watch(
  () => session.user?.id,
  () => {
    bookingMode.value = "SELF";
    targetMember.value = null;
    showMembers.value = false;
    couponCode.value = "";
    assistedOrder.value = null;
    resetBookingReview();
  },
);
watch(canAssist, (allowed) => {
  if (!allowed) {
    bookingMode.value = "SELF";
    targetMember.value = null;
    showMembers.value = false;
    resetBookingReview();
  }
});
const {
  date,
  showAllDay,
  visibleSlots,
  data,
  loading,
  selected,
  error,
  selectedSlot,
  selectedCourt,
  slotRange,
  slotTimes,
  isBooked,
  isClosed,
  unavailableReason,
  blockedReason,
  needsOverride,
  load,
  choose,
} = useBookingAvailability({
  assisted,
  isSubmitting: () => submitting.value,
  onSelectionChange: () => {
    submissionError.value = "";
    resetBookingReview();
  },
});
function changeDate(value: string) {
  if (submitting.value) return;
  resetBookingReview();
  submissionError.value = "";
  date.value = value;
  void load(true);
}
const {
  couponCode,
  showCoupon,
  couponError,
  couponLoading,
  couponOptions,
  selectedCoupon,
  loadCoupons,
} = useBookingCoupons();

let pageGeneration = 0;
let pageVisible = true;
function leavePage() {
  pageVisible = false;
  pageGeneration++;
  showBookingReview.value = false;
}
onHide(leavePage);
onUnload(leavePage);

async function submit(confirmedReview = false) {
  if (submitting.value) return;
  if (!session.isAuthenticated)
    return requestMemberLogin("/pages/booking/index");
  if (assisted.value && !targetMember.value) {
    showMembers.value = true;
    return;
  }
  if (
    loading.value ||
    (!assisted.value && couponLoading.value) ||
    !selected.value
  )
    return;
  if (assisted.value && !confirmedReview) {
    overrideReason.value = "";
    reviewNeedsOverride.value = needsOverride.value;
    showBookingReview.value = true;
    submissionError.value = "";
    return;
  }
  // Keep retries of this reviewed command identical even if its first response
  // was lost and refreshing availability now shows the newly created hold.
  const requiresOverride = assisted.value && reviewNeedsOverride.value;
  if (requiresOverride && overrideReason.value.trim().length < 2) {
    submissionError.value = "请填写至少2字的代订原因";
    return;
  }
  const reason = requiresOverride ? overrideReason.value.trim() : undefined;
  submitting.value = true;
  submissionError.value = "";
  const isAssisted = assisted.value,
    customer = targetMember.value;
  const bookingSummary = {
    date: date.value,
    courtName: selectedCourt.value?.name || "场地预约",
    slotRange: selectedSlot.value ? slotRange(selectedSlot.value) : "",
  };
  const generation = pageGeneration,
    owner = captureAuthSession();
  const current = () =>
    pageVisible && generation === pageGeneration && isAuthSessionCurrent(owner);
  try {
    const command = {
      date: date.value,
      ...selected.value,
      ...(reason ? { overrideReason: reason } : {}),
      sourceChannel: isAssisted ? "STORE_VISIT" : "MINI_PROGRAM",
      ...(isAssisted
        ? { memberId: customer!.id }
        : { couponCode: couponCode.value || undefined }),
    };
    const order = await withPendingCreationKey(
      isAssisted ? "venue.booking.assisted" : "venue.booking.member",
      command,
      (creationIdempotencyKey) =>
        endpoints.createBooking({ ...command, creationIdempotencyKey }),
    );
    if (!current()) return;
    showBookingReview.value = false;
    if (isAssisted) {
      assistedOrder.value = {
        id: order.id,
        orderNo: order.orderNo,
        memberId: customer!.id,
        memberName: customer!.displayName,
        ...bookingSummary,
        payableCents: order.payableCents,
      };
      selected.value = null;
      await load();
    } else {
      uni.showToast({ title: "已锁定10分钟", icon: "success" });
      openMemberPage(
        `/pages/order/index${order?.id ? `?id=${encodeURIComponent(order.id)}` : ""}`,
      );
    }
  } catch (cause: any) {
    if (current()) {
      submissionError.value = cause.message || "预约未完成，请重试";
      await load();
    }
  } finally {
    submitting.value = false;
  }
}
function openAssistedOrder() {
  if (assistedOrder.value)
    uni.navigateTo({
      url:
        "/packages/ops/pages/frontdesk/index?focus=order&orderId=" +
        encodeURIComponent(assistedOrder.value.id),
    });
}

onShow(async () => {
  pageVisible = true;
  void venue.refresh();
  await session.hydrate();
  const intent = consumeBookingIntent();
  if (intent?.mode === "ASSISTED" && canAssist.value) {
    setMode("ASSISTED");
    if (intent.memberId) {
      showMembers.value = false;
      const userId = session.user?.id;
      try {
        const detail = await endpoints.member360(intent.memberId);
        if (session.user?.id === userId && assisted.value)
          targetMember.value = {
            ...detail.member,
            privacyScope: detail.privacyScope,
          };
      } catch {
        if (assisted.value) {
          showMembers.value = true;
          submissionError.value = "原会员信息未能同步，请重新选择会员";
        }
      }
    }
  }
  if (intent?.couponId) showCoupon.value = true;
  void load();
  void loadCoupons(intent?.couponId);
});
</script>

<template>
  <view class="page booking-page">
    <VenueSummary
      compact
      :profile="venue.profile.value"
      :error="venue.error.value"
    />
    <view class="card row">
      <view class="date-label"
        ><AppIcon name="booking" :size="32" /><text>预订日期</text></view
      >
      <picker
        mode="date"
        :disabled="submitting"
        :value="date"
        :start="assisted ? undefined : today()"
        @change="changeDate(($event.detail as any).value)"
      >
        <view class="date"
          ><text>{{ date }}</text
          ><AppIcon name="chevron" :size="26"
        /></view>
      </picker>
    </view>
    <view v-if="canAssist" class="card booking-identity">
      <view class="mode-switch"
        ><button
          :class="{ active: !assisted }"
          :aria-pressed="!assisted"
          :disabled="submitting"
          @tap="setMode('SELF')"
        >
          自己订场</button
        ><button
          :class="{ active: assisted }"
          :aria-pressed="assisted"
          :disabled="submitting"
          @tap="setMode('ASSISTED')"
        >
          代会员订场
        </button></view
      >
    </view>
    <view v-if="assisted && !targetMember" class="card inline-member-search"
      ><text class="inline-member-title">为哪位会员订场？</text
      ><MemberDirectorySearch :page-size="3" @select="selectMember"
    /></view>
    <view v-if="error" class="card error"
      ><AppIcon name="warning" :size="32" tone="danger" /><text>{{
        error
      }}</text
      ><button class="secondary" @tap="load()">重试</button></view
    >
    <view v-if="loading && !data" class="matrix-skeleton skeleton" />
    <view v-if="data?.courts.length && date === today()" class="day-toggle"
      ><button :aria-pressed="showAllDay" @tap="showAllDay = !showAllDay">
        {{ showAllDay ? "只看接下来时段" : "查看全天（含已过时）" }}
      </button></view
    >
    <view v-if="data?.courts.length" class="matrix-hint"
      ><AppIcon name="info" :size="24" tone="muted" /><text
        >每格 1 小时 · 左右滑动查看场地</text
      ></view
    >
    <scroll-view v-if="data?.courts.length" scroll-x class="matrix-wrap">
      <view
        class="matrix"
        :style="{
          width: `${180 + data.courts.length * 150}rpx`,
          gridTemplateColumns: `180rpx repeat(${data.courts.length}, 150rpx)`,
        }"
      >
        <view class="head cell">时段</view>
        <view v-for="court in data.courts" :key="court.id" class="head cell">{{
          court.name
        }}</view>
        <template v-for="slot in visibleSlots" :key="slot.id">
          <view class="slot-label cell"
            ><text>{{ slotRange(slot) }}</text
            ><text class="muted">1 小时</text></view
          >
          <view
            v-for="court in data.courts"
            :key="`${slot.id}-${court.id}`"
            class="cell court"
            :class="{
              disabled: Boolean(blockedReason(court.id, slot)),
              override:
                assisted &&
                Boolean(unavailableReason(court.id, slot)) &&
                !blockedReason(court.id, slot),
              selected:
                selected?.courtId === court.id && selected?.slotId === slot.id,
            }"
            :role="blockedReason(court.id, slot) ? undefined : 'button'"
            :aria-label="`${court.name}，${slot.label}，${unavailableReason(court.id, slot) || money(slot.price?.priceCents)}`"
            :aria-disabled="Boolean(blockedReason(court.id, slot))"
            :aria-pressed="
              selected?.courtId === court.id && selected?.slotId === slot.id
            "
            :tabindex="blockedReason(court.id, slot) ? -1 : 0"
            @tap="choose(court.id, slot)"
            @keyup.enter="choose(court.id, slot)"
          >
            <text>{{
              unavailableReason(court.id, slot) || money(slot.price?.priceCents)
            }}</text>
            <text
              v-if="
                selected?.courtId === court.id && selected?.slotId === slot.id
              "
              >已选</text
            ><text
              v-else-if="
                assisted &&
                unavailableReason(court.id, slot) &&
                !blockedReason(court.id, slot)
              "
              >可代订 · {{ money(slot.price?.priceCents) }}</text
            >
          </view>
        </template>
      </view>
    </scroll-view>
    <SectionEmpty
      v-if="data?.courts.length && !visibleSlots.length"
      title="今天已没有接下来的时段"
      description="可以切换日期，或点击查看全天。"
    />
    <SectionEmpty
      v-else-if="!data?.courts.length && !loading && !error"
      icon="venue"
      title="暂无可订时段"
      description="请切换日期或联系前台"
    />

    <view class="booking-dock">
      <button
        v-if="assisted"
        class="dock-member"
        :disabled="submitting"
        @tap="showMembers = true"
      >
        <text>{{
          targetMember
            ? "代订会员：" + targetMember.displayName
            : "第一步：选择代订会员"
        }}</text
        ><text>{{ targetMember ? "更换" : "选择会员" }} ›</text>
      </button>
      <text v-if="selected && !assisted" class="checkout-note"
        >下单后保留 10 分钟，未付款自动释放</text
      >
      <text v-if="submissionError" class="submit-error" role="alert">{{
        submissionError
      }}</text>
      <view v-if="selected" class="selection-summary"
        ><view
          ><text class="selection-title"
            >{{ selectedCourt?.name }} ·
            {{ selectedSlot ? slotRange(selectedSlot) : "" }}</text
          ><text class="muted"
            >{{ date }} · 1 小时{{
              assisted && targetMember ? " · " + targetMember.displayName : ""
            }}</text
          ></view
        ><button
          v-if="!assisted"
          class="coupon-toggle"
          :disabled="submitting"
          :aria-expanded="showCoupon"
          @tap="showCoupon = true"
        >
          {{ selectedCoupon ? "已选优惠" : "优惠券" }} ›
        </button></view
      >
      <view class="checkout-row"
        ><view class="checkout-price"
          ><template v-if="selected"
            ><text class="muted"
              >场地费{{
                selectedCoupon && !assisted ? " · 优惠下单核验" : ""
              }}</text
            ><text class="total-price">{{
              money(selectedSlot?.price?.priceCents)
            }}</text></template
          ><text v-else class="selection-prompt">{{
            assisted && !targetMember ? "先确定为谁订场" : "请选择场地和时段"
          }}</text></view
        ><button
          class="primary checkout-button"
          :loading="submitting"
          :disabled="
            (!selected && !(assisted && !targetMember)) ||
            (loading && !(assisted && !targetMember)) ||
            submitting ||
            (!assisted && couponLoading) ||
            (Boolean(error) && !(assisted && !targetMember))
          "
          @tap="submit()"
        >
          {{
            assisted && !targetMember
              ? "选择会员"
              : !selected
                ? "先选场地"
                : !session.isAuthenticated
                  ? "登录后继续"
                  : assisted
                    ? "核对代订"
                    : "确认预约"
          }}
        </button></view
      >
    </view>
    <view
      v-if="showCoupon && !assisted"
      class="booking-mask"
      @tap="showCoupon = false"
      ><view
        class="booking-sheet"
        role="dialog"
        aria-modal="true"
        aria-label="选择优惠券"
        @tap.stop
        ><view class="sheet-heading"
          ><text>选择优惠券</text
          ><button class="secondary" @tap="showCoupon = false">
            完成
          </button></view
        >
        <scroll-view scroll-y class="coupon-picker">
          <text v-if="!session.isAuthenticated" class="muted"
            >登录后可直接选择已有优惠券，无需填写券码。</text
          >
          <text v-if="couponLoading" class="muted">正在同步券包…</text>
          <view v-if="couponError" role="alert"
            ><text class="muted">{{ couponError }}</text
            ><button
              class="secondary"
              :disabled="couponLoading"
              @tap="loadCoupons()"
            >
              重新同步券包
            </button></view
          >
          <button
            class="secondary"
            :aria-pressed="!couponCode"
            :disabled="loading"
            @tap="couponCode = ''"
          >
            {{ !couponCode ? "已选 · " : "" }}不使用优惠券
          </button>
          <button
            v-for="coupon in couponOptions"
            :key="coupon.id"
            class="secondary"
            :aria-pressed="couponCode === coupon.code"
            :disabled="loading"
            @tap="couponCode = coupon.code"
          >
            <text
              >{{ couponCode === coupon.code ? "已选 · " : ""
              }}{{
                coupon.template.benefitDescription || coupon.template.name
              }}
              · {{ money(coupon.template.faceValueCents) }}</text
            >
          </button>
          <text
            v-if="
              session.isAuthenticated &&
              !couponLoading &&
              !couponOptions.length &&
              !couponError
            "
            class="muted"
            >暂无可选优惠券，可以直接预约。</text
          >
          <text class="muted"
            >部分券限指定时段；是否适用及最终金额由下单时核验。</text
          >
        </scroll-view>
      </view></view
    >
    <ActionDialog
      v-if="showBookingReview"
      :title="reviewNeedsOverride ? '确认特殊代订' : '核对代订订单'"
      :busy="submitting"
      @close="showBookingReview = false"
    >
      <view class="override-form"
        ><text class="identity-title"
          >{{ targetMember?.displayName }} · {{ selectedCourt?.name }}</text
        ><text
          >{{ date }} · {{ selectedSlot ? slotRange(selectedSlot) : "" }} ·
          {{ money(selectedSlot?.price?.priceCents) }}</text
        >
        <text v-if="reviewNeedsOverride" class="override-note"
          >当前场次：{{
            selected && selectedSlot
              ? unavailableReason(selected.courtId, selectedSlot) || "可订"
              : "请重新选择"
          }}。已有订单和封场安排会保留，请确认现场已协调。会员须在 10
          分钟内付款。</text
        >
        <text v-else class="override-note"
          >订单归所选会员，请提醒会员在“我的订单”中于 10
          分钟内付款。最终应付金额以下单结果为准。</text
        >
        <label v-if="reviewNeedsOverride" for="booking-override-reason"
          >代订原因</label
        ><textarea
          v-if="reviewNeedsOverride"
          id="booking-override-reason"
          v-model="overrideReason"
          class="override-input"
          :disabled="submitting"
          :maxlength="300"
          placeholder="例如：补录实际使用，或已协调同场安排"
          aria-label="代订原因，2至300字"
        />
        <text v-if="submissionError" class="submit-error" role="alert">{{
          submissionError
        }}</text>
      </view>
      <template #footer
        ><view class="override-actions"
          ><button
            class="secondary"
            :disabled="submitting"
            @tap="showBookingReview = false"
          >
            返回修改</button
          ><button
            class="primary"
            :loading="submitting"
            :disabled="
              submitting ||
              loading ||
              !selected ||
              (reviewNeedsOverride && overrideReason.trim().length < 2)
            "
            @tap="submit(true)"
          >
            确认代订
          </button></view
        ></template
      >
    </ActionDialog>
    <BookingMemberPicker
      v-if="showMembers && assisted"
      @select="selectMember"
      @close="showMembers = false"
    />
    <ActionDialog
      v-if="assistedOrder"
      title="代订成功"
      :busy="submitting"
      @close="continueAssistedBooking(false)"
    >
        <text class="identity-title"
          >已为 {{ assistedOrder.memberName }} 保留场地</text
        ><view class="success-summary">
          <text>{{ assistedOrder.courtName }} · {{ assistedOrder.slotRange }}</text>
          <text>{{ assistedOrder.date }}</text>
          <text>订单号 {{ assistedOrder.orderNo }}</text>
        </view><text class="success-copy">{{
          assistedOrder.payableCents === 0
            ? "免费场次已确认，无需付款。"
            : "应付 " +
              money(assistedOrder.payableCents) +
              "，请提醒会员在 10 分钟内到“我的订单”付款。现场收款请进入今日营业处理。"
        }}</text>
      <template #footer>
        <button class="primary" :disabled="submitting" @tap="openAssistedOrder">查看现场订单</button
        ><view class="continue-booking-actions">
          <button class="secondary" :disabled="submitting" @tap="continueAssistedBooking(true)">同一会员再订</button>
          <button class="secondary" :disabled="submitting" @tap="continueAssistedBooking(false)">为下一位订场</button>
        </view>
      </template>
    </ActionDialog>
  </view>
</template>

<style scoped src="./booking.css"></style>

<style scoped>
.inline-member-title {
  display: block;
  font-size: 30rpx;
  font-weight: 600;
}
.inline-member-search {
  padding: 24rpx;
}
</style>
