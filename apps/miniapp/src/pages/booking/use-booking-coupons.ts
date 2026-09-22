import { computed, ref, watch } from "vue";
import type { MemberCouponView } from "@yanqing/shared";
import { useSessionStore } from "../../stores/session";
import { endpoints } from "../../services/api";
import {
  captureAuthSession,
  isAuthSessionCurrent,
  useAccessToken,
} from "../../services/auth-session";
import { selectableBookingCoupons } from "../../utils/booking-coupons";

/** Coupon selection belongs to one login session and one refresh request. */
export function useBookingCoupons() {
  const session = useSessionStore();
  const couponCode = ref("");
  const showCoupon = ref(false);
  const coupons = ref<MemberCouponView[]>([]);
  const couponError = ref("");
  const couponLoading = ref(false);
  const couponOptions = computed(() => selectableBookingCoupons(coupons.value));
  const selectedCoupon = computed(() =>
    couponOptions.value.find((item) => item.code === couponCode.value),
  );
  let generation = 0;
  function resetCoupons() {
    generation += 1;
    coupons.value = [];
    couponCode.value = "";
    couponError.value = "";
    couponLoading.value = false;
    showCoupon.value = false;
  }
  watch(useAccessToken(), resetCoupons, { flush: "sync" });
  async function loadCoupons(requestedId = "") {
    const run = ++generation;
    const owner = captureAuthSession();
    const current = () => run === generation && isAuthSessionCurrent(owner);
    coupons.value = [];
    couponError.value = "";
    if (!session.isAuthenticated) {
      resetCoupons();
      return;
    }
    couponLoading.value = true;
    try {
      const result = await endpoints.myCoupons();
      if (!current()) return;
      coupons.value = result;
      if (requestedId)
        couponCode.value =
          couponOptions.value.find((item) => item.id === requestedId)?.code ||
          "";
      if (couponCode.value && !selectedCoupon.value) {
        couponCode.value = "";
        couponError.value = "原优惠券当前不可用，已取消选择。";
      }
      if (requestedId && !couponCode.value)
        couponError.value = "这张券当前不可用，请选择其他券或不使用优惠券。";
    } catch {
      if (!current()) return;
      couponCode.value = "";
      couponError.value = "券包暂未同步，可重试或不使用优惠券继续预约。";
    } finally {
      if (current()) couponLoading.value = false;
    }
  }

  return {
    couponCode,
    showCoupon,
    coupons,
    couponError,
    couponLoading,
    couponOptions,
    selectedCoupon,
    loadCoupons,
  };
}
