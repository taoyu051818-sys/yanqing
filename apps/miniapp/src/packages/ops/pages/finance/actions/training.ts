import type { Ref, ComputedRef } from "vue";
import {
  useOperationTask,
  reasonField,
} from "../../../components/operation-task";
import { endpoints } from "../../../../../services/api";
import { money, shortDate } from "../../../../../utils/format";
import { withPendingCreationKey } from "../../../../../utils/pending-creation-key";

interface ActionContext {
  trainingSettlementStatusIndex: Ref<number, number>;
  refresh: () => void;
  trainingPeriodStartDate: Ref<string, string>;
  trainingPeriodEndDate: Ref<string, string>;
  actionError: Ref<string, string>;
  task: ReturnType<typeof useOperationTask>;
  load: (options?: { preserveMessage?: boolean }) => Promise<void>;
}

export function useFinanceTrainingActions({
  trainingSettlementStatusIndex,
  refresh,
  trainingPeriodStartDate,
  trainingPeriodEndDate,
  actionError,
  task,
  load,
}: ActionContext) {
  function onTrainingSettlementStatusChange(event: any) {
    const next = Number(event?.detail?.value || 0);
    trainingSettlementStatusIndex.value = Number.isInteger(next) ? next : 0;
    refresh();
  }

  function onTrainingPeriodStartChange(event: any) {
    trainingPeriodStartDate.value = String(
      event?.detail?.value || trainingPeriodStartDate.value,
    );
  }

  function onTrainingPeriodEndChange(event: any) {
    trainingPeriodEndDate.value = String(
      event?.detail?.value || trainingPeriodEndDate.value,
    );
  }

  function createTrainingSettlementDraft() {
    const start = trainingPeriodStartDate.value,
      end = trainingPeriodEndDate.value;
    if (end <= start) {
      actionError.value = "结束日期必须晚于开始日期";
      return;
    }
    task.start({
      title: "生成培训结算草稿",
      description:
        start +
        " 至 " +
        end +
        "（结束日不含）。核对本账期成本，草稿生成后仍须独立复核。",
      confirmText: "确认生成草稿",
      fields: [
        {
          key: "acquisition",
          label: "获客成本（元）",
          kind: "money",
          initial: "0",
        },
        {
          key: "marketing",
          label: "营销成本（元）",
          kind: "money",
          initial: "0",
        },
      ],
      submit: async (values) => {
        await endpoints.createTrainingSettlement({
          periodStart: new Date(start + "T00:00:00+08:00").toISOString(),
          periodEnd: new Date(end + "T00:00:00+08:00").toISOString(),
          acquisitionCostCents: Math.round(Number(values.acquisition) * 100),
          marketingCostCents: Math.round(Number(values.marketing) * 100),
        });
        await load();
        return "培训结算草稿已生成，下一步提交独立复核。";
      },
    });
  }

  function trainingSettlementPeriod(settlement: any) {
    if (!settlement.periodStart || !settlement.periodEnd) return "账期待补充";
    return `${new Date(settlement.periodStart).toLocaleDateString("zh-CN")} — ${new Date(settlement.periodEnd).toLocaleDateString("zh-CN")}（结束日不含）`;
  }

  function trainingSettlementStatusLabel(status?: string) {
    return (
      (
        {
          DRAFT: "草稿",
          PENDING_CONFIRMATION: "待复核",
          CONFIRMED: "已确认 / 待入账",
          SETTLED: "已结算",
          VOID: "已作废",
        } as Record<string, string>
      )[status || ""] ||
      status ||
      "未知状态"
    );
  }

  function isOwnTrainingSettlement(settlement: any) {
    return settlement.isOwnCreator === true;
  }

  function trainingSettlementLatestNote(settlement: any) {
    const history = Array.isArray(settlement.workflowHistory)
      ? settlement.workflowHistory
      : [];
    const latest = history[history.length - 1];
    if (!latest) return "";
    return [
      latest.actor,
      latest.reason ? `原因：${latest.reason}` : "",
      latest.at ? shortDate(latest.at) : "",
    ]
      .filter(Boolean)
      .join(" · ");
  }

  function changeTrainingSettlement(
    settlement: any,
    action: "submit" | "confirm" | "settle" | "return" | "void",
  ) {
    if (
      ["confirm", "settle", "return"].includes(action) &&
      isOwnTrainingSettlement(settlement)
    ) {
      actionError.value = "制单人不能复核自己的结算单";
      return;
    }
    const labels = {
      submit: "提交复核",
      confirm: "复核确认",
      settle: "结算入账",
      return: "退回草稿",
      void: "作废草稿",
    };
    task.start({
      title: "培训结算 · " + labels[action],
      description:
        trainingSettlementPeriod(settlement) +
        " · 场馆合同分成 " +
        money(settlement.venueContributionCents) +
        "。状态变更和操作人写入审计，不覆盖历史。",
      confirmText: "确认" + labels[action],
      fields: [
        reasonField(
          action === "settle" ? "付款/收款凭证与入账依据" : "核对依据",
        ),
      ],
      submit: async ({ reason }) => {
        const handlers = {
          submit: endpoints.submitTrainingSettlement,
          confirm: endpoints.confirmTrainingSettlement,
          settle: endpoints.settleTrainingSettlement,
          return: endpoints.returnTrainingSettlement,
          void: endpoints.voidTrainingSettlement,
        };
        await withPendingCreationKey(
          "training.settlement." + settlement.id + "." + action,
          { action, reason, fromStatus: settlement.status },
          (idempotencyKey) =>
            handlers[action](settlement.id, { reason, idempotencyKey }),
        );
        await load();
        return "培训结算已" + labels[action] + "。";
      },
    });
  }
  return {
    onTrainingSettlementStatusChange,
    onTrainingPeriodStartChange,
    onTrainingPeriodEndChange,
    createTrainingSettlementDraft,
    trainingSettlementPeriod,
    trainingSettlementStatusLabel,
    isOwnTrainingSettlement,
    trainingSettlementLatestNote,
    changeTrainingSettlement,
  };
}
