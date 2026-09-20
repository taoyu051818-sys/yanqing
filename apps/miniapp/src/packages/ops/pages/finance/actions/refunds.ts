import { canExecuteDirectly } from '../../../../../utils/admin-execution';
import type { Ref, ComputedRef } from "vue";
import {
  useOperationTask,
  reasonField,
} from "../../../components/operation-task";
import { endpoints } from "../../../../../services/api";
import type { useSessionStore } from "../../../../../stores/session";
import { canDirectRefund, directRefundFeedback } from "../../../../../utils/refund-action";
import { money } from "../../../../../utils/format";

interface ActionContext {
  task: ReturnType<typeof useOperationTask>;
  load: (options?: { preserveMessage?: boolean }) => Promise<void>;
  actionError: Ref<string, string>;
  canFinanceAction: ComputedRef<boolean>;
  session: ReturnType<typeof useSessionStore>;
}

export function useFinanceRefundsActions({
  task,
  load,
  actionError,
  canFinanceAction,
  session,
}: ActionContext) {
  function approveRefund(refund: any) {
    const direct = canDirectRefund(session.roles || []);
    task.start({
      title: direct ? "确认退款" : "批准退款",
      description:
        (refund.order.user?.displayName || refund.order.title || "当前会员") + " · " + refund.order.orderNo +
        " · " +
        money(refund.amountCents) +
        (direct ? "。确认后按原支付方式退款，无需再次审核。" : "。确认后按原支付路径处理；申请批准不等于已到账。"),
      confirmText: direct ? "确认退款" : "确认批准退款",
      successFeedback: direct ? "toast" : "dialog",
      fields: direct ? [] : [reasonField("复核依据")],
      submit: async ({ reason }) => {
        const result = await endpoints.approveRefund(refund.id, { reason: direct ? `管理员确认退款：${refund.reason || "按原申请退款"}`.slice(0, 300) : reason });
        await load();
        if (direct) return directRefundFeedback(result.status);
        return result.status === "SUCCEEDED"
          ? "退款已完成，请核对退款记录。"
          : "退款已批准，等待支付方同步；请以最终退款状态为准。";
      },
    });
  }

  function rejectRefund(refund: any) {
    task.start({
      title: "驳回退款",
      description:
        (refund.order.user?.displayName || refund.order.title || "当前会员") + " · " + refund.order.orderNo +
        " · " +
        money(refund.amountCents) +
        "。驳回原因将保留在退款记录，资金不会退回。",
      confirmText: "确认驳回退款",
      fields: [reasonField("复核依据")],
      submit: async ({ reason }) => {
        await endpoints.rejectRefund(refund.id, { reason });
        await load();
        return "退款已驳回，原因已记录。";
      },
    });
  }

  function reviewAdjustment(request: any, approved: boolean) {
    if (isOwnAdjustment(request)) {
      actionError.value = "不能复核自己的账户调整申请";
      return;
    }
    task.start({
      title: approved ? "批准账户调整" : "驳回账户调整",
      description:
        (request.account?.user?.displayName || "当前会员") +
        " · " +
        accountDelta(request) +
        (approved
          ? "。入账后只可提交反向调整，不能覆盖历史。"
          : "。本次不改动余额。"),
      confirmText: approved ? "确认复核入账" : "确认驳回",
      fields: [reasonField("核对凭证与依据")],
      submit: async ({ reason }) => {
        if (approved)
          await endpoints.approveAccountAdjustment(request.id, reason);
        else await endpoints.rejectAccountAdjustment(request.id, reason);
        await load();
        return approved
          ? "账户调整已复核入账，余额及审计已同步。"
          : "账户调整申请已驳回，余额不变。";
      },
    });
  }

  function reviewShiftVariance(shift: any) {
    if (!canFinanceAction.value || shift.varianceReviewedAt) return;
    if (!canExecuteDirectly(session.roles || []) && [shift.operatorId, shift.closedById].includes(session.user?.id)) {
      actionError.value = "班次操作人和关班人不能复核自己的差异";
      return;
    }
    task.start({
      title: "复核现金差异",
      description:
        (shift.operator?.displayName || "前台") +
        " · 账面 " +
        money(shift.expectedCashCents) +
        " · 实点 " +
        money(shift.closingCashCents) +
        " · 差异 " +
        money(shift.cashVarianceCents),
      confirmText: "确认处理差异",
      successFeedback: canExecuteDirectly(session.roles || []) ? "toast" : "dialog",
      fields: [reasonField("盘点凭证、原因及处理结论")],
      submit: async ({ reason }) => {
        await endpoints.reviewFrontDeskShiftVariance(shift.id, { reason });
        await load();
        return "现金差异已处理，依据已记录。";
      },
    });
  }

  function accountDelta(request: any) {
    const amount = Number(request.amount || 0);
    const type = request.account?.type || "";
    if (["CASH_PRINCIPAL", "GIFT_BALANCE"].includes(type)) return money(amount);
    return `${amount > 0 ? "+" : ""}${amount} ${type || "单位"}`;
  }

  function isOwnAdjustment(request: any) {
    return request.isOwnRequest === true && !canExecuteDirectly(session.roles || []);
  }

  function refundStatusNote(status?: string) {
    const labels: Record<string, string> = {
      REQUESTED: "等待财务复核",
      REFUND_PENDING: "等待财务复核",
      APPROVED: "已批准，等待退款通道处理",
      PROCESSING: "退款通道处理中",
      FAILED: "退款失败，需人工核对",
      SUCCEEDED: "退款成功，请以支付渠道到账记录为准",
      REJECTED: "申请已驳回，资金未退回",
    };
    return labels[status || ""] || status || "状态待同步";
  }
  return {
    approveRefund,
    rejectRefund,
    reviewAdjustment,
    reviewShiftVariance,
    accountDelta,
    isOwnAdjustment,
    refundStatusNote,
  };
}
