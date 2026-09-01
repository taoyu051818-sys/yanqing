<script setup lang="ts">
import { computed, nextTick, ref } from "vue";
import { onLoad, onShow } from "@dcloudio/uni-app";
import OperationsFrame from "../../../../components/OperationsFrame.vue";
import MetricCard from "../../../../components/MetricCard.vue";
import StatusBadge from "../../../../components/StatusBadge.vue";
import {
  visibleFinancePageExportScopes,
  type FinancePageExportScope,
} from "../../../../config/governance";
import { hasOperationsAccess } from "../../../../config/operations";
import { endpoints, type ReconciliationPeriod } from "../../../../services/api";
import { isMockMode } from "../../../../services/http";
import { useSessionStore } from "../../../../stores/session";
import { money, shortDate, today } from "../../../../utils/format";
import { withPendingCreationKey } from "../../../../utils/pending-creation-key";
import {
  findOpsDeepLinkRecord,
  opsDeepLinkDomId,
  parseOpsDeepLinkQuery,
  type OpsDeepLinkQuery,
} from "../../../../utils/work-item-deep-link";

type LoadSource =
  | "dashboard"
  | "refunds"
  | "training"
  | "trainingSettlements"
  | "merchants"
  | "settlements"
  | "consignmentSuppliers"
  | "consignmentPayables"
  | "consignmentSettlements"
  | "reconciliation"
  | "adjustments"
  | "shifts";

const session = useSessionStore();
const dashboard = ref<Record<string, any> | null>(null);
const orders = ref<any[]>([]);
const training = ref<Record<string, any> | null>(null);
const trainingSettlements = ref<any[]>([]);
const merchants = ref<any[]>([]);
const settlements = ref<any[]>([]);
const consignmentSuppliers = ref<any[]>([]);
const consignmentPayables = ref<any[]>([]);
const consignmentSettlements = ref<any[]>([]);
const reconciliation = ref<ReconciliationPeriod | null>(null);
const adjustments = ref<any[]>([]);
const shifts = ref<any[]>([]);
const loading = ref(false);
const actionKey = ref("");
const successMessage = ref("");
const actionError = ref("");
const lastSyncedAt = ref("");
const deepLinkQuery = ref<OpsDeepLinkQuery>({});
const deepLinkHandled = ref(false);
const focusedRecord = ref("");
const trainingSettlementStatusOptions = [
  { value: "", label: "全部状态" },
  { value: "DRAFT", label: "草稿" },
  { value: "PENDING_CONFIRMATION", label: "待复核" },
  { value: "CONFIRMED", label: "待入账" },
  { value: "SETTLED", label: "已结算" },
  { value: "VOID", label: "已作废" },
];
const trainingSettlementStatusIndex = ref(0);
const trainingPeriodStartDate = ref(closeBusinessPeriod().date);
const trainingPeriodEndDate = ref(today());
const consignmentPeriodStartDate = ref(`${today().slice(0, 8)}01`);
const consignmentPeriodEndDate = ref(today());

const emptyLoadErrors = (): Record<LoadSource, string> => ({
  dashboard: "",
  refunds: "",
  training: "",
  trainingSettlements: "",
  merchants: "",
  settlements: "",
  consignmentSuppliers: "",
  consignmentPayables: "",
  consignmentSettlements: "",
  reconciliation: "",
  adjustments: "",
  shifts: "",
});
const loadErrors = ref<Record<LoadSource, string>>(emptyLoadErrors());

const canFinanceAction = computed(() =>
  session.roles.some((role) =>
    ["FINANCE", "ADMIN", "SUPER_ADMIN"].includes(role),
  ),
);
const canMerchantAction = computed(() =>
  session.roles.some((role) =>
    ["MERCHANT", "ADMIN", "SUPER_ADMIN"].includes(role),
  ),
);
const visibleExportScopes = computed(() =>
  visibleFinancePageExportScopes(session.roles),
);
const canAdministrativeExport = computed(() =>
  session.roles.some((role) => ["ADMIN", "SUPER_ADMIN"].includes(role)),
);
const roleLabel = computed(() => {
  if (session.roles.includes("SUPER_ADMIN")) return "超级管理员";
  if (session.roles.includes("ADMIN")) return "管理员";
  if (session.roles.includes("MERCHANT")) return "商户确认";
  return "财务";
});

const allRefunds = computed(() =>
  orders.value
    .flatMap((order) =>
      (order.refunds || []).map((refund: any) => ({ ...refund, order })),
    )
    .sort(
      (left, right) =>
        new Date(right.requestedAt || 0).getTime() -
        new Date(left.requestedAt || 0).getTime(),
    ),
);

const reviewRefunds = computed(() =>
  allRefunds.value.filter((item) =>
    ["REQUESTED", "REFUND_PENDING"].includes(item.status),
  ),
);

const isForcedSystemRefund = (refund: any) =>
  ["GAME_CANCEL:", "EVENT_CANCEL:", "EVENT_LATE_PAYMENT:"].some((prefix) =>
    String(refund.idempotencyKey || "").startsWith(prefix),
  );

const activeRefunds = computed(() =>
  allRefunds.value.filter((item) =>
    [
      "REQUESTED",
      "REFUND_PENDING",
      "APPROVED",
      "PROCESSING",
      "FAILED",
    ].includes(item.status),
  ),
);

const unsettledFeeCents = computed(() =>
  settlements.value
    .filter((item) => !["SETTLED", "VOID"].includes(item.status))
    .reduce((sum, item) => sum + Number(item.cooperationFeeCents || 0), 0),
);

const displayedUnsettledFeeCents = computed(() =>
  settlements.value.length
    ? unsettledFeeCents.value
    : Number(dashboard.value?.alliance?.cooperationFeeCents || 0),
);

const pendingConsignmentSettlements = computed(() =>
  consignmentSettlements.value.filter((item) =>
    ["DRAFT", "PENDING_CONFIRMATION", "CONFIRMED"].includes(item.status),
  ),
);
const pendingConsignmentPayableCents = computed(() =>
  pendingConsignmentSettlements.value.reduce(
    (sum, item) => sum + Number(item.payableCents || 0),
    0,
  ),
);
const activeConsignmentSuppliers = computed(() =>
  consignmentSuppliers.value.filter(
    (item) => item.type === "CONSIGNMENT" && item.enabled !== false,
  ),
);

const unreviewedShiftVariances = computed(() =>
  shifts.value.filter(
    (shift) =>
      shift.status === "CLOSED" &&
      Number(shift.cashVarianceCents || 0) !== 0 &&
      !shift.varianceReviewedAt,
  ),
);

const metrics = computed(() => [
  [
    "已实现经营收入",
    money(dashboard.value?.revenue?.realizedRevenueCents),
    "不含充值和培训预收",
  ],
  [
    "培训未消预收",
    money(
      training.value?.unusedBalanceCents ??
        dashboard.value?.training?.unusedBalanceCents,
    ),
    "尚未履约，不计收入",
  ],
  [
    "待资金复核",
    String(
      reviewRefunds.value.length +
        adjustments.value.length +
        unreviewedShiftVariances.value.length +
        trainingSettlements.value.filter((item) =>
          ["PENDING_CONFIRMATION", "CONFIRMED"].includes(item.status),
        ).length +
        pendingConsignmentSettlements.value.length,
    ),
    "退款 + 调账 + 班次差异 + 培训/寄售结算",
  ],
  [
    "现金净流入",
    money(
      dashboard.value?.collections?.netCashCents ??
        dashboard.value?.collections?.netPaymentCents,
    ),
    `寄售待付 ${money(pendingConsignmentPayableCents.value)} · 联盟待结 ${money(displayedUnsettledFeeCents.value)}`,
  ],
]);

function businessPeriod() {
  const date = today();
  const startsAt = new Date(`${date}T00:00:00+08:00`);
  const endsAt = new Date(startsAt.getTime() + 86_400_000);
  return {
    date,
    periodStart: startsAt.toISOString(),
    periodEnd: endsAt.toISOString(),
  };
}

function closeBusinessPeriod() {
  const yesterday = new Date(Date.now() - 86_400_000);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(yesterday);
  const values = Object.fromEntries(
    parts.map((part) => [part.type, part.value]),
  );
  const date = `${values.year}-${values.month}-${values.day}`;
  const startsAt = new Date(`${date}T00:00:00+08:00`);
  return {
    date,
    periodStart: startsAt.toISOString(),
    periodEnd: new Date(startsAt.getTime() + 86_400_000).toISOString(),
  };
}

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

function actionErrorMessage(reason: unknown, fallback: string) {
  return reason instanceof Error && reason.message ? reason.message : fallback;
}

function refresh() {
  void load({ preserveMessage: true });
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
      endpoints.adminOrders(),
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

    if (result[1].status === "fulfilled")
      orders.value = result[1].value?.items || [];
    else loadErrors.value.refunds = sourceError("refunds", result[1].reason);

    if (result[2].status === "fulfilled") training.value = result[2].value;
    else loadErrors.value.training = sourceError("training", result[2].reason);

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
    prefix = "finance-refund";
    label = "退款申请";
  } else if (focus === "account-adjustment") {
    record = findOpsDeepLinkRecord(adjustments.value, deepLinkQuery.value, ["id"]);
    prefix = "finance-adjustment";
    label = "账户调整申请";
  } else if (focus === "training-settlement") {
    record = findOpsDeepLinkRecord(trainingSettlements.value, deepLinkQuery.value, ["id"]);
    prefix = "finance-training-settlement";
    label = "培训结算单";
  } else if (focus === "consignment-settlement") {
    record = findOpsDeepLinkRecord(consignmentSettlements.value, deepLinkQuery.value, ["id"]);
    prefix = "finance-consignment-settlement";
    label = "寄售结算单";
  } else if (focus === "alliance-settlement") {
    record = findOpsDeepLinkRecord(settlements.value, deepLinkQuery.value, ["id"]);
    prefix = "finance-alliance-settlement";
    label = "联盟结算单";
  } else if (focus === "shift-variance") {
    record = findOpsDeepLinkRecord(unreviewedShiftVariances.value, deepLinkQuery.value, ["id"]);
    prefix = "finance-shift";
    label = "班次差异";
  } else if (focus === "reconciliation") {
    deepLinkHandled.value = true;
    if (!reconciliation.value) {
      uni.showToast({ title: "未找到待办对应的日结账期，可能尚未同步", icon: "none" });
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
    uni.showToast({ title: `未找到待办对应的${label}，可能已处理或无权查看`, icon: "none" });
    return;
  }
  focusedRecord.value = `${prefix}:${record.id}`;
  await nextTick();
  uni.pageScrollTo({ selector: `#${opsDeepLinkDomId(prefix, record.id)}`, duration: 250 });
}

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

async function runAction(
  key: string,
  success: string,
  fallbackError: string,
  operation: () => Promise<unknown>,
) {
  if (actionKey.value || loading.value) return;
  actionKey.value = key;
  actionError.value = "";
  try {
    await operation();
    successMessage.value = success;
    uni.showToast({ title: "操作成功", icon: "success" });
    await load({ preserveMessage: true });
  } catch (reason) {
    actionError.value = actionErrorMessage(reason, fallbackError);
    uni.showToast({ title: actionError.value, icon: "none" });
  } finally {
    actionKey.value = "";
  }
}

async function askReason(
  title: string,
  placeholder: string,
): Promise<string | null> {
  const modal = await uni.showModal({
    title,
    content: "",
    editable: true,
    placeholderText: placeholder,
    confirmText: "继续",
  });
  if (!modal.confirm) return null;
  const reason = modal.content?.trim() || "";
  if (reason.length < 2) {
    uni.showToast({ title: "原因至少填写 2 个字", icon: "none" });
    return null;
  }
  return reason;
}

async function approveRefund(refund: any) {
  const reason = await askReason(
    `批准退款 ${refund.refundNo || ""}`,
    "填写核对依据或批准原因（必填）",
  );
  if (!reason) return;
  const confirmed = await uni.showModal({
    title: "确认批准退款",
    content: `${refund.order.orderNo} · ${money(refund.amountCents)}。批准后将按原支付路径处理，原因：${reason}`,
    confirmText: "确认批准",
  });
  if (!confirmed.confirm) return;
  await runAction(
    `refund-approve:${refund.id}`,
    `退款 ${refund.refundNo || refund.id} 已批准并进入退款处理`,
    "退款批准失败",
    () => endpoints.approveRefund(refund.id, { reason }),
  );
}

async function rejectRefund(refund: any) {
  const reason = await askReason(
    `驳回退款 ${refund.refundNo || ""}`,
    "填写驳回原因（必填，将进入审计）",
  );
  if (!reason) return;
  const confirmed = await uni.showModal({
    title: "确认驳回退款",
    content: `${refund.order.orderNo} · ${money(refund.amountCents)}。驳回原因：${reason}`,
    confirmText: "确认驳回",
  });
  if (!confirmed.confirm) return;
  await runAction(
    `refund-reject:${refund.id}`,
    `退款 ${refund.refundNo || refund.id} 已驳回`,
    "退款驳回失败",
    () => endpoints.rejectRefund(refund.id, { reason }),
  );
}

async function reviewAdjustment(request: any, approved: boolean) {
  const reason = await askReason(
    approved ? "批准账户调整" : "驳回账户调整",
    approved ? "填写核对原始凭证或批准依据" : "填写驳回原因",
  );
  if (!reason) return;
  const confirmed = await uni.showModal({
    title: approved ? "确认调整入账" : "确认驳回申请",
    content: `${request.account?.user?.displayName || "会员"} · ${accountDelta(request)}。${approved ? "入账后只可提交反向调整，不能覆盖历史。" : "本次申请不会改动余额。"}`,
    confirmText: approved ? "复核入账" : "确认驳回",
  });
  if (!confirmed.confirm) return;
  await runAction(
    `account-adjustment-${approved ? "approve" : "reject"}:${request.id}`,
    approved ? "账户调整已复核入账" : "账户调整申请已驳回",
    approved ? "账户调整入账失败" : "账户调整驳回失败",
    () =>
      approved
        ? endpoints.approveAccountAdjustment(request.id, reason)
        : endpoints.rejectAccountAdjustment(request.id, reason),
  );
}

async function reviewShiftVariance(shift: any) {
  if (!canFinanceAction.value || shift.varianceReviewedAt) return;
  if ([shift.operatorId, shift.closedById].includes(session.user?.id)) {
    uni.showToast({
      title: "班次操作人或关班人不能复核自己的差异",
      icon: "none",
    });
    return;
  }
  const reason = await askReason(
    "复核现金差异",
    "填写盘点凭证、差异原因及处理结论",
  );
  if (!reason) return;
  const confirmed = await uni.showModal({
    title: "确认现金差异复核",
    content: `${shift.operator?.displayName || "前台"} · 账面 ${money(shift.expectedCashCents)} · 实点 ${money(shift.closingCashCents)} · 差异 ${money(shift.cashVarianceCents)}。复核原因：${reason}`,
    confirmText: "确认复核",
  });
  if (!confirmed.confirm) return;
  await runAction(
    `shift-variance-review:${shift.id}`,
    "前台现金差异已复核并写入审计",
    "现金差异复核失败",
    () => endpoints.reviewFrontDeskShiftVariance(shift.id, { reason }),
  );
}

function accountDelta(request: any) {
  const amount = Number(request.amount || 0);
  const type = request.account?.type || "";
  if (["CASH_PRINCIPAL", "GIFT_BALANCE"].includes(type)) return money(amount);
  return `${amount > 0 ? "+" : ""}${amount} ${type || "单位"}`;
}

function isOwnAdjustment(request: any) {
  return request.isOwnRequest === true;
}

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

async function askNonnegativeMoney(
  title: string,
  placeholder: string,
): Promise<number | null> {
  const modal = await uni.showModal({
    title,
    content: "",
    editable: true,
    placeholderText: placeholder,
    confirmText: "下一步",
  });
  if (!modal.confirm) return null;
  const value = modal.content?.trim() || "0";
  if (!/^\d+(\.\d{1,2})?$/.test(value)) {
    uni.showToast({ title: "请输入非负金额，最多两位小数", icon: "none" });
    return null;
  }
  return Math.round(Number(value) * 100);
}

async function createTrainingSettlementDraft() {
  if (trainingPeriodEndDate.value <= trainingPeriodStartDate.value) {
    uni.showToast({ title: "结束日期必须晚于开始日期", icon: "none" });
    return;
  }
  const acquisitionCostCents = await askNonnegativeMoney(
    "本账期获客成本",
    "输入金额（元），无则填 0",
  );
  if (acquisitionCostCents === null) return;
  const marketingCostCents = await askNonnegativeMoney(
    "本账期营销成本",
    "输入金额（元），无则填 0",
  );
  if (marketingCostCents === null) return;
  const command = {
    periodStart: new Date(
      `${trainingPeriodStartDate.value}T00:00:00+08:00`,
    ).toISOString(),
    periodEnd: new Date(
      `${trainingPeriodEndDate.value}T00:00:00+08:00`,
    ).toISOString(),
    acquisitionCostCents,
    marketingCostCents,
  };
  const confirmed = await uni.showModal({
    title: "确认生成培训结算草稿",
    content: `${trainingPeriodStartDate.value} 至 ${trainingPeriodEndDate.value}（结束日不含）· 获客 ${money(acquisitionCostCents)} · 营销 ${money(marketingCostCents)}。营业日锁定后仍可按周/月生成结算单。`,
    confirmText: "生成草稿",
  });
  if (!confirmed.confirm) return;
  await runAction(
    `training-settlement-create:${trainingPeriodStartDate.value}:${trainingPeriodEndDate.value}`,
    "培训结算草稿已生成，待提交复核",
    "培训结算草稿生成失败",
    () => endpoints.createTrainingSettlement(command),
  );
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

async function changeTrainingSettlement(
  settlement: any,
  action: "submit" | "confirm" | "settle" | "return" | "void",
) {
  if (
    ["confirm", "settle", "return"].includes(action) &&
    isOwnTrainingSettlement(settlement)
  ) {
    uni.showToast({ title: "制单人不能复核自己的结算单", icon: "none" });
    return;
  }
  const labels = {
    submit: ["提交培训结算", "填写数据核对依据", "提交复核"],
    confirm: ["确认培训结算", "填写消课、成本和合同口径复核依据", "确认通过"],
    settle: ["培训结算入账", "填写付款/收款凭证或入账依据", "确认入账"],
    return: ["退回培训结算", "填写差异项和退回原因", "确认退回"],
    void: ["作废培训草稿", "填写作废原因", "确认作废"],
  } as const;
  const reason = await askReason(labels[action][0], labels[action][1]);
  if (!reason) return;
  const confirmed = await uni.showModal({
    title: labels[action][0],
    content: `${trainingSettlementPeriod(settlement)} · 场馆合同分成 ${money(settlement.venueContributionCents)}。本次原因：${reason}。状态变更将写入不可覆盖的审计历史。`,
    confirmText: labels[action][2],
  });
  if (!confirmed.confirm) return;
  const command = { action, reason, fromStatus: settlement.status };
  await runAction(
    `training-settlement-${action}:${settlement.id}`,
    `培训结算已${action === "submit" ? "提交复核" : action === "confirm" ? "确认" : action === "settle" ? "结算入账" : action === "return" ? "退回草稿" : "作废"}`,
    "培训结算状态更新失败",
    () =>
      withPendingCreationKey(
        `training.settlement.${settlement.id}.${action}`,
        command,
        (idempotencyKey) => {
          const payload = { reason, idempotencyKey };
          if (action === "submit")
            return endpoints.submitTrainingSettlement(settlement.id, payload);
          if (action === "confirm")
            return endpoints.confirmTrainingSettlement(settlement.id, payload);
          if (action === "settle")
            return endpoints.settleTrainingSettlement(settlement.id, payload);
          if (action === "return")
            return endpoints.returnTrainingSettlement(settlement.id, payload);
          return endpoints.voidTrainingSettlement(settlement.id, payload);
        },
      ),
  );
}

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

async function createConsignmentSettlementDraft(supplier: any) {
  if (consignmentPeriodEndDate.value <= consignmentPeriodStartDate.value) {
    uni.showToast({ title: "结束日期必须晚于开始日期", icon: "none" });
    return;
  }
  const reason = await askReason(
    `生成 ${supplier.name} 寄售结算`,
    "填写制单依据，例如月结对账或逐单结算",
  );
  if (!reason) return;
  const command = {
    supplierId: supplier.id,
    periodStart: new Date(
      `${consignmentPeriodStartDate.value}T00:00:00+08:00`,
    ).toISOString(),
    periodEnd: new Date(
      `${consignmentPeriodEndDate.value}T00:00:00+08:00`,
    ).toISOString(),
    reason,
  };
  const confirmed = await uni.showModal({
    title: "确认生成寄售结算草稿",
    content: `${supplier.name} · ${consignmentPeriodStartDate.value} 至 ${consignmentPeriodEndDate.value}（结束日不含）。系统只汇总未被其他有效账单占用的销售应付与退款冲正。`,
    confirmText: "生成草稿",
  });
  if (!confirmed.confirm) return;
  await runAction(
    `consignment-create:${supplier.id}`,
    `${supplier.name} 寄售结算草稿已生成`,
    "寄售结算草稿生成失败",
    () =>
      withPendingCreationKey(
        `consignment.settlement.create.${supplier.id}`,
        command,
        (idempotencyKey) =>
          endpoints.createConsignmentSettlement({
            ...command,
            idempotencyKey,
          }),
      ),
  );
}

type ConsignmentSettlementUiAction =
  "submit" | "confirm" | "dispute" | "return" | "settle" | "void";

async function changeConsignmentSettlement(
  settlement: any,
  action: ConsignmentSettlementUiAction,
) {
  if (
    ["confirm", "dispute", "return", "settle"].includes(action) &&
    settlement.isOwnCreator === true
  ) {
    uni.showToast({ title: "制单人不能复核自己的寄售账单", icon: "none" });
    return;
  }
  const labels = {
    submit: ["提交寄售账单", "填写应付明细与合同规则核对依据", "提交复核"],
    confirm: ["确认寄售账单", "填写供应商对账确认或复核依据", "复核确认"],
    dispute: ["提出寄售争议", "填写供应商异议、差异明细或凭证", "退回草稿"],
    return: ["退回寄售账单", "填写付款前复核发现的差异", "退回草稿"],
    settle: ["结算供应商应付", "填写付款审批与金额核对依据", "继续录凭证"],
    void: ["作废寄售草稿", "填写作废及重建原因", "确认作废"],
  } as const;
  const reason = await askReason(labels[action][0], labels[action][1]);
  if (!reason) return;
  let paymentReference = "";
  if (action === "settle") {
    const reference = await askReason(
      "录入付款凭证",
      "银行流水号、付款单号或抵扣凭证（必填）",
    );
    if (!reference) return;
    paymentReference = reference;
  }
  const confirmed = await uni.showModal({
    title: labels[action][0],
    content: `${consignmentSupplierName(settlement)} · 应付 ${money(settlement.payableCents)} · ${consignmentSettlementPeriod(settlement)}。原因：${reason}。状态和操作人将写入不可覆盖历史。`,
    confirmText: labels[action][2],
  });
  if (!confirmed.confirm) return;
  const command = {
    action,
    fromStatus: settlement.status,
    reason,
    ...(paymentReference ? { paymentReference } : {}),
  };
  await runAction(
    `consignment-${action}:${settlement.id}`,
    `寄售结算已${action === "submit" ? "提交复核" : action === "confirm" ? "确认" : action === "dispute" ? "记录争议并退回" : action === "return" ? "退回草稿" : action === "settle" ? "完成付款" : "作废"}`,
    "寄售结算状态更新失败",
    () =>
      withPendingCreationKey(
        `consignment.settlement.${settlement.id}.${action}`,
        command,
        (idempotencyKey) => {
          const payload = {
            reason,
            idempotencyKey,
            ...(paymentReference ? { paymentReference } : {}),
          };
          if (action === "submit")
            return endpoints.submitConsignmentSettlement(
              settlement.id,
              payload,
            );
          if (action === "confirm")
            return endpoints.confirmConsignmentSettlement(
              settlement.id,
              payload,
            );
          if (action === "dispute")
            return endpoints.disputeConsignmentSettlement(
              settlement.id,
              payload,
            );
          if (action === "return")
            return endpoints.returnConsignmentSettlement(
              settlement.id,
              payload,
            );
          if (action === "settle")
            return endpoints.settleConsignmentSettlement(
              settlement.id,
              payload,
            );
          return endpoints.voidConsignmentSettlement(settlement.id, payload);
        },
      ),
  );
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

async function createSettlement(merchant: any) {
  const input = await uni.showModal({
    title: `生成 ${merchant.name} 结算草稿`,
    content: "",
    editable: true,
    placeholderText: "输入本周期归因毛利（元，可为 0）",
    confirmText: "核对周期",
  });
  if (!input.confirm) return;
  const grossProfitYuan = input.content?.trim() || "";
  if (!/^\d+(\.\d{1,2})?$/.test(grossProfitYuan)) {
    uni.showToast({ title: "请输入正确金额，最多两位小数", icon: "none" });
    return;
  }
  const attributedGrossProfitCents = Math.round(Number(grossProfitYuan) * 100);
  const period = businessPeriod();
  const confirmed = await uni.showModal({
    title: "确认生成结算草稿",
    content: `${merchant.name} · ${period.date}，归因毛利 ${money(attributedGrossProfitCents)}。系统将按已核销券码重算结算指标。`,
    confirmText: "生成草稿",
  });
  if (!confirmed.confirm) return;
  await runAction(
    `settlement-create:${merchant.id}`,
    `${merchant.name} 的 ${period.date} 结算草稿已生成`,
    "结算草稿生成失败",
    () =>
      endpoints.createAllianceSettlement({
        merchantId: merchant.id,
        periodStart: period.periodStart,
        periodEnd: period.periodEnd,
        attributedGrossProfitCents,
      }),
  );
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

async function disputeSettlement(settlement: any) {
  const reason = await askReason(
    "提出结算争议",
    "填写差异项、凭证或需复核原因（必填）",
  );
  if (!reason) return;
  const confirmed = await uni.showModal({
    title: "确认退回草稿",
    content: `结算单将退回 DRAFT，原金额不覆盖，争议原因：${reason}`,
    confirmText: "提交争议",
  });
  if (!confirmed.confirm) return;
  await runAction(
    `settlement-dispute:${settlement.id}`,
    `${settlementMerchant(settlement)} 的结算单已退回复核`,
    "结算争议提交失败",
    () => endpoints.disputeAllianceSettlement(settlement.id, { reason }),
  );
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
  if (!settlement.periodStart || !settlement.periodEnd) return "结算周期待补充";
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

function refundStatusNote(status?: string) {
  const labels: Record<string, string> = {
    REQUESTED: "等待财务复核",
    REFUND_PENDING: "等待财务复核",
    APPROVED: "已批准，等待退款通道处理",
    PROCESSING: "退款通道处理中",
    FAILED: "退款失败，需人工核对",
  };
  return labels[status || ""] || status || "状态待同步";
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

function ratio(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed.toFixed(2) : "—";
}

function acting(key: string) {
  return actionKey.value === key;
}

async function exportOperations(scope: FinancePageExportScope, label: string) {
  if (!canFinanceAction.value || actionKey.value) return;
  if (isMockMode) {
    await uni.showModal({
      title: "需要远端模式",
      content: `${label}由服务端生成真实 Excel 并写导出审计；mock 模式不伪造文件。`,
      showCancel: false,
    });
    return;
  }
  actionKey.value = `export:${scope}`;
  actionError.value = "";
  try {
    const file = await endpoints.downloadReport(scope);
    await uni.openDocument({ filePath: file.tempFilePath, showMenu: true });
  } catch (cause: any) {
    actionError.value = cause?.message || `${label}导出失败`;
  } finally {
    actionKey.value = "";
  }
}

function settlementHasAction(settlement: any) {
  return (
    (settlement.status === "DRAFT" && canFinanceAction.value) ||
    (settlement.status === "PENDING_CONFIRMATION" && canMerchantAction.value) ||
    (settlement.status === "CONFIRMED" && canFinanceAction.value)
  );
}

onLoad((options) => {
  deepLinkQuery.value = parseOpsDeepLinkQuery(options);
});
onShow(() => {
  void load();
});
</script>

<template>
  <OperationsFrame
    access="finance"
    title="财务结算"
    eyebrow="FINANCE & RECONCILIATION"
    :role="roleLabel"
    description="以营业日期为边界核对收入、退款、培训分成、联盟结算和寄售供应商应付；每个财务动作都有状态、原因和复核责任。"
  >
    <view class="metric-grid">
      <MetricCard
        v-for="item in metrics"
        :key="item[0]"
        :label="item[0]"
        :value="item[1]"
        :note="item[2]"
      />
    </view>

    <view class="sync-bar card">
      <view>
        <text class="sync-title">数据同步</text>
        <text class="muted">{{
          loading
            ? "正在同步经营账本…"
            : lastSyncedAt
              ? `最近同步 ${lastSyncedAt}`
              : "尚未同步"
        }}</text>
      </view>
      <button
        class="secondary inline"
        :disabled="loading || Boolean(actionKey)"
        @tap="refresh"
      >
        {{ loading ? "同步中" : "刷新" }}
      </button>
    </view>
    <view v-if="successMessage" class="notice success card">{{
      successMessage
    }}</view>
    <view v-if="actionError" class="notice error card">{{ actionError }}</view>

    <view v-if="visibleExportScopes.length" class="card export-bar">
      <view
        ><text class="sync-title">经营明细导出</text
        ><text class="muted">{{
          canAdministrativeExport
            ? "管理员可导出订单、财务账簿，以及赛事或库存专项审计明细。"
            : "财务仅可导出订单支付和职责内财务账簿，不包含内部规则快照与操作密钥。"
        }}</text></view
      >
      <view class="export-actions">
        <button
          v-for="scope in visibleExportScopes"
          :key="scope[0]"
          class="secondary inline"
          :loading="acting(`export:${scope[0]}`)"
          :disabled="Boolean(actionKey)"
          @tap="exportOperations(scope[0], scope[1])"
        >
          {{ scope[1] }}
        </button>
      </view>
    </view>

    <view class="section-title">经营对账</view>
    <view class="card reconciliation">
      <view class="row"
        ><text>本期支付额（含账户权益）</text
        ><text class="money">{{
          money(dashboard?.collections?.grossPaymentCents)
        }}</text></view
      >
      <view class="row"
        ><text>本期退款额（含退回账户）</text
        ><text class="money"
          >-{{ money(dashboard?.collections?.completedRefundCents) }}</text
        ></view
      >
      <view class="row"
        ><text>净支付额</text
        ><text class="money">{{
          money(dashboard?.collections?.netPaymentCents)
        }}</text></view
      >
      <view class="row"
        ><text>现金收款</text
        ><text class="money">{{
          money(
            dashboard?.collections?.cashCollectedCents ??
              dashboard?.collections?.grossPaymentCents,
          )
        }}</text></view
      >
      <view class="row"
        ><text>现金退款</text
        ><text class="money"
          >-{{
            money(
              dashboard?.collections?.cashRefundedCents ??
                dashboard?.collections?.completedRefundCents,
            )
          }}</text
        ></view
      >
      <view class="row"
        ><text>现金净流入</text
        ><text class="money">{{
          money(
            dashboard?.collections?.netCashCents ??
              dashboard?.collections?.netPaymentCents,
          )
        }}</text></view
      >
      <view class="row"
        ><text>充值新增预收</text
        ><text class="money">{{
          money(dashboard?.collections?.rechargePrepaidCents)
        }}</text></view
      >
      <view class="row"
        ><text>培训新增预收</text
        ><text class="money">{{
          money(dashboard?.collections?.trainingPrepaidCollectedCents)
        }}</text></view
      >
      <view class="row"
        ><text>已实现经营收入</text
        ><text class="money">{{
          money(dashboard?.revenue?.realizedRevenueCents)
        }}</text></view
      >
      <view class="row"
        ><text>场地收入</text
        ><text class="money">{{
          money(dashboard?.venue?.revenueCents)
        }}</text></view
      >
      <view class="row"
        ><text>商品收入</text
        ><text class="money">{{
          money(dashboard?.goods?.revenueCents)
        }}</text></view
      >
      <view class="row"
        ><text>培训确认收入</text
        ><text class="money">{{
          money(
            training?.confirmedRevenueCents ??
              dashboard?.training?.confirmedRevenueCents,
          )
        }}</text></view
      >
      <view class="row"
        ><text>培训未消课余额</text
        ><text class="money">{{
          money(
            training?.unusedBalanceCents ??
              dashboard?.training?.unusedBalanceCents,
          )
        }}</text></view
      >
      <view class="row"
        ><text>培训本期退费</text
        ><text class="money">{{
          money(dashboard?.training?.refundedCents)
        }}</text></view
      >
      <view class="row"
        ><text>培训场馆合同分成</text
        ><text class="money">{{
          money(
            training?.venueContractContributionCents ??
              training?.venueContributionCents ??
              dashboard?.training?.venueContributionCents,
          )
        }}</text></view
      >
      <view class="row"
        ><text>培训场地费</text
        ><text class="money">{{
          money(training?.venueFeeCents ?? dashboard?.training?.venueFeeCents)
        }}</text></view
      >
      <view class="row"
        ><text>培训现金贡献毛利</text
        ><text class="money">{{
          money(
            training?.cashContributionMarginCents ??
              dashboard?.training?.cashContributionMarginCents,
          )
        }}</text></view
      >
      <view class="row"
        ><text>每占场小时现金贡献</text
        ><text class="money">{{
          money(
            training?.resourceEfficiencyCentsPerCourtHour ??
              dashboard?.training?.resourceEfficiencyCentsPerCourtHour,
          )
        }}</text></view
      >
      <view class="row"
        ><text>球馆合同流水总额</text
        ><text class="money">{{
          money(dashboard?.contract?.venueContractRevenueCents)
        }}</text></view
      >
      <text
        v-if="loadErrors.dashboard || loadErrors.training"
        class="inline-error"
        >{{
          loadErrors.dashboard || loadErrors.training
        }}，当前数值可能不完整。</text
      >
      <text class="muted guardrail"
        >口径锁定：充值和培训课包收款先记预收；培训确认收入只来自异人复核后的消课，20%进入场馆合同流水；占场只做资源效率分析，场地费与场馆应付款恒为
        0。</text
      >
    </view>

    <view class="section-title">
      退款审核
      <text class="section-note">{{
        loading ? "同步中" : `${reviewRefunds.length} 笔待审`
      }}</text>
    </view>
    <view v-if="loadErrors.refunds" class="notice error card">
      <text>{{ loadErrors.refunds }}</text>
      <button class="ghost retry" :disabled="loading" @tap="refresh">
        重试
      </button>
    </view>
    <view v-if="loading && !activeRefunds.length" class="empty card"
      >正在同步退款申请与通道状态…</view
    >
    <view
      v-for="refund in activeRefunds"
      :id="opsDeepLinkDomId('finance-refund', refund.id)"
      :key="refund.id"
      class="card workflow-card"
      :class="{ 'deep-link-target': focusedRecord === `finance-refund:${refund.id}` }"
    >
      <view class="workflow-head">
        <view class="workflow-main">
          <text class="order-title">{{
            refund.order.title || "退款申请"
          }}</text>
          <text class="muted"
            >{{ refund.order.orderNo }} ·
            {{ refund.refundNo || refund.id }}</text
          >
        </view>
        <view class="status-block">
          <StatusBadge :value="refund.status" />
          <text class="status-note">{{ refundStatusNote(refund.status) }}</text>
        </view>
      </view>
      <view class="detail-grid">
        <view
          ><text class="detail-label">申请金额</text
          ><text class="detail-value danger-money">{{
            money(refund.amountCents)
          }}</text></view
        >
        <view
          ><text class="detail-label">申请时间</text
          ><text class="detail-value">{{
            shortDate(refund.requestedAt)
          }}</text></view
        >
      </view>
      <view class="reason-box"
        ><text class="detail-label">申请原因</text
        ><text class="reason-text">{{ refund.reason || "未填写" }}</text></view
      >
      <view
        v-if="['REQUESTED', 'REFUND_PENDING'].includes(refund.status)"
        class="action-row"
      >
        <button
          class="primary action-button"
          :disabled="loading || Boolean(actionKey)"
          @tap="approveRefund(refund)"
        >
          {{ acting(`refund-approve:${refund.id}`) ? "批准中…" : "批准退款" }}
        </button>
        <button
          v-if="!isForcedSystemRefund(refund)"
          class="danger action-button"
          :disabled="loading || Boolean(actionKey)"
          @tap="rejectRefund(refund)"
        >
          {{ acting(`refund-reject:${refund.id}`) ? "驳回中…" : "驳回申请" }}
        </button>
        <text v-else class="locked-note"
          >系统强制退款不可驳回，只能核准并原路退回。</text
        >
      </view>
    </view>
    <view
      v-if="!loading && !loadErrors.refunds && !activeRefunds.length"
      class="empty card"
      >当前没有待审核或处理中的退款</view
    >

    <template v-if="canFinanceAction">
      <view class="section-title">
        账户调整复核
        <text class="section-note">{{
          loading ? "同步中" : `${adjustments.length} 笔待审`
        }}</text>
      </view>
      <view v-if="loadErrors.adjustments" class="notice error card">
        <text>{{ loadErrors.adjustments }}</text>
        <button class="ghost retry" :disabled="loading" @tap="refresh">
          重试
        </button>
      </view>
      <view
        v-for="request in adjustments"
        :id="opsDeepLinkDomId('finance-adjustment', request.id)"
        :key="request.id"
        class="card workflow-card"
        :class="{ 'deep-link-target': focusedRecord === `finance-adjustment:${request.id}` }"
      >
        <view class="workflow-head">
          <view class="workflow-main">
            <text class="order-title">{{
              request.account?.user?.displayName || "会员账户"
            }}</text>
            <text class="muted"
              >{{ request.account?.type }} · 申请人
              {{
                request.requestedBy?.displayName || "历史申请人"
              }}</text
            >
          </view>
          <text class="state-chip state-draft">待复核</text>
        </view>
        <view class="detail-grid">
          <view
            ><text class="detail-label">调整数额</text
            ><text class="detail-value">{{ accountDelta(request) }}</text></view
          >
          <view
            ><text class="detail-label">申请时间</text
            ><text class="detail-value">{{
              shortDate(request.createdAt)
            }}</text></view
          >
        </view>
        <view class="reason-box"
          ><text class="detail-label">调整原因</text
          ><text class="reason-text">{{ request.reason }}</text></view
        >
        <view v-if="isOwnAdjustment(request)" class="locked-note"
          >制单人与复核人不能是同一账号，请由另一名财务或管理员处理。</view
        >
        <view v-else class="action-row">
          <button
            class="primary action-button"
            :disabled="loading || Boolean(actionKey)"
            @tap="reviewAdjustment(request, true)"
          >
            {{
              acting(`account-adjustment-approve:${request.id}`)
                ? "入账中…"
                : "复核入账"
            }}
          </button>
          <button
            class="danger action-button"
            :disabled="loading || Boolean(actionKey)"
            @tap="reviewAdjustment(request, false)"
          >
            {{
              acting(`account-adjustment-reject:${request.id}`)
                ? "驳回中…"
                : "驳回申请"
            }}
          </button>
        </view>
      </view>
      <view
        v-if="!loading && !loadErrors.adjustments && !adjustments.length"
        class="empty card"
        >当前没有待复核账户调整</view
      >
    </template>

    <view class="section-title">
      培训结算
      <text class="section-note">{{
        loading ? "同步中" : `${trainingSettlements.length} 张`
      }}</text>
    </view>
    <text class="section-description"
      >财务制单、另一账号复核、确认后入账；营业日关账锁定源流水，不锁死之后的周/月结算。</text
    >
    <view class="card training-settlement-tools">
      <view class="period-picker-row">
        <picker
          mode="date"
          :value="trainingPeriodStartDate"
          @change="onTrainingPeriodStartChange"
        >
          <view class="picker-field"
            ><text class="detail-label">账期开始</text
            ><text class="detail-value">{{
              trainingPeriodStartDate
            }}</text></view
          >
        </picker>
        <picker
          mode="date"
          :value="trainingPeriodEndDate"
          @change="onTrainingPeriodEndChange"
        >
          <view class="picker-field"
            ><text class="detail-label">账期结束（不含）</text
            ><text class="detail-value">{{ trainingPeriodEndDate }}</text></view
          >
        </picker>
      </view>
      <view class="training-tool-actions">
        <picker
          :range="trainingSettlementStatusOptions"
          range-key="label"
          :value="trainingSettlementStatusIndex"
          @change="onTrainingSettlementStatusChange"
        >
          <view class="secondary filter-button"
            >筛选：{{
              trainingSettlementStatusOptions[trainingSettlementStatusIndex]
                .label
            }}</view
          >
        </picker>
        <button
          class="primary inline training-create"
          :disabled="loading || Boolean(actionKey)"
          @tap="createTrainingSettlementDraft"
        >
          {{
            acting(
              `training-settlement-create:${trainingPeriodStartDate}:${trainingPeriodEndDate}`,
            )
              ? "生成中…"
              : "生成账期草稿"
          }}
        </button>
      </view>
    </view>
    <view v-if="loadErrors.trainingSettlements" class="notice error card">
      <text>{{ loadErrors.trainingSettlements }}</text>
      <button class="ghost retry" :disabled="loading" @tap="refresh">
        重试
      </button>
    </view>
    <view v-if="loading && !trainingSettlements.length" class="empty card"
      >正在同步培训结算账本…</view
    >
    <view
      v-for="statement in trainingSettlements"
      :id="opsDeepLinkDomId('finance-training-settlement', statement.id)"
      :key="statement.id"
      class="card workflow-card settlement-card"
      :class="{ 'deep-link-target': focusedRecord === `finance-training-settlement:${statement.id}` }"
    >
      <view class="workflow-head">
        <view class="workflow-main">
          <text class="order-title">培训合同流水结算</text>
          <text class="muted">{{ trainingSettlementPeriod(statement) }}</text>
        </view>
        <text
          class="state-chip"
          :class="`state-${String(statement.status || '').toLowerCase()}`"
          >{{ trainingSettlementStatusLabel(statement.status) }}</text
        >
      </view>
      <view class="settlement-numbers">
        <view
          ><text class="detail-label">有效消课收入</text
          ><text class="detail-value money">{{
            money(statement.effectiveRevenueCents)
          }}</text></view
        >
        <view
          ><text class="detail-label">场馆合同分成</text
          ><text class="detail-value money">{{
            money(statement.venueContributionCents)
          }}</text></view
        >
        <view
          ><text class="detail-label">现金贡献毛利</text
          ><text class="detail-value">{{
            money(statement.cashContributionMarginCents)
          }}</text></view
        >
        <view
          ><text class="detail-label">教练 / 助教成本</text
          ><text class="detail-value"
            >{{ money(statement.coachCostCents) }} /
            {{ money(statement.assistantCostCents) }}</text
          ></view
        >
        <view
          ><text class="detail-label">物料成本</text
          ><text class="detail-value">{{
            money(statement.materialCostCents)
          }}</text></view
        >
        <view
          ><text class="detail-label">获客 / 营销成本</text
          ><text class="detail-value"
            >{{ money(statement.acquisitionCostCents) }} /
            {{ money(statement.marketingCostCents) }}</text
          ></view
        >
      </view>
      <view class="state-guidance">
        <text
          >制单人：{{
            statement.createdBy?.displayName ||
            "历史数据待补录"
          }}</text
        >
        <text
          v-if="trainingSettlementLatestNote(statement)"
          class="muted workflow-note"
          >最近动作：{{ trainingSettlementLatestNote(statement) }}</text
        >
      </view>
      <view
        v-if="
          isOwnTrainingSettlement(statement) &&
          ['PENDING_CONFIRMATION', 'CONFIRMED'].includes(statement.status)
        "
        class="locked-note"
        >制单人与复核/入账人不能是同一账号，请切换另一名财务或管理员。</view
      >
      <view class="action-row">
        <button
          v-if="statement.status === 'DRAFT'"
          class="primary action-button"
          :disabled="loading || Boolean(actionKey)"
          @tap="changeTrainingSettlement(statement, 'submit')"
        >
          {{
            acting(`training-settlement-submit:${statement.id}`)
              ? "提交中…"
              : "提交复核"
          }}
        </button>
        <button
          v-if="statement.status === 'DRAFT'"
          class="danger action-button"
          :disabled="loading || Boolean(actionKey)"
          @tap="changeTrainingSettlement(statement, 'void')"
        >
          {{
            acting(`training-settlement-void:${statement.id}`)
              ? "作废中…"
              : "作废草稿"
          }}
        </button>
        <button
          v-if="
            statement.status === 'PENDING_CONFIRMATION' &&
            !isOwnTrainingSettlement(statement)
          "
          class="primary action-button"
          :disabled="loading || Boolean(actionKey)"
          @tap="changeTrainingSettlement(statement, 'confirm')"
        >
          {{
            acting(`training-settlement-confirm:${statement.id}`)
              ? "确认中…"
              : "复核确认"
          }}
        </button>
        <button
          v-if="
            statement.status === 'PENDING_CONFIRMATION' &&
            !isOwnTrainingSettlement(statement)
          "
          class="danger action-button"
          :disabled="loading || Boolean(actionKey)"
          @tap="changeTrainingSettlement(statement, 'return')"
        >
          {{
            acting(`training-settlement-return:${statement.id}`)
              ? "退回中…"
              : "退回草稿"
          }}
        </button>
        <button
          v-if="
            statement.status === 'CONFIRMED' &&
            !isOwnTrainingSettlement(statement)
          "
          class="primary action-button"
          :disabled="loading || Boolean(actionKey)"
          @tap="changeTrainingSettlement(statement, 'settle')"
        >
          {{
            acting(`training-settlement-settle:${statement.id}`)
              ? "入账中…"
              : "确认结算入账"
          }}
        </button>
      </view>
    </view>
    <view
      v-if="
        !loading &&
        !loadErrors.trainingSettlements &&
        !trainingSettlements.length
      "
      class="empty card"
      >当前筛选条件下没有培训结算单</view
    >

    <view class="section-title">
      寄售应付与供应商结算
      <text class="section-note">{{
        loading
          ? "同步中"
          : `${consignmentPayables.length} 条明细 · ${consignmentSettlements.length} 张结算单`
      }}</text>
    </view>
    <text class="section-description"
      >寄售商品完成销售履约后生成供应商应付，整单退款追加负数冲正；自营采购库存不进入该账本。未制单明细和未完成周期结算持续预警但不阻断每日关账；源流水锁定后仍可按周/月对账付款。</text
    >
    <view class="card training-settlement-tools">
      <view class="period-picker-row">
        <picker
          mode="date"
          :value="consignmentPeriodStartDate"
          @change="onConsignmentPeriodStartChange"
        >
          <view class="picker-field"
            ><text class="detail-label">账期开始</text
            ><text class="detail-value">{{
              consignmentPeriodStartDate
            }}</text></view
          >
        </picker>
        <picker
          mode="date"
          :value="consignmentPeriodEndDate"
          @change="onConsignmentPeriodEndChange"
        >
          <view class="picker-field"
            ><text class="detail-label">账期结束（不含）</text
            ><text class="detail-value">{{
              consignmentPeriodEndDate
            }}</text></view
          >
        </picker>
      </view>
      <view v-if="loadErrors.consignmentSuppliers" class="inline-error">{{
        loadErrors.consignmentSuppliers
      }}</view>
      <view
        v-for="supplier in activeConsignmentSuppliers"
        :key="supplier.id"
        class="supplier-create-row"
      >
        <view class="workflow-main">
          <text class="order-title">{{ supplier.name }}</text>
          <text class="muted"
            >{{ supplier.code || "寄售供应商" }} ·
            {{ consignmentSupplierRule(supplier) }}</text
          >
        </view>
        <button
          class="secondary inline"
          :disabled="loading || Boolean(actionKey)"
          @tap="createConsignmentSettlementDraft(supplier)"
        >
          {{
            acting(`consignment-create:${supplier.id}`)
              ? "生成中…"
              : "按账期制单"
          }}
        </button>
      </view>
      <view
        v-if="
          !loading &&
          !loadErrors.consignmentSuppliers &&
          !activeConsignmentSuppliers.length
        "
        class="embedded-empty"
        >当前没有启用的寄售供应商，请先在库存管理完成主数据配置。</view
      >
    </view>

    <view class="section-subtitle">应付流水</view>
    <view v-if="loadErrors.consignmentPayables" class="notice error card">
      <text>{{ loadErrors.consignmentPayables }}</text>
      <button class="ghost retry" :disabled="loading" @tap="refresh">
        重试
      </button>
    </view>
    <view v-if="loading && !consignmentPayables.length" class="empty card"
      >正在同步寄售应付流水…</view
    >
    <view
      v-for="entry in consignmentPayables"
      :key="entry.id"
      class="card workflow-card"
    >
      <view class="workflow-head">
        <view class="workflow-main">
          <text class="order-title"
            >{{ entry.supplier?.name || "寄售供应商" }} ·
            {{ entry.item?.name || entry.item?.sku || "商品" }}</text
          >
          <text class="muted"
            >{{ entry.order?.orderNo || "历史订单"
            }}<template v-if="entry.refund?.refundNo">
              · {{ entry.refund.refundNo }}</template
            >
            · {{ shortDate(entry.occurredAt) }}</text
          >
        </view>
        <text
          class="state-chip"
          :class="
            entry.type === 'REFUND_REVERSAL' ? 'state-void' : 'state-settled'
          "
          >{{
            entry.type === "REFUND_REVERSAL" ? "退款冲正" : "销售应付"
          }}</text
        >
      </view>
      <view class="settlement-numbers">
        <view
          ><text class="detail-label">数量</text
          ><text class="detail-value">{{ entry.quantity || 0 }}</text></view
        >
        <view
          ><text class="detail-label">销售额</text
          ><text class="detail-value">{{
            money(entry.grossSaleCents)
          }}</text></view
        >
        <view
          ><text class="detail-label">球馆佣金</text
          ><text class="detail-value">{{
            money(entry.commissionCents)
          }}</text></view
        >
        <view
          ><text class="detail-label">供应商应付</text
          ><text class="detail-value money">{{
            money(entry.payableCents)
          }}</text></view
        >
        <view
          ><text class="detail-label">佣金比例</text
          ><text class="detail-value"
            >{{ Number(entry.commissionRateBps || 0) / 100 }}%</text
          ></view
        >
        <view
          ><text class="detail-label">结算归属</text
          ><text class="detail-value">{{
            payableAssignment(entry)
          }}</text></view
        >
      </view>
    </view>
    <view
      v-if="
        !loading &&
        !loadErrors.consignmentPayables &&
        !consignmentPayables.length
      "
      class="empty card"
      >当前没有寄售应付明细</view
    >

    <view class="section-subtitle">供应商结算单</view>
    <view v-if="loadErrors.consignmentSettlements" class="notice error card">
      <text>{{ loadErrors.consignmentSettlements }}</text>
      <button class="ghost retry" :disabled="loading" @tap="refresh">
        重试
      </button>
    </view>
    <view v-if="loading && !consignmentSettlements.length" class="empty card"
      >正在同步供应商结算单…</view
    >
    <view
      v-for="statement in consignmentSettlements"
      :id="opsDeepLinkDomId('finance-consignment-settlement', statement.id)"
      :key="statement.id"
      class="card workflow-card settlement-card"
      :class="{ 'deep-link-target': focusedRecord === `finance-consignment-settlement:${statement.id}` }"
    >
      <view class="workflow-head">
        <view class="workflow-main">
          <text class="order-title">{{
            consignmentSupplierName(statement)
          }}</text>
          <text class="muted"
            >{{ statement.statementNo }} ·
            {{ consignmentSettlementPeriod(statement) }}</text
          >
        </view>
        <text
          class="state-chip"
          :class="`state-${String(statement.status || '').toLowerCase()}`"
          >{{ consignmentSettlementStatusLabel(statement.status) }}</text
        >
      </view>
      <view class="settlement-numbers">
        <view
          ><text class="detail-label">应付/冲正明细</text
          ><text class="detail-value"
            >{{ statement.entryCount || 0 }} 条</text
          ></view
        >
        <view
          ><text class="detail-label">净数量</text
          ><text class="detail-value">{{
            statement.netQuantity || 0
          }}</text></view
        >
        <view
          ><text class="detail-label">版本</text
          ><text class="detail-value">V{{ statement.version || 1 }}</text></view
        >
        <view
          ><text class="detail-label">销售净额</text
          ><text class="detail-value">{{
            money(statement.grossSaleCents)
          }}</text></view
        >
        <view
          ><text class="detail-label">球馆佣金</text
          ><text class="detail-value">{{
            money(statement.commissionCents)
          }}</text></view
        >
        <view
          ><text class="detail-label">应付净额</text
          ><text class="detail-value money">{{
            money(statement.payableCents)
          }}</text></view
        >
      </view>
      <view class="state-guidance">
        <text
          >制单人：{{
            statement.createdBy?.displayName ||
            statement.createdById ||
            "历史数据待补录"
          }}</text
        >
        <text v-if="statement.paymentReference" class="muted workflow-note"
          >付款凭证：{{ statement.paymentReference }}</text
        >
        <text
          v-if="consignmentLatestTransition(statement)"
          class="muted workflow-note"
          >最近动作：{{ consignmentLatestTransition(statement) }}</text
        >
      </view>
      <view
        v-if="
          statement.isOwnCreator === true &&
          ['PENDING_CONFIRMATION', 'CONFIRMED'].includes(statement.status)
        "
        class="locked-note"
        >制单人不能复核、退回或付款自己的结算单，请切换另一名财务或管理员。</view
      >
      <view class="action-row">
        <button
          v-if="statement.status === 'DRAFT'"
          class="primary action-button"
          :disabled="loading || Boolean(actionKey)"
          @tap="changeConsignmentSettlement(statement, 'submit')"
        >
          {{
            acting(`consignment-submit:${statement.id}`)
              ? "提交中…"
              : "提交复核"
          }}
        </button>
        <button
          v-if="statement.status === 'DRAFT'"
          class="danger action-button"
          :disabled="loading || Boolean(actionKey)"
          @tap="changeConsignmentSettlement(statement, 'void')"
        >
          {{
            acting(`consignment-void:${statement.id}`) ? "作废中…" : "作废草稿"
          }}
        </button>
        <button
          v-if="
            statement.status === 'PENDING_CONFIRMATION' &&
            statement.isOwnCreator !== true
          "
          class="primary action-button"
          :disabled="loading || Boolean(actionKey)"
          @tap="changeConsignmentSettlement(statement, 'confirm')"
        >
          {{
            acting(`consignment-confirm:${statement.id}`)
              ? "确认中…"
              : "复核确认"
          }}
        </button>
        <button
          v-if="
            statement.status === 'PENDING_CONFIRMATION' &&
            statement.isOwnCreator !== true
          "
          class="danger action-button"
          :disabled="loading || Boolean(actionKey)"
          @tap="changeConsignmentSettlement(statement, 'dispute')"
        >
          {{
            acting(`consignment-dispute:${statement.id}`)
              ? "退回中…"
              : "记录争议"
          }}
        </button>
        <button
          v-if="
            statement.status === 'CONFIRMED' &&
            statement.isOwnCreator !== true
          "
          class="primary action-button"
          :disabled="loading || Boolean(actionKey)"
          @tap="changeConsignmentSettlement(statement, 'settle')"
        >
          {{
            acting(`consignment-settle:${statement.id}`)
              ? "付款中…"
              : "确认付款"
          }}
        </button>
        <button
          v-if="
            statement.status === 'CONFIRMED' &&
            statement.isOwnCreator !== true
          "
          class="danger action-button"
          :disabled="loading || Boolean(actionKey)"
          @tap="changeConsignmentSettlement(statement, 'return')"
        >
          {{
            acting(`consignment-return:${statement.id}`)
              ? "退回中…"
              : "退回草稿"
          }}
        </button>
      </view>
    </view>
    <view
      v-if="
        !loading &&
        !loadErrors.consignmentSettlements &&
        !consignmentSettlements.length
      "
      class="empty card"
      >当前没有寄售供应商结算单，可按供应商与账期生成草稿。</view
    >

    <view class="section-title">
      前台现金差异复核
      <text class="section-note">{{
        loading ? "同步中" : `${unreviewedShiftVariances.length} 个待复核班次`
      }}</text>
    </view>
    <text class="section-description"
      >现金按实际收款操作员归属；班次操作人或关班人不能复核自己的差异，非零差异处理后才能完成日结关账。</text
    >
    <view v-if="loadErrors.shifts" class="notice error card">
      <text>{{ loadErrors.shifts }}</text>
      <button class="ghost retry" :disabled="loading" @tap="refresh">
        重试
      </button>
    </view>
    <view
      v-for="shift in unreviewedShiftVariances"
      :id="opsDeepLinkDomId('finance-shift', shift.id)"
      :key="shift.id"
      class="card workflow-card"
      :class="{ 'deep-link-target': focusedRecord === `finance-shift:${shift.id}` }"
    >
      <view class="workflow-head">
        <view class="workflow-main">
          <text class="order-title">{{
            shift.operator?.displayName || "前台班次"
          }}</text>
          <text class="muted"
            >{{ shift.businessDateLabel || shortDate(shift.businessDate) }} ·
            {{ shift.venueCode || "MAIN" }}</text
          >
        </view>
        <text class="state-chip state-pending_confirmation">待差异复核</text>
      </view>
      <view class="settlement-numbers">
        <view
          ><text class="detail-label">备用金</text
          ><text class="detail-value">{{
            money(shift.openingCashCents)
          }}</text></view
        >
        <view
          ><text class="detail-label">账面现金</text
          ><text class="detail-value">{{
            money(shift.expectedCashCents)
          }}</text></view
        >
        <view
          ><text class="detail-label">实际盘点</text
          ><text class="detail-value">{{
            money(shift.closingCashCents)
          }}</text></view
        >
        <view
          ><text class="detail-label">现金差异</text
          ><text class="detail-value danger-money">{{
            money(shift.cashVarianceCents)
          }}</text></view
        >
      </view>
      <view
        v-if="[shift.operatorId, shift.closedById].includes(session.user?.id)"
        class="locked-note"
        >你参与了本班次操作或关班，请切换另一名财务或管理员复核。</view
      >
      <view v-else class="action-row">
        <button
          class="primary action-button"
          :disabled="loading || Boolean(actionKey)"
          @tap="reviewShiftVariance(shift)"
        >
          {{
            acting(`shift-variance-review:${shift.id}`)
              ? "复核中…"
              : "复核现金差异"
          }}
        </button>
      </view>
    </view>
    <view
      v-if="!loading && !loadErrors.shifts && !unreviewedShiftVariances.length"
      class="empty card"
      >当前没有待复核现金差异</view
    >

    <view class="section-title">日结与账期关账</view>
    <view v-if="loadErrors.reconciliation" class="notice error card">
      <text>{{ loadErrors.reconciliation }}</text>
      <button class="ghost retry" :disabled="loading" @tap="refresh">
        重试
      </button>
    </view>
    <view id="finance-reconciliation" v-else class="card reconciliation-period" :class="{ 'deep-link-target': focusedRecord === 'finance-reconciliation' }">
      <view class="workflow-head">
        <view class="workflow-main">
          <text class="order-title"
            >待关账营业日 {{ closeBusinessPeriod().date }}</text
          >
          <text class="muted"
            >状态：{{ reconciliationStatusLabel(reconciliation?.status) }} ·
            异常 {{ reconciliation?.exceptionCount || 0 }} 项</text
          >
        </view>
        <StatusBadge :value="reconciliation?.status || 'OPEN'" />
      </view>
      <view class="settlement-numbers period-numbers">
        <view
          ><text class="detail-label">支付流水</text
          ><text class="detail-value">{{
            reconciliationAmount("successfulPaymentCents")
          }}</text></view
        >
        <view
          ><text class="detail-label">完成退款</text
          ><text class="detail-value">{{
            reconciliationAmount("completedRefundCents")
          }}</text></view
        >
        <view
          ><text class="detail-label">培训确认收入</text
          ><text class="detail-value">{{
            reconciliationAmount("trainingEffectiveRevenueCents")
          }}</text></view
        >
        <view
          ><text class="detail-label">联盟服务费</text
          ><text class="detail-value">{{
            reconciliationAmount("allianceCooperationFeeCents")
          }}</text></view
        >
        <view
          ><text class="detail-label">本日寄售应付净发生</text
          ><text class="detail-value">{{
            reconciliationAmount("consignmentPayableCents")
          }}</text></view
        >
        <view
          ><text class="detail-label">本日寄售已付结算</text
          ><text class="detail-value">{{
            reconciliationAmount("consignmentSettledPayableCents")
          }}</text></view
        >
      </view>
      <view v-if="reconciliation?.blockers?.length" class="blocker-list">
        <text
          v-for="blocker in reconciliation.blockers"
          :key="blocker.kind"
          class="blocker"
          >{{ blocker.message }}</text
        >
      </view>
      <text class="muted period-note"
        >只关已结束的营业日；当天数据保持实时。关账快照不可覆盖，未处理支付、退款、履约或消课等源业务会进入
        REVIEW；培训、联盟和寄售周期结算作为财务待办，不锁死每日关账。</text
      >
      <button
        v-if="canFinanceAction && reconciliation?.status !== 'LOCKED'"
        class="primary period-close"
        :disabled="loading || Boolean(actionKey)"
        @tap="closeBusinessDay"
      >
        {{
          acting(`reconciliation-close:${closeBusinessPeriod().date}`)
            ? "提交中…"
            : reconciliation?.blocked
              ? "提交复核"
              : "核对并关账"
        }}
      </button>
      <view v-else-if="reconciliation?.status === 'LOCKED'" class="locked-note"
        >该营业日已锁定，重复刷新不会产生新的关账记录。</view
      >
    </view>

    <view class="section-title">联盟结算草稿</view>
    <text class="section-description"
      >先选择商户生成周期草稿；草稿金额来自唯一券核销归因，不能用手工预估替代。</text
    >
    <view v-if="loadErrors.merchants" class="notice error card">{{
      loadErrors.merchants
    }}</view>
    <view
      v-for="merchant in merchants"
      :key="merchant.id"
      class="card merchant-row"
    >
      <view class="workflow-main">
        <text class="order-title">{{ merchant.name }}</text>
        <text class="muted"
          >{{ merchant.code || merchant.category || "联盟商户" }} ·
          仅统计已核销归因</text
        >
      </view>
      <button
        class="secondary inline"
        :disabled="loading || Boolean(actionKey) || !canFinanceAction"
        @tap="createSettlement(merchant)"
      >
        {{
          acting(`settlement-create:${merchant.id}`) ? "生成中…" : "生成草稿"
        }}
      </button>
    </view>
    <view v-if="loading && !merchants.length" class="empty card"
      >正在同步联盟商户…</view
    >
    <view
      v-if="!loading && !loadErrors.merchants && !merchants.length"
      class="empty card"
      >当前没有可结算联盟商户</view
    >

    <view class="section-title">
      联盟结算单
      <text class="section-note">{{
        loading ? "同步中" : `${settlements.length} 张`
      }}</text>
    </view>
    <view v-if="loadErrors.settlements" class="notice error card">
      <text>{{ loadErrors.settlements }}</text>
      <button class="ghost retry" :disabled="loading" @tap="refresh">
        重试
      </button>
    </view>
    <view v-if="loading && !settlements.length" class="empty card"
      >正在同步结算状态…</view
    >
    <view
      v-for="settlement in settlements"
      :id="opsDeepLinkDomId('finance-alliance-settlement', settlement.id)"
      :key="settlement.id"
      class="card workflow-card settlement-card"
      :class="{ 'deep-link-target': focusedRecord === `finance-alliance-settlement:${settlement.id}` }"
    >
      <view class="workflow-head">
        <view class="workflow-main">
          <text class="order-title">{{ settlementMerchant(settlement) }}</text>
          <text class="muted">{{ settlementPeriod(settlement) }}</text>
        </view>
        <text
          class="state-chip"
          :class="`state-${String(settlement.status || '').toLowerCase()}`"
          >{{ settlementStatusLabel(settlement.status) }}</text
        >
      </view>
      <view class="settlement-numbers">
        <view
          ><text class="detail-label">发放 / 领取 / 核销</text
          ><text class="detail-value"
            >{{ settlement.issuedCount || 0 }} /
            {{ settlement.claimedCount || 0 }} /
            {{ settlement.redeemedCount || 0 }}</text
          ></view
        >
        <view
          ><text class="detail-label">有效新客</text
          ><text class="detail-value"
            >{{ settlement.effectiveNewCustomers || 0 }} 人</text
          ></view
        >
        <view
          ><text class="detail-label">归因 GMV</text
          ><text class="detail-value">{{
            money(settlement.attributedGmvCents)
          }}</text></view
        >
        <view
          ><text class="detail-label">归因毛利</text
          ><text class="detail-value">{{
            money(settlement.attributedGrossProfitCents)
          }}</text></view
        >
        <view
          ><text class="detail-label">应结服务费</text
          ><text class="detail-value money">{{
            money(settlement.cooperationFeeCents)
          }}</text></view
        >
        <view
          ><text class="detail-label">ROI</text
          ><text class="detail-value">{{ ratio(settlement.roi) }}</text></view
        >
      </view>
      <view class="state-guidance">
        <text>{{ settlementHint(settlement) }}</text>
        <text v-if="workflowNote(settlement)" class="muted workflow-note">{{
          workflowNote(settlement)
        }}</text>
      </view>
      <view v-if="settlementHasAction(settlement)" class="action-row">
        <button
          v-if="settlement.status === 'DRAFT' && canFinanceAction"
          class="primary action-button"
          :disabled="loading || Boolean(actionKey)"
          @tap="submitSettlement(settlement)"
        >
          {{
            acting(`settlement-submit:${settlement.id}`)
              ? "提交中…"
              : "提交商户确认"
          }}
        </button>
        <button
          v-if="
            settlement.status === 'PENDING_CONFIRMATION' && canMerchantAction
          "
          class="primary action-button"
          :disabled="loading || Boolean(actionKey)"
          @tap="confirmSettlement(settlement)"
        >
          {{
            acting(`settlement-confirm:${settlement.id}`)
              ? "确认中…"
              : "确认账单"
          }}
        </button>
        <button
          v-if="
            settlement.status === 'PENDING_CONFIRMATION' && canMerchantAction
          "
          class="danger action-button"
          :disabled="loading || Boolean(actionKey)"
          @tap="disputeSettlement(settlement)"
        >
          {{
            acting(`settlement-dispute:${settlement.id}`)
              ? "提交中…"
              : "提出争议"
          }}
        </button>
        <button
          v-if="settlement.status === 'CONFIRMED' && canFinanceAction"
          class="primary action-button"
          :disabled="loading || Boolean(actionKey)"
          @tap="settleSettlement(settlement)"
        >
          {{
            acting(`settlement-settle:${settlement.id}`)
              ? "入账中…"
              : "确认结算入账"
          }}
        </button>
      </view>
    </view>
    <view
      v-if="!loading && !loadErrors.settlements && !settlements.length"
      class="empty card"
      >当前没有联盟结算单，可先从商户生成草稿</view
    >

    <view class="card boundary">
      <text class="muted"
        >岗位边界：库存管理员维护供应商、寄售规则与 SKU
        归属；财务负责退款复核、结算制单与最终入账，且制单人不能复核或付款自己的单据。前台签到、教练消课、商户券码核销均由原岗位完成，财务不越权代办。</text
      >
    </view>
  </OperationsFrame>
</template>

<style scoped>
.metric-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 14rpx;
  margin-top: 22rpx;
}
.sync-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18rpx;
  margin-top: 20rpx;
  padding: 20rpx 24rpx;
}
.sync-title {
  display: block;
  margin-bottom: 6rpx;
  font-size: 27rpx;
  font-weight: 800;
}
.export-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18rpx;
  margin-top: 16rpx;
  padding: 20rpx 24rpx;
}
.export-actions {
  display: flex;
  flex: 0 0 auto;
  flex-wrap: wrap;
  justify-content: flex-end;
  max-width: 100%;
  gap: 10rpx;
}
.notice {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14rpx;
  margin-top: 16rpx;
  line-height: 1.6;
}
.success {
  color: #17653d;
  background: #e8f4eb;
}
.error {
  color: #8a3636;
  background: #fbeaea;
}
.reconciliation {
  margin-top: 22rpx;
}
.reconciliation .row {
  padding: 14rpx 0;
  border-bottom: 1rpx solid #edf0ed;
}
.guardrail {
  display: block;
  margin-top: 16rpx;
  line-height: 1.6;
}
.inline-error {
  display: block;
  margin-top: 14rpx;
  color: #a24c35;
  font-size: 22rpx;
}
.section-note {
  color: #758079;
  font-size: 22rpx;
  font-weight: 400;
}
.section-description {
  display: block;
  margin: -10rpx 2rpx 12rpx;
  color: #758079;
  font-size: 22rpx;
  line-height: 1.55;
}
.section-subtitle {
  margin: 24rpx 2rpx 10rpx;
  color: #52635a;
  font-size: 24rpx;
  font-weight: 800;
}
.workflow-card {
  margin-top: 14rpx;
  padding: 24rpx;
}
.workflow-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16rpx;
}
.workflow-main {
  min-width: 0;
  flex: 1;
}
.order-title {
  display: block;
  margin-bottom: 8rpx;
  font-size: 28rpx;
  font-weight: 800;
}
.status-block {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 7rpx;
}
.status-note {
  max-width: 220rpx;
  color: #758079;
  font-size: 19rpx;
  line-height: 1.35;
  text-align: right;
}
.detail-grid,
.settlement-numbers {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 14rpx;
  margin-top: 20rpx;
  padding-top: 18rpx;
  border-top: 1rpx solid #edf0ed;
}
.settlement-numbers {
  grid-template-columns: repeat(3, 1fr);
}
.detail-label {
  display: block;
  color: #7a857e;
  font-size: 20rpx;
}
.detail-value {
  display: block;
  margin-top: 6rpx;
  color: #26332b;
  font-size: 24rpx;
  font-weight: 700;
}
.danger-money {
  color: #a24c35;
}
.reason-box,
.state-guidance {
  margin-top: 18rpx;
  padding: 16rpx;
  background: #f4f7f4;
  border-radius: 14rpx;
}
.reason-text {
  display: block;
  margin-top: 7rpx;
  color: #38473e;
  font-size: 23rpx;
  line-height: 1.55;
}
.state-guidance {
  color: #52635a;
  font-size: 22rpx;
  line-height: 1.55;
}
.workflow-note {
  display: block;
  margin-top: 6rpx;
}
.action-row {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 12rpx;
  margin-top: 20rpx;
}
.action-button {
  min-width: 176rpx;
  min-height: 64rpx;
  margin: 0;
  padding: 0 20rpx;
  line-height: 64rpx;
  font-size: 22rpx;
}
.danger {
  color: #8a3636;
  background: #fbeaea;
  border: 1rpx solid #efcaca;
}
.merchant-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14rpx;
  margin-top: 12rpx;
  padding: 20rpx 24rpx;
}
.inline {
  min-width: 116rpx;
  min-height: 58rpx;
  margin: 0;
  padding: 0 16rpx;
  line-height: 58rpx;
  font-size: 22rpx;
}
.retry {
  min-width: 92rpx;
  min-height: 50rpx;
  margin: 0;
  padding: 0 14rpx;
  color: #8a3636;
  line-height: 50rpx;
  font-size: 20rpx;
}
.ghost {
  background: #eef2ef;
}
.state-chip {
  flex: 0 0 auto;
  padding: 8rpx 14rpx;
  color: #56645b;
  background: #eef2ef;
  border-radius: 999rpx;
  font-size: 21rpx;
}
.state-pending_confirmation,
.state-draft {
  color: #9b6300;
  background: #fff2d6;
}
.state-confirmed,
.state-settled {
  color: #17653d;
  background: #e5f3e9;
}
.state-void {
  color: #8a3636;
  background: #fbeaea;
}
.empty {
  margin-top: 14rpx;
  color: #758079;
  text-align: center;
}
.boundary {
  margin-top: 26rpx;
  line-height: 1.7;
}
.reconciliation-period {
  margin-top: 14rpx;
}
.period-numbers {
  margin-top: 16rpx;
}
.blocker-list {
  display: flex;
  flex-direction: column;
  gap: 8rpx;
  margin-top: 16rpx;
  padding: 14rpx 16rpx;
  background: #fff4d8;
  border-radius: 14rpx;
}
.blocker {
  color: #8a5d12;
  font-size: 21rpx;
  line-height: 1.45;
}
.period-note {
  display: block;
  margin-top: 16rpx;
  line-height: 1.55;
}
.period-close {
  width: 100%;
  margin-top: 18rpx;
}
.locked-note {
  margin-top: 18rpx;
  padding: 14rpx;
  color: #17653d;
  background: #e8f4eb;
  border-radius: 14rpx;
  font-size: 22rpx;
  text-align: center;
}
.training-settlement-tools {
  margin-top: 14rpx;
  padding: 22rpx 24rpx;
}
.period-picker-row {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 14rpx;
}
.picker-field {
  padding: 16rpx;
  background: #f4f7f4;
  border-radius: 14rpx;
}
.supplier-create-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14rpx;
  margin-top: 18rpx;
  padding-top: 18rpx;
  border-top: 1rpx solid #edf0ed;
}
.embedded-empty {
  margin-top: 18rpx;
  padding-top: 18rpx;
  color: #758079;
  border-top: 1rpx solid #edf0ed;
  font-size: 22rpx;
  line-height: 1.55;
  text-align: center;
}
.training-tool-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14rpx;
  margin-top: 18rpx;
}
.filter-button {
  padding: 14rpx 18rpx;
  border-radius: 12rpx;
  font-size: 22rpx;
}
.training-create {
  min-width: 190rpx;
}
button[disabled] {
  opacity: 0.5;
}
.deep-link-target {
  border-color: #d69a24 !important;
  box-shadow: 0 0 0 4rpx rgba(214, 154, 36, 0.18);
}

@media (max-width: 430px) {
  .export-bar {
    align-items: stretch;
    flex-direction: column;
  }

  .export-actions {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    width: 100%;
  }

  .export-actions .inline {
    width: 100%;
    min-width: 0;
    height: auto;
    padding: 10rpx 12rpx;
    line-height: 1.3;
    white-space: normal;
  }
}
</style>
