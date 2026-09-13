import type { Ref, ComputedRef } from "vue";
import { nextTick } from "vue";
import { hasOperationsAccess } from "../../../../../config/operations";
import {
  endpoints,
  type ReconciliationPeriod,
} from "../../../../../services/api";
import type { useSessionStore } from "../../../../../stores/session";
import {
  findOpsDeepLinkRecord,
  opsDeepLinkDomId,
  type OpsDeepLinkQuery,
} from "../../../../../utils/work-item-deep-link";
import type { LoadSource } from "../page-types.js";

interface ActionContext {
  loading: Ref<boolean, boolean>;
  actionError: Ref<string, string>;
  loadErrors: Ref<
    {
      dashboard: string;
      refunds: string;
      training: string;
      trainingSettlements: string;
      merchants: string;
      settlements: string;
      consignmentSuppliers: string;
      consignmentPayables: string;
      consignmentSettlements: string;
      reconciliation: string;
      adjustments: string;
      shifts: string;
    },
    | Record<LoadSource, string>
    | {
        dashboard: string;
        refunds: string;
        training: string;
        trainingSettlements: string;
        merchants: string;
        settlements: string;
        consignmentSuppliers: string;
        consignmentPayables: string;
        consignmentSettlements: string;
        reconciliation: string;
        adjustments: string;
        shifts: string;
      }
  >;
  emptyLoadErrors: () => Record<LoadSource, string>;
  successMessage: Ref<string, string>;
  session: ReturnType<typeof useSessionStore>;
  businessPeriod: () => {
    date: string;
    periodStart: string;
    periodEnd: string;
  };
  closeBusinessPeriod: () => {
    date: string;
    periodStart: string;
    periodEnd: string;
  };
  canFinanceAction: ComputedRef<boolean>;
  trainingSettlementStatusOptions: { value: string; label: string }[];
  trainingSettlementStatusIndex: Ref<number, number>;
  dashboard: Ref<Record<string, any> | null, Record<string, any> | null>;
  orders: Ref<any[], any[]>;
  loadRefundOrders: () => Promise<void>;
  training: Ref<Record<string, any> | null, Record<string, any> | null>;
  merchants: Ref<any[], any[]>;
  settlements: Ref<any[], any[]>;
  consignmentSuppliers: Ref<any[], any[]>;
  consignmentPayables: Ref<any[], any[]>;
  consignmentSettlements: Ref<any[], any[]>;
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
  adjustments: Ref<any[], any[]>;
  trainingSettlements: Ref<any[], any[]>;
  shifts: Ref<any[], any[]>;
  lastSyncedAt: Ref<string, string>;
  actionErrorMessage: (reason: unknown, fallback: string) => string;
  deepLinkHandled: Ref<boolean, boolean>;
  deepLinkQuery: Ref<
    {
      focus?: string | undefined;
      id?: string | undefined;
      orderId?: string | undefined;
      eventId?: string | undefined;
      gameId?: string | undefined;
      sessionId?: string | undefined;
      attendanceId?: string | undefined;
      userId?: string | undefined;
      round?: string | undefined;
    },
    | OpsDeepLinkQuery
    | {
        focus?: string | undefined;
        id?: string | undefined;
        orderId?: string | undefined;
        eventId?: string | undefined;
        gameId?: string | undefined;
        sessionId?: string | undefined;
        attendanceId?: string | undefined;
        userId?: string | undefined;
        round?: string | undefined;
      }
  >;
  activeRefunds: ComputedRef<any[]>;
  unreviewedShiftVariances: ComputedRef<any[]>;
  focusedRecord: Ref<string, string>;
}

export function useFinanceLoadingActions({
  loading,
  actionError,
  loadErrors,
  emptyLoadErrors,
  successMessage,
  session,
  businessPeriod,
  closeBusinessPeriod,
  canFinanceAction,
  trainingSettlementStatusOptions,
  trainingSettlementStatusIndex,
  dashboard,
  orders,
  loadRefundOrders,
  training,
  merchants,
  settlements,
  consignmentSuppliers,
  consignmentPayables,
  consignmentSettlements,
  reconciliation,
  adjustments,
  trainingSettlements,
  shifts,
  lastSyncedAt,
  actionErrorMessage,
  deepLinkHandled,
  deepLinkQuery,
  activeRefunds,
  unreviewedShiftVariances,
  focusedRecord,
}: ActionContext) {
  function sourceError(source: LoadSource, reason: unknown) {
    const fallback: Record<LoadSource, string> = {
      dashboard: "经营指标同步失败",
      refunds: "退款队列同步失败",
      training: "培训财务数据同步失败",
      trainingSettlements: "培训结算单同步失败",
      merchants: "联盟商户同步失败",
      settlements: "联盟结算单同步失败",
      consignmentSuppliers: "寄售供应商同步失败",
      consignmentPayables: "寄售应付明细同步失败",
      consignmentSettlements: "寄售结算单同步失败",
      reconciliation: "日结关账状态同步失败",
      adjustments: "账户调整队列同步失败",
      shifts: "前台班次差异同步失败",
    };
    return reason instanceof Error && reason.message
      ? reason.message
      : fallback[source];
  }

  async function load(options: { preserveMessage?: boolean } = {}) {
    if (loading.value) return;
    loading.value = true;
    actionError.value = "";
    loadErrors.value = emptyLoadErrors();
    if (!options.preserveMessage) successMessage.value = "";

    try {
      await session.hydrate();
      if (!hasOperationsAccess(session.roles, "finance")) return;
      const period = businessPeriod();
      const closePeriod = closeBusinessPeriod();
      const result = await Promise.allSettled([
        endpoints.dashboard(),
        loadRefundOrders(),
        endpoints.trainingFinancials(period.periodStart, period.periodEnd),
        endpoints.merchants(),
        endpoints.allianceSettlements(),
        canFinanceAction.value
          ? endpoints.consignmentSupplierOptions()
          : Promise.resolve([]),
        canFinanceAction.value
          ? endpoints.consignmentPayables({ pageSize: 50 })
          : Promise.resolve({ items: [] }),
        canFinanceAction.value
          ? endpoints.consignmentSettlements({ pageSize: 50 })
          : Promise.resolve({ items: [] }),
        endpoints.reconciliationPeriod(closePeriod.date),
        canFinanceAction.value
          ? endpoints.accountAdjustments()
          : Promise.resolve([]),
        canFinanceAction.value
          ? endpoints.trainingSettlements({
              ...(trainingSettlementStatusOptions[
                trainingSettlementStatusIndex.value
              ].value
                ? {
                    status:
                      trainingSettlementStatusOptions[
                        trainingSettlementStatusIndex.value
                      ].value,
                  }
                : {}),
            })
          : Promise.resolve([]),
        canFinanceAction.value
          ? endpoints.frontDeskShiftHistory({ status: "CLOSED", limit: 50 })
          : Promise.resolve([]),
      ]);

      if (result[0].status === "fulfilled") dashboard.value = result[0].value;
      else
        loadErrors.value.dashboard = sourceError("dashboard", result[0].reason);

      if (result[1].status === "rejected") loadErrors.value.refunds = sourceError("refunds", result[1].reason);

      if (result[2].status === "fulfilled") training.value = result[2].value;
      else
        loadErrors.value.training = sourceError("training", result[2].reason);

      if (result[3].status === "fulfilled")
        merchants.value = result[3].value || [];
      else
        loadErrors.value.merchants = sourceError("merchants", result[3].reason);

      if (result[4].status === "fulfilled")
        settlements.value = result[4].value || [];
      else
        loadErrors.value.settlements = sourceError(
          "settlements",
          result[4].reason,
        );

      if (result[5].status === "fulfilled")
        consignmentSuppliers.value = result[5].value || [];
      else
        loadErrors.value.consignmentSuppliers = sourceError(
          "consignmentSuppliers",
          result[5].reason,
        );

      if (result[6].status === "fulfilled")
        consignmentPayables.value = result[6].value?.items || [];
      else
        loadErrors.value.consignmentPayables = sourceError(
          "consignmentPayables",
          result[6].reason,
        );

      if (result[7].status === "fulfilled")
        consignmentSettlements.value = result[7].value?.items || [];
      else
        loadErrors.value.consignmentSettlements = sourceError(
          "consignmentSettlements",
          result[7].reason,
        );

      if (result[8].status === "fulfilled")
        reconciliation.value = result[8].value;
      else
        loadErrors.value.reconciliation = sourceError(
          "reconciliation",
          result[8].reason,
        );

      if (result[9].status === "fulfilled")
        adjustments.value = result[9].value || [];
      else
        loadErrors.value.adjustments = sourceError(
          "adjustments",
          result[9].reason,
        );

      if (result[10].status === "fulfilled")
        trainingSettlements.value = result[10].value || [];
      else
        loadErrors.value.trainingSettlements = sourceError(
          "trainingSettlements",
          result[10].reason,
        );

      if (result[11].status === "fulfilled")
        shifts.value = result[11].value || [];
      else loadErrors.value.shifts = sourceError("shifts", result[11].reason);

      lastSyncedAt.value = new Date().toLocaleTimeString("zh-CN", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      });
    } catch (reason) {
      actionError.value = actionErrorMessage(
        reason,
        "财务工作台同步失败，请稍后重试",
      );
    } finally {
      loading.value = false;
    }
    await applyFinanceDeepLink();
  }

  async function applyFinanceDeepLink() {
    if (deepLinkHandled.value || !deepLinkQuery.value.focus) return;
    const focus = deepLinkQuery.value.focus;
    let record: any = null;
    let prefix = "";
    let label = "财务记录";
    if (focus === "refund") {
      record = findOpsDeepLinkRecord(
        activeRefunds.value.map((refund) => ({
          ...refund,
          orderId: refund.orderId || refund.order?.id,
        })),
        deepLinkQuery.value,
        ["id", "orderId"],
      );
      if (!record && deepLinkQuery.value.orderId) {
        try {
          const order = await endpoints.order(deepLinkQuery.value.orderId);
          orders.value = [order, ...orders.value.filter(item => item.id !== order.id)];
          record = findOpsDeepLinkRecord(activeRefunds.value, deepLinkQuery.value, ["id"]);
        } catch { uni.showToast({ title: "待办退款未同步，请重试", icon: "none" }); return; }
      }
      prefix = "finance-refund";
      label = "退款申请";
    } else if (focus === "account-adjustment") {
      record = findOpsDeepLinkRecord(adjustments.value, deepLinkQuery.value, [
        "id",
      ]);
      prefix = "finance-adjustment";
      label = "账户调整申请";
    } else if (focus === "training-settlement") {
      record = findOpsDeepLinkRecord(
        trainingSettlements.value,
        deepLinkQuery.value,
        ["id"],
      );
      prefix = "finance-training-settlement";
      label = "培训结算单";
    } else if (focus === "consignment-settlement") {
      record = findOpsDeepLinkRecord(
        consignmentSettlements.value,
        deepLinkQuery.value,
        ["id"],
      );
      prefix = "finance-consignment-settlement";
      label = "寄售结算单";
    } else if (focus === "alliance-settlement") {
      record = findOpsDeepLinkRecord(settlements.value, deepLinkQuery.value, [
        "id",
      ]);
      prefix = "finance-alliance-settlement";
      label = "联盟结算单";
    } else if (focus === "shift-variance") {
      record = findOpsDeepLinkRecord(
        unreviewedShiftVariances.value,
        deepLinkQuery.value,
        ["id"],
      );
      prefix = "finance-shift";
      label = "班次差异";
    } else if (focus === "reconciliation") {
      deepLinkHandled.value = true;
      if (!reconciliation.value) {
        uni.showToast({
          title: "未找到待办对应的日结账期，可能尚未同步",
          icon: "none",
        });
        return;
      }
      focusedRecord.value = "finance-reconciliation";
      await nextTick();
      uni.pageScrollTo({ selector: "#finance-reconciliation", duration: 250 });
      return;
    } else {
      deepLinkHandled.value = true;
      uni.showToast({ title: `无法识别财务待办类型：${focus}`, icon: "none" });
      return;
    }
    deepLinkHandled.value = true;
    if (!record) {
      uni.showToast({
        title: `未找到待办对应的${label}，可能已处理或无权查看`,
        icon: "none",
      });
      return;
    }
    focusedRecord.value = `${prefix}:${record.id}`;
    await nextTick();
    uni.pageScrollTo({
      selector: `#${opsDeepLinkDomId(prefix, record.id)}`,
      duration: 250,
    });
  }
  return { sourceError, load, applyFinanceDeepLink };
}
