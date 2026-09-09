import type { Ref, ComputedRef } from "vue";
import {
  useOperationTask,
  reasonField,
} from "../../../components/operation-task";
import { endpoints } from "../../../../../services/api";
import { money, shortDate } from "../../../../../utils/format";

interface ActionContext {
  businessPeriod: () => {
    date: string;
    periodStart: string;
    periodEnd: string;
  };
  task: ReturnType<typeof useOperationTask>;
  load: (options?: { preserveMessage?: boolean }) => Promise<void>;
  runAction: (
    key: string,
    success: string,
    fallbackError: string,
    operation: () => Promise<unknown>,
  ) => Promise<void>;
  merchants: Ref<any[], any[]>;
  canFinanceAction: ComputedRef<boolean>;
  canMerchantAction: ComputedRef<boolean>;
}

export function useFinanceAllianceActions({
  businessPeriod,
  task,
  load,
  runAction,
  merchants,
  canFinanceAction,
  canMerchantAction,
}: ActionContext) {
  function createSettlement(merchant: any) {
    const period = businessPeriod();
    task.start({
      title: "生成联盟结算草稿",
      description:
        merchant.name +
        " · " +
        period.date +
        "。按已核销券重算指标，手工归因金额需有凭证，不直接修改实收。",
      confirmText: "确认生成草稿",
      fields: [
        {
          key: "profit",
          label: "本周期归因毛利（元）",
          kind: "money",
          initial: "0",
        },
      ],
      submit: async ({ profit }) => {
        await endpoints.createAllianceSettlement({
          merchantId: merchant.id,
          periodStart: period.periodStart,
          periodEnd: period.periodEnd,
          attributedGrossProfitCents: Math.round(Number(profit) * 100),
        });
        await load();
        return "联盟结算草稿已生成，可提交商户核对。";
      },
    });
  }

  async function submitSettlement(settlement: any) {
    const confirmed = await uni.showModal({
      title: "提交商户确认",
      content: `${settlementMerchant(settlement)} · 服务费 ${money(settlement.cooperationFeeCents)}。提交后金额锁定并等待商户确认。`,
      confirmText: "确认提交",
    });
    if (!confirmed.confirm) return;
    await runAction(
      `settlement-submit:${settlement.id}`,
      `${settlementMerchant(settlement)} 的结算单已提交商户确认`,
      "结算单提交失败",
      () => endpoints.submitAllianceSettlement(settlement.id),
    );
  }

  async function confirmSettlement(settlement: any) {
    const confirmed = await uni.showModal({
      title: "确认联盟结算单",
      content: `${settlementMerchant(settlement)} · 服务费 ${money(settlement.cooperationFeeCents)}。确认后将进入财务付款队列。`,
      confirmText: "确认账单",
    });
    if (!confirmed.confirm) return;
    await runAction(
      `settlement-confirm:${settlement.id}`,
      `${settlementMerchant(settlement)} 已确认结算单`,
      "结算单确认失败",
      () => endpoints.confirmAllianceSettlement(settlement.id),
    );
  }

  function disputeSettlement(settlement: any) {
    task.start({
      title: "提出联盟结算争议",
      description:
        settlementMerchant(settlement) +
        " · " +
        money(settlement.cooperationFeeCents) +
        "。退回草稿，原金额不覆盖。",
      confirmText: "确认提交争议",
      fields: [reasonField("差异与凭证")],
      submit: async ({ reason }) => {
        await endpoints.disputeAllianceSettlement(settlement.id, { reason });
        await load();
        return "账单已退回待核查，争议依据保留。";
      },
    });
  }

  async function settleSettlement(settlement: any) {
    const confirmed = await uni.showModal({
      title: "确认结算入账",
      content: `${settlementMerchant(settlement)} · 应结服务费 ${money(settlement.cooperationFeeCents)}。仅在付款凭证与商户确认一致后执行。`,
      confirmText: "确认已结算",
    });
    if (!confirmed.confirm) return;
    await runAction(
      `settlement-settle:${settlement.id}`,
      `${settlementMerchant(settlement)} 的结算单已完成入账`,
      "结算入账失败",
      () => endpoints.settleAllianceSettlement(settlement.id),
    );
  }

  function settlementMerchant(settlement: any) {
    return (
      settlement.merchant?.name ||
      merchants.value.find((item) => item.id === settlement.merchantId)?.name ||
      "联盟商户"
    );
  }

  function settlementPeriod(settlement: any) {
    if (!settlement.periodStart || !settlement.periodEnd)
      return "结算周期待补充";
    const start = new Date(settlement.periodStart).toLocaleDateString("zh-CN");
    const end = new Date(settlement.periodEnd).toLocaleDateString("zh-CN");
    return `${start} — ${end}`;
  }

  function settlementStatusLabel(status?: string) {
    const labels: Record<string, string> = {
      DRAFT: "草稿",
      PENDING_CONFIRMATION: "待商户确认",
      CONFIRMED: "商户已确认",
      SETTLED: "已结算",
      VOID: "已作废",
    };
    return labels[status || ""] || status || "未知状态";
  }

  function settlementHint(settlement: any) {
    if (settlement.status === "DRAFT")
      return canFinanceAction.value ? "待财务提交商户确认" : "待财务复核并提交";
    if (settlement.status === "PENDING_CONFIRMATION")
      return canMerchantAction.value
        ? "请商户确认或提出争议"
        : "已提交，等待商户确认";
    if (settlement.status === "CONFIRMED")
      return canFinanceAction.value
        ? "商户已确认，待财务结算入账"
        : "已确认，等待财务结算";
    if (settlement.status === "SETTLED") return "结算闭环完成，记录不可覆盖";
    if (settlement.status === "VOID") return "结算单已作废，仅供审计查询";
    return "请刷新获取最新状态";
  }

  function workflowNote(settlement: any) {
    const history = settlement.detail?.workflowHistory;
    if (!Array.isArray(history) || !history.length) return "";
    const latest = history[history.length - 1];
    if (!latest || typeof latest !== "object") return "";
    const parts = [];
    if (latest.reason) parts.push(`原因：${latest.reason}`);
    if (latest.at) parts.push(shortDate(latest.at));
    return parts.join(" · ");
  }

  function settlementHasAction(settlement: any) {
    return (
      (settlement.status === "DRAFT" && canFinanceAction.value) ||
      (settlement.status === "PENDING_CONFIRMATION" &&
        canMerchantAction.value) ||
      (settlement.status === "CONFIRMED" && canFinanceAction.value)
    );
  }
  return {
    createSettlement,
    submitSettlement,
    confirmSettlement,
    disputeSettlement,
    settleSettlement,
    settlementMerchant,
    settlementPeriod,
    settlementStatusLabel,
    settlementHint,
    workflowNote,
    settlementHasAction,
  };
}
