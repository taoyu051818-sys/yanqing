import type { Ref, ComputedRef } from "vue";
import {
  useOperationTask,
  reasonField,
} from "../../../components/operation-task";
import { endpoints } from "../../../../../services/api";
import { money, shortDate } from "../../../../../utils/format";
import { withPendingCreationKey } from "../../../../../utils/pending-creation-key";
import type { ConsignmentSettlementUiAction } from "../page-types.js";

interface ActionContext {
  consignmentPeriodStartDate: Ref<string, string>;
  consignmentPeriodEndDate: Ref<string, string>;
  actionError: Ref<string, string>;
  task: ReturnType<typeof useOperationTask>;
  load: (options?: { preserveMessage?: boolean }) => Promise<void>;
  consignmentSuppliers: Ref<any[], any[]>;
}

export function useFinanceConsignmentActions({
  consignmentPeriodStartDate,
  consignmentPeriodEndDate,
  actionError,
  task,
  load,
  consignmentSuppliers,
}: ActionContext) {
  function onConsignmentPeriodStartChange(event: any) {
    consignmentPeriodStartDate.value = String(
      event?.detail?.value || consignmentPeriodStartDate.value,
    );
  }

  function onConsignmentPeriodEndChange(event: any) {
    consignmentPeriodEndDate.value = String(
      event?.detail?.value || consignmentPeriodEndDate.value,
    );
  }

  function createConsignmentSettlementDraft(supplier: any) {
    const start = consignmentPeriodStartDate.value,
      end = consignmentPeriodEndDate.value;
    if (end <= start) {
      actionError.value = "结束日期必须晚于开始日期";
      return;
    }
    task.start({
      title: "生成寄售结算草稿",
      description:
        supplier.name +
        " · " +
        start +
        " 至 " +
        end +
        "（结束日不含）。只汇总未被其他有效账单占用的销售应付与退款冲正。",
      confirmText: "确认生成草稿",
      fields: [reasonField("制单依据")],
      submit: async ({ reason }) => {
        const command = {
          supplierId: supplier.id,
          periodStart: new Date(start + "T00:00:00+08:00").toISOString(),
          periodEnd: new Date(end + "T00:00:00+08:00").toISOString(),
          reason,
        };
        await withPendingCreationKey(
          "consignment.settlement.create." + supplier.id,
          command,
          (idempotencyKey) =>
            endpoints.createConsignmentSettlement({
              ...command,
              idempotencyKey,
            }),
        );
        await load();
        return "寄售结算草稿已生成，下一步提交复核。";
      },
    });
  }

  function changeConsignmentSettlement(
    settlement: any,
    action: ConsignmentSettlementUiAction,
  ) {
    if (
      ["confirm", "dispute", "return", "settle"].includes(action) &&
      settlement.isOwnCreator === true
    ) {
      actionError.value = "制单人不能复核自己的寄售账单";
      return;
    }
    const labels = {
      submit: "提交复核",
      confirm: "复核确认",
      dispute: "提出争议",
      return: "退回草稿",
      settle: "记录付款",
      void: "作废草稿",
    };
    task.start({
      title: "寄售结算 · " + labels[action],
      description:
        consignmentSupplierName(settlement) +
        " · 应付 " +
        money(settlement.payableCents) +
        " · " +
        consignmentSettlementPeriod(settlement) +
        "。操作写入不可覆盖的历史。",
      confirmText: "确认" + labels[action],
      fields: [
        reasonField("核对依据"),
        ...(action === "settle"
          ? [
              {
                key: "paymentReference",
                label: "银行流水号或付款凭证",
                min: 2,
                max: 200,
              },
            ]
          : []),
      ],
      submit: async ({ reason, paymentReference }) => {
        const command = {
          action,
          fromStatus: settlement.status,
          reason,
          ...(paymentReference ? { paymentReference } : {}),
        };
        const handlers = {
          submit: endpoints.submitConsignmentSettlement,
          confirm: endpoints.confirmConsignmentSettlement,
          dispute: endpoints.disputeConsignmentSettlement,
          return: endpoints.returnConsignmentSettlement,
          settle: endpoints.settleConsignmentSettlement,
          void: endpoints.voidConsignmentSettlement,
        };
        await withPendingCreationKey(
          "consignment.settlement." + settlement.id + "." + action,
          command,
          (idempotencyKey) =>
            handlers[action](settlement.id, {
              reason,
              idempotencyKey,
              ...(paymentReference ? { paymentReference } : {}),
            }),
        );
        await load();
        return "寄售结算已" + labels[action] + "，审计已记录。";
      },
    });
  }

  function consignmentSupplierName(settlement: any) {
    return (
      settlement.supplier?.name ||
      consignmentSuppliers.value.find(
        (supplier) => supplier.id === settlement.supplierId,
      )?.name ||
      "寄售供应商"
    );
  }

  function consignmentSupplierRule(supplier: any) {
    const cycle =
      (
        {
          DAILY: "日结",
          WEEKLY: "周结",
          MONTHLY: "月结",
        } as Record<string, string>
      )[supplier?.settlementCycle] ||
      supplier?.settlementCycle ||
      "周期待配置";
    return `${cycle} · 球馆佣金 ${Number(supplier?.commissionRateBps || 0) / 100}%`;
  }

  function consignmentSettlementPeriod(settlement: any) {
    if (!settlement.periodStart || !settlement.periodEnd) return "账期待补充";
    return `${new Date(settlement.periodStart).toLocaleDateString("zh-CN")} — ${new Date(settlement.periodEnd).toLocaleDateString("zh-CN")}（结束日不含）`;
  }

  function consignmentSettlementStatusLabel(status?: string) {
    return (
      (
        {
          DRAFT: "草稿",
          PENDING_CONFIRMATION: "待复核确认",
          CONFIRMED: "已确认 / 待付款",
          SETTLED: "已付款结算",
          VOID: "已作废",
        } as Record<string, string>
      )[status || ""] ||
      status ||
      "未知状态"
    );
  }

  function consignmentLatestTransition(settlement: any) {
    const history = Array.isArray(settlement.transitions)
      ? settlement.transitions
      : [];
    const latest = history[history.length - 1];
    if (!latest) return "";
    return [
      latest.actor?.displayName,
      latest.reason ? `原因：${latest.reason}` : "",
      latest.createdAt ? shortDate(latest.createdAt) : "",
    ]
      .filter(Boolean)
      .join(" · ");
  }

  function payableAssignment(entry: any) {
    const line = (entry.settlementLines || []).find(
      (item: any) => !item.releasedAt,
    );
    if (!line) return "未制单";
    return `${line.settlement?.statementNo || "结算单"} · ${consignmentSettlementStatusLabel(line.settlement?.status)}`;
  }
  return {
    onConsignmentPeriodStartChange,
    onConsignmentPeriodEndChange,
    createConsignmentSettlementDraft,
    changeConsignmentSettlement,
    consignmentSupplierName,
    consignmentSupplierRule,
    consignmentSettlementPeriod,
    consignmentSettlementStatusLabel,
    consignmentLatestTransition,
    payableAssignment,
  };
}
