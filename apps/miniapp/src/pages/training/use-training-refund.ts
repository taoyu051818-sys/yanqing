import { ref } from "vue";
import type { TrainingEnrollmentView, OrderView } from "@yanqing/shared";
import { useSessionStore } from "../../stores/session";
import { endpoints } from "../../services/api";
import {
  captureAuthSession,
  isAuthSessionCurrent,
} from "../../services/auth-session";
import { openMemberPage } from "../../utils/member-navigation";
import { withPendingCreationKey } from "../../utils/pending-creation-key";
import {
  parseYuanToCents,
  pendingTrainingRefundCents,
  trainingRefundLimitCents,
} from "../../utils/training-refund";

/** Owns refund quotation and application; amounts still come from the order API. */
export function useTrainingRefund({
  login,
  reload,
}: {
  login: () => unknown;
  reload: () => Promise<void>;
}) {
  const session = useSessionStore();
  const refundingId = ref("");
  const refundItemId = ref("");
  const refundMaximum = ref(0);
  const refundOrder = ref<OrderView | null>(null);
  const refundError = ref("");
  const customRefund = ref(false);
  const refundAmount = ref("");
  async function prepareRefund(item: TrainingEnrollmentView) {
    if (!session.isAuthenticated) return login();
    const orderId = item.orderId;
    if (!orderId) return;
    if (refundingId.value) return;
    refundItemId.value = item.id;
    refundingId.value = item.id;
    refundError.value = "";
    refundOrder.value = null;
    customRefund.value = false;
    refundMaximum.value = 0;
    const owner = captureAuthSession();
    try {
      const order = await endpoints.order(orderId);
      if (!isAuthSessionCurrent(owner)) return;
      if (
        pendingTrainingRefundCents(order) > 0 ||
        order.status === "REFUND_PENDING"
      ) {
        refundError.value =
          "已有退费申请处理中，请在订单查看进度，处理结束后再申请。";
        return;
      }
      refundMaximum.value = trainingRefundLimitCents(item, order);
      if (refundMaximum.value <= 0) {
        refundError.value =
          "当前没有可退的未使用课时余额；如消课记录有误，请联系教练或前台。";
        return;
      }
      refundAmount.value = (refundMaximum.value / 100).toFixed(2);
      refundOrder.value = order;
    } catch (cause: any) {
      if (!isAuthSessionCurrent(owner)) return;
      refundError.value = cause.message || "可退金额未同步，请重试";
    } finally {
      refundingId.value = "";
    }
  }
  async function requestTrainingRefund(
    item: TrainingEnrollmentView,
    reason: string,
  ) {
    if (!session.isAuthenticated) return login();
    const orderId = item.orderId;
    if (!orderId) return;
    if (
      !refundOrder.value ||
      refundingId.value ||
      refundItemId.value !== item.id
    )
      return;
    const amountCents = customRefund.value
      ? parseYuanToCents(refundAmount.value)
      : refundMaximum.value;
    if (
      amountCents === null ||
      amountCents <= 0 ||
      amountCents > refundMaximum.value
    ) {
      refundError.value =
        "请输入 0.01 至 " + (refundMaximum.value / 100).toFixed(2) + " 元";
      return;
    }
    refundingId.value = item.id;
    refundError.value = "";
    const owner = captureAuthSession();
    try {
      const command = { orderId: item.orderId, amountCents, reason };
      await withPendingCreationKey(
        "training.refund",
        command,
        (idempotencyKey) =>
          endpoints.refundOrder(orderId, {
            amountCents,
            reason,
            idempotencyKey,
          }),
      );
      if (!isAuthSessionCurrent(owner)) return;
      refundItemId.value = "";
      uni.showToast({ title: "退费申请已提交", icon: "success" });
      await reload();
      if (!isAuthSessionCurrent(owner)) return;
      await openMemberPage(
        "/pages/order/index?id=" + encodeURIComponent(orderId),
      );
    } catch (cause: any) {
      if (!isAuthSessionCurrent(owner)) return;
      refundError.value = cause.message || "退费申请失败，请重试";
    } finally {
      refundingId.value = "";
    }
  }
  function resetRefund() {
    refundItemId.value = "";
    refundOrder.value = null;
    refundError.value = "";
    refundMaximum.value = 0;
    refundAmount.value = "";
    customRefund.value = false;
  }

  return {
    refundingId,
    refundItemId,
    refundMaximum,
    refundOrder,
    refundError,
    customRefund,
    refundAmount,
    prepareRefund,
    requestTrainingRefund,
    resetRefund,
  };
}
