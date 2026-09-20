import { hasMockRole } from "../../policies/common";
import { getOrders } from "../../venue";
import { handleApproveRefundPost } from "./refund-approval";
export async function executeMockActivityRefunds(
  orderIds: Set<string>,
  reason: string,
) {
  if (!hasMockRole("ADMIN", "SUPER_ADMIN")) return;
  const refunds = getOrders()
    .filter((order) => orderIds.has(order.id))
    .flatMap((order) =>
      (order.refunds || []).filter(
        (refund: any) =>
          refund.status === "REQUESTED" && refund.cancellationRequired,
      ),
    );
  let failed = 0;
  for (const refund of refunds) {
    try {
      await handleApproveRefundPost(
        "POST",
        `/orders/refunds/${refund.id}/approve`,
        { reason: `管理员取消活动：${reason}` },
        {},
      );
    } catch {
      failed++;
    }
  }
  if (failed) throw new Error(`活动已取消，${failed}笔退款尚未提交`);
}
