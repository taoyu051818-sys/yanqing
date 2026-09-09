import type { Ref, ComputedRef } from "vue";
import {
  endpoints,
  type ReconciliationPeriod,
} from "../../../../../services/api";
import { money } from "../../../../../utils/format";

interface ActionContext {
  canFinanceAction: ComputedRef<boolean>;
  closeBusinessPeriod: () => {
    date: string;
    periodStart: string;
    periodEnd: string;
  };
  reconciliation: Ref<
    {
      id?: string | undefined;
      businessDate: string;
      status: "OPEN" | "REVIEW" | "LOCKED" | string;
      totals: Record<string, number>;
      exceptionCount: number;
      closedById?: string | null | undefined;
      closedAt?: string | null | undefined;
      detail?: Record<string, unknown> | undefined;
      blocked?: boolean | undefined;
      blockers?: { kind: string; count: number; message: string }[] | undefined;
    } | null,
    | ReconciliationPeriod
    | {
        id?: string | undefined;
        businessDate: string;
        status: "OPEN" | "REVIEW" | "LOCKED" | string;
        totals: Record<string, number>;
        exceptionCount: number;
        closedById?: string | null | undefined;
        closedAt?: string | null | undefined;
        detail?: Record<string, unknown> | undefined;
        blocked?: boolean | undefined;
        blockers?:
          { kind: string; count: number; message: string }[] | undefined;
      }
    | null
  >;
  runAction: (
    key: string,
    success: string,
    fallbackError: string,
    operation: () => Promise<unknown>,
  ) => Promise<void>;
}

export function useFinanceReconciliationActions({
  canFinanceAction,
  closeBusinessPeriod,
  reconciliation,
  runAction,
}: ActionContext) {
  async function closeBusinessDay() {
    if (!canFinanceAction.value) return;
    const period = closeBusinessPeriod();
    if (reconciliation.value?.status === "LOCKED") {
      uni.showToast({ title: "该营业日已关账", icon: "none" });
      return;
    }
    const modal = await uni.showModal({
      title: `关账 ${period.date}`,
      content: reconciliation.value?.blocked
        ? `当前有 ${reconciliation.value.exceptionCount} 项待处理异常，关账请求会保留 REVIEW 状态。确认提交复核？`
        : "确认已完成源支付、退款、履约和消课核对，并锁定该营业日？周期结算待办将继续保留。",
      confirmText: "提交关账",
    });
    if (!modal.confirm) return;
    await runAction(
      `reconciliation-close:${period.date}`,
      reconciliation.value?.blocked
        ? `${period.date} 已进入待处理复核`
        : `${period.date} 已关账锁定`,
      "日结关账失败",
      async () => {
        const result = await endpoints.closeReconciliationPeriod(period.date, {
          reason: "财务工作台日结复核",
        });
        reconciliation.value = result;
      },
    );
  }

  function reconciliationStatusLabel(status?: string) {
    return (
      (
        { OPEN: "待关账", REVIEW: "有异常待复核", LOCKED: "已锁定" } as Record<
          string,
          string
        >
      )[status || ""] ||
      status ||
      "未初始化"
    );
  }

  function reconciliationAmount(key: string) {
    return money(reconciliation.value?.totals?.[key] || 0);
  }
  return { closeBusinessDay, reconciliationStatusLabel, reconciliationAmount };
}
