import { ref } from "vue";
import type { OrderView } from "@yanqing/shared";
import { endpoints } from "../../services/api";
import { canCancelFreeVenue } from "../../utils/payment-confirmation";
import { withPendingCreationKey } from "../../utils/pending-creation-key";
import { idempotencyKey } from "../../utils/format";
import type { OrderActionScope } from "./order-action-scope";
import { refundableAmount, canRequestOrderRefund } from "./order-presentation";
import { orderFailure } from "./order-errors";

export function useOrderAftersales(
  scope: OrderActionScope,
  load: () => Promise<unknown>,
  isConfirming: (id: string) => boolean,
) {
  const { actionKey } = scope;
  const refundingId = ref("");
  const refundError = ref("");
  async function cancelPending(order: OrderView) {
    if (actionKey.value || isConfirming(order.id)) return;
    const current = scope.capture();
    if (!current()) return;
    const free = canCancelFreeVenue(order);
    if (order.status !== "PENDING" && !free) return;
    const result = await uni.showModal({
      title: free ? "取消免费预约" : "取消待支付订单",
      content: free
        ? "取消后立即释放场地，不产生退款。使用的优惠券将退回，已过期的券无法继续使用。"
        : order.businessType === "GAME"
          ? `取消“${order.title}”后将释放你的报名名额，有候补时按顺序晋级。不会取消整场球局。`
          : order.businessType === "VENUE"
            ? `取消“${order.title}”后将立即释放场地。`
            : order.businessType === "TRAINING"
              ? "取消后释放班级预留名额，不产生消课或退款。"
              : `取消“${order.title}”不扣款，不会发放会员权益、充值余额或扣减库存。`,
      confirmText: "确认取消",
      confirmColor: "#a52626",
    });
    if (!result.confirm || actionKey.value || !current()) return;
    const action = scope.begin(`cancel:${order.id}`);
    if (!action) return;
    try {
      await endpoints.cancelPendingOrder(order.id, {
        reason: free ? "会员主动取消免费场地预约" : "会员主动取消待支付订单",
        idempotencyKey: idempotencyKey(`cancel-${order.id}`),
      });
      if (!action.isCurrent()) return;
      uni.showToast({
        title: free ? "免费预约已取消" : "待付款订单已取消",
        icon: "success",
      });
      await load();
    } catch (cause: unknown) {
      if (!action.isCurrent()) return;
      const failure = orderFailure(cause);
      uni.showToast({ title: failure.message || "取消订单失败", icon: "none" });
    } finally {
      action.finish();
    }
  }
  async function refund(order: OrderView, reason: string) {
    if (actionKey.value || !canRequestOrderRefund(order)) return;
    const action = scope.begin("refund:" + order.id);
    if (!action) return;
    refundError.value = "";
    try {
      const command = {
        orderId: order.id,
        amountCents: refundableAmount(order),
        reason,
      };
      await withPendingCreationKey("order.refund", command, (idempotencyKey) =>
        endpoints.refundOrder(order.id, {
          amountCents: command.amountCents,
          reason,
          idempotencyKey,
        }),
      );
      if (!action.isCurrent()) return;
      refundingId.value = "";
      uni.showToast({ title: "申请已提交", icon: "success" });
      await load();
    } catch (cause: unknown) {
      if (!action.isCurrent()) return;
      const failure = orderFailure(cause);
      refundError.value = failure.message || "申请失败，请重试";
    } finally {
      action.finish();
    }
  }

  function reset() {
    refundingId.value = "";
    refundError.value = "";
  }
  return { refundingId, refundError, cancelPending, refund, reset };
}
