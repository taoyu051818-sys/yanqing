<script setup lang="ts">
import { usePagedList } from "../../utils/paged-list";
import { useFinanceLoadingActions } from "./actions/loading.js";

import ReconciliationSummary from "./sections/ReconciliationSummary.vue";
import { canDirectRefund } from "../../../../utils/refund-action";
import { refundQueueSummary } from "./refund-queue-summary";
import RefundReview from "./sections/RefundReview.vue";
import AccountAdjustments from "./sections/AccountAdjustments.vue";
import TrainingSettlements from "./sections/TrainingSettlements.vue";
import ConsignmentPeriod from "./sections/ConsignmentPeriod.vue";
import ConsignmentPayables from "./sections/ConsignmentPayables.vue";
import ConsignmentStatements from "./sections/ConsignmentStatements.vue";
import ShiftVariances from "./sections/ShiftVariances.vue";
import BusinessDayClose from "./sections/BusinessDayClose.vue";
import AllianceMerchants from "./sections/AllianceMerchants.vue";
import AllianceStatements from "./sections/AllianceStatements.vue";

import { computed, nextTick, onUnmounted, ref, watch } from "vue";
import { onLoad, onShow } from "@dcloudio/uni-app";
import OperationsTabs from "../../components/OperationsTabs.vue";
import OperationsFrame from "../../components/OperationsFrame.vue";
import OperationTask from "../../components/OperationTask.vue";
import { useOperationTask, reasonField } from "../../components/operation-task";
import MetricCard from "../../components/MetricCard.vue";
import StatusBadge from "../../../../components/StatusBadge.vue";
import {
  visibleFinancePageExportScopes,
  type FinancePageExportScope,
} from "../../config/governance";
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
} from "../../utils/work-item-deep-link";
import type { LoadSource } from "./page-types.js";
import { useFinanceRefundsActions } from "./actions/refunds.js";
import { useFinanceTrainingActions } from "./actions/training.js";
import { useFinanceConsignmentActions } from "./actions/consignment.js";
import { useFinanceAllianceActions } from "./actions/alliance.js";
import { useFinanceReconciliationActions } from "./actions/reconciliation.js";
const task = useOperationTask();

const session = useSessionStore();

const dashboard = ref<Record<string, any> | null>(null);

const refundKeyword = ref("");
const refundQueue = usePagedList<any>((page, pageSize) => endpoints.adminOrders({ page, pageSize, status: "REFUND_PENDING", keyword: refundKeyword.value.trim() || undefined }), 20, () => refundKeyword.value.trim());
const orders = refundQueue.items;
const refundSummary = computed(() => refundQueueSummary(orders.value, refundQueue.total.value, loading.value || refundQueue.loading.value, refundQueue.error.value));

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
const financeView = ref('approvals');
const settlementView = ref('training');
const approvalView = ref('refunds');
const refundDetailId = ref('');
const refundDetailOrderId = ref('');
const refundDetail = ref<any>(null);
const refundDetailError = ref('');
const refundDetailLoading = ref(false);
const financeTabs = [{ key:'approvals', title:'审批' }, { key:'settlements', title:'结算' }, { key:'close', title:'日结' }, { key:'reports', title:'对账' }];
const settlementTabs = [{ key:'training', title:'培训' }, { key:'alliance', title:'联盟' }, { key:'consignment', title:'寄售' }];
const approvalTabs = computed(() => [{ key:'refunds', title:'退款申请' }, { key:'adjustments', title:'账户调整', count:adjustments.value.length }]);
function openRefund(refund: any) {
  uni.navigateTo({ url:`/packages/ops/pages/finance/index?focus=refund&id=${encodeURIComponent(refund.id)}&orderId=${encodeURIComponent(refund.order.id)}` });
}
watch(focusedRecord, value => {
  if (value.startsWith('finance-refund:')) { refundDetailId.value = value.slice('finance-refund:'.length); uni.setNavigationBarTitle({ title:'退款详情' }); }
  else if (value.startsWith('finance-adjustment:')) { financeView.value = 'approvals'; approvalView.value = 'adjustments'; }
  else if (value.startsWith('finance-training-settlement:')) { financeView.value = 'settlements'; settlementView.value = 'training'; }
  else if (value.startsWith('finance-consignment-settlement:')) { financeView.value = 'settlements'; settlementView.value = 'consignment'; }
  else if (value.startsWith('finance-alliance-settlement:')) { financeView.value = 'settlements'; settlementView.value = 'alliance'; }
  else if (value.startsWith('finance-shift:') || value === 'finance-reconciliation') financeView.value = 'close';
}, { flush:'sync' });

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
  const date = today(-1);
  const startsAt = new Date(`${date}T00:00:00+08:00`);
  return {
    date,
    periodStart: startsAt.toISOString(),
    periodEnd: new Date(startsAt.getTime() + 86_400_000).toISOString(),
  };
}

function actionErrorMessage(reason: unknown, fallback: string) {
  return reason instanceof Error && reason.message ? reason.message : fallback;
}

function refresh() {
  void load({ preserveMessage: true });
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

const {
  approveRefund,
  rejectRefund,
  reviewAdjustment,
  reviewShiftVariance,
  accountDelta,
  isOwnAdjustment,
  refundStatusNote,
} = useFinanceRefundsActions({
  task,
  load: (...args: Parameters<typeof load>) => load(...args),
  actionError,
  canFinanceAction,
  session,
});

const {
  onTrainingSettlementStatusChange,
  onTrainingPeriodStartChange,
  onTrainingPeriodEndChange,
  createTrainingSettlementDraft,
  trainingSettlementPeriod,
  trainingSettlementStatusLabel,
  isOwnTrainingSettlement,
  trainingSettlementLatestNote,
  changeTrainingSettlement,
} = useFinanceTrainingActions({
  session,
  trainingSettlementStatusIndex,
  refresh: (...args: Parameters<typeof refresh>) => refresh(...args),
  trainingPeriodStartDate,
  trainingPeriodEndDate,
  actionError,
  task,
  load: (...args: Parameters<typeof load>) => load(...args),
});

const {
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
} = useFinanceConsignmentActions({
  session,
  consignmentPeriodStartDate,
  consignmentPeriodEndDate,
  actionError,
  task,
  load: (...args: Parameters<typeof load>) => load(...args),
  consignmentSuppliers,
});

const {
  reviseSettlement,
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
} = useFinanceAllianceActions({
  businessPeriod: (...args: Parameters<typeof businessPeriod>) =>
    businessPeriod(...args),
  task,
  load: (...args: Parameters<typeof load>) => load(...args),
  runAction: (...args: Parameters<typeof runAction>) => runAction(...args),
  merchants,
  canFinanceAction,
  canMerchantAction,
});

const { closeBusinessDay, reconciliationStatusLabel, reconciliationAmount } =
  useFinanceReconciliationActions({
    canFinanceAction,
    closeBusinessPeriod: (...args: Parameters<typeof closeBusinessPeriod>) =>
      closeBusinessPeriod(...args),
    reconciliation,
    runAction: (...args: Parameters<typeof runAction>) => runAction(...args),
  });

const { sourceError, load: loadFinanceData, applyFinanceDeepLink } = useFinanceLoadingActions({
  loading,
  actionError,
  loadErrors,
  emptyLoadErrors: (...args: Parameters<typeof emptyLoadErrors>) =>
    emptyLoadErrors(...args),
  successMessage,
  session,
  businessPeriod: (...args: Parameters<typeof businessPeriod>) =>
    businessPeriod(...args),
  closeBusinessPeriod: (...args: Parameters<typeof closeBusinessPeriod>) =>
    closeBusinessPeriod(...args),
  canFinanceAction,
  trainingSettlementStatusOptions,
  trainingSettlementStatusIndex,
  dashboard,
  orders,
  loadRefundOrders: refundQueue.load,
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
  actionErrorMessage: (...args: Parameters<typeof actionErrorMessage>) =>
    actionErrorMessage(...args),
  deepLinkHandled,
  deepLinkQuery,
  activeRefunds,
  unreviewedShiftVariances,
  focusedRecord,
});

let detailRequest = 0;
const detailScope = () => `${session.user?.id || ''}:${session.roles.join(',')}`;
watch(detailScope, () => { detailRequest++; refundDetail.value = null; refundDetailError.value = ''; refundDetailLoading.value = false; }, { flush:'sync' });
onUnmounted(() => { detailRequest++; });
async function load(options: { preserveMessage?: boolean } = {}) {
  await session.hydrate();
  const request = ++detailRequest;
  refundDetail.value = null;
  refundDetailError.value = '';
  await loadFinanceData(options);
  if (request !== detailRequest || !refundDetailId.value || !canFinanceAction.value) return;
  const actor = detailScope(), id = refundDetailId.value;
  const current = () => request === detailRequest && actor === detailScope();
  refundDetailLoading.value = true;
  try {
    const cached = allRefunds.value.find(item => item.id === id);
    const orderId = refundDetailOrderId.value || cached?.order?.id;
    if (!orderId) throw new Error('未找到退款对应的订单，请返回列表重试。');
    refundDetailOrderId.value = orderId;
    const order = await endpoints.order(orderId);
    if (!current()) return;
    const refund = (order.refunds || []).find((item: any) => item.id === id);
    if (!refund) throw new Error('该退款记录已不可用，请返回列表刷新。');
    refundDetail.value = { ...refund, order };
  } catch (cause: any) { if (current()) refundDetailError.value = cause?.message || '退款详情加载失败，请重试。'; }
  finally { if (current()) refundDetailLoading.value = false; }
}

onLoad((options) => {
  if (options?.focus === 'refund') { refundDetailId.value = String(options.id || options.refundId || ''); refundDetailOrderId.value = String(options.orderId || ''); uni.setNavigationBarTitle({ title:'退款详情' }); }
  if (typeof options?.view === 'string' && financeTabs.some(tab => tab.key === options.view)) financeView.value = options.view;
  deepLinkQuery.value = parseOpsDeepLinkQuery(options);
  if (refundDetailId.value && refundDetailOrderId.value) deepLinkHandled.value = true;
});

onShow(() => {
  void load();
});
</script>

<template>
  <OperationsFrame
    access="finance"
    icon="finance"
    title="财务结算"
    eyebrow="FINANCE & RECONCILIATION"
    :role="roleLabel"
    description="以营业日期为边界核对收入、退款、培训分成、联盟结算和寄售供应商应付；每个财务动作都有状态、原因和复核责任。"
  >
    <OperationTask :task="task" />
    <OperationsTabs v-if="!refundDetailId" v-model="financeView" :items="financeTabs" label="财务分类" />
    <OperationsTabs v-if="!refundDetailId && financeView === 'settlements'" v-model="settlementView" :items="settlementTabs" label="结算业务" />
    <OperationsTabs v-if="!refundDetailId && financeView === 'approvals'" v-model="approvalView" :items="approvalTabs" label="审批分类" />
    <view v-if="financeView === 'reports' && !refundDetailId" class="metric-grid">
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

    <view v-if="financeView === 'reports' && !refundDetailId && visibleExportScopes.length" class="card export-bar">
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

    <ReconciliationSummary
      v-if="financeView === 'reports' && !refundDetailId"
      :dashboard="dashboard"
      :training="training"
      :loadErrors="loadErrors"
    />

    <view v-if="financeView === 'approvals' && approvalView === 'refunds' && !refundDetailId" class="card"><view class="section-title">查找退款</view><input v-model="refundKeyword" class="input" maxlength="50" placeholder="订单号、会员姓名或订单标题" confirm-type="search" @confirm="refundQueue.refresh()" /><button class="secondary" :disabled="refundQueue.loading.value" @tap="refundQueue.refresh()">查询</button><text v-if="refundQueue.error.value" class="muted">{{ refundQueue.error.value }}</text></view>
    <view v-if="refundDetailError" class="notice error card" role="alert"><text>{{ refundDetailError }}</text><button :disabled="refundDetailLoading" @tap="load()">重试详情</button></view>
    <RefundReview
      v-if="refundDetailId || (financeView === 'approvals' && approvalView === 'refunds')"
      :detail-id="refundDetailId"
      :detail-refund="refundDetail"
      @open="openRefund"
      :loading="loading || refundDetailLoading || refundQueue.loading.value"
      :summary="refundSummary"
      :direct="canDirectRefund(session.roles)"
      :reviewRefunds="reviewRefunds"
      :loadErrors="{ ...loadErrors, refunds: refundQueue.error.value }"
      :refresh="refresh"
      :activeRefunds="activeRefunds"
      :focusedRecord="focusedRecord"
      :refundStatusNote="refundStatusNote"
      :actionKey="actionKey"
      :approveRefund="approveRefund"
      :acting="acting"
      :isForcedSystemRefund="isForcedSystemRefund"
      :rejectRefund="rejectRefund"
    />

    <button v-if="!refundDetailId && financeView === 'approvals' && approvalView === 'refunds' && orders.length < refundQueue.total.value" class="secondary" :loading="refundQueue.loading.value" :disabled="refundQueue.loading.value" @tap="refundQueue.more()">继续加载退款申请</button>

    <AccountAdjustments
      v-if="!refundDetailId && financeView === 'approvals' && approvalView === 'adjustments' && canFinanceAction"
      :canFinanceAction="canFinanceAction"
      :loading="loading"
      :adjustments="adjustments"
      :loadErrors="loadErrors"
      :refresh="refresh"
      :focusedRecord="focusedRecord"
      :accountDelta="accountDelta"
      :isOwnAdjustment="isOwnAdjustment"
      :actionKey="actionKey"
      :reviewAdjustment="reviewAdjustment"
      :acting="acting"
    />

    <TrainingSettlements :direct="canDirectRefund(session.roles)"
      v-if="!refundDetailId && financeView === 'settlements' && settlementView === 'training'"
      :loading="loading"
      :trainingSettlements="trainingSettlements"
      :trainingPeriodStartDate="trainingPeriodStartDate"
      :onTrainingPeriodStartChange="onTrainingPeriodStartChange"
      :trainingPeriodEndDate="trainingPeriodEndDate"
      :onTrainingPeriodEndChange="onTrainingPeriodEndChange"
      :trainingSettlementStatusOptions="trainingSettlementStatusOptions"
      :trainingSettlementStatusIndex="trainingSettlementStatusIndex"
      :onTrainingSettlementStatusChange="onTrainingSettlementStatusChange"
      :actionKey="actionKey"
      :createTrainingSettlementDraft="createTrainingSettlementDraft"
      :acting="acting"
      :loadErrors="loadErrors"
      :refresh="refresh"
      :focusedRecord="focusedRecord"
      :trainingSettlementPeriod="trainingSettlementPeriod"
      :trainingSettlementStatusLabel="trainingSettlementStatusLabel"
      :trainingSettlementLatestNote="trainingSettlementLatestNote"
      :isOwnTrainingSettlement="isOwnTrainingSettlement"
      :changeTrainingSettlement="changeTrainingSettlement"
    />

    <ConsignmentPeriod
      v-if="!refundDetailId && financeView === 'settlements' && settlementView === 'consignment'"
      :loading="loading"
      :consignmentPayables="consignmentPayables"
      :consignmentSettlements="consignmentSettlements"
      :consignmentPeriodStartDate="consignmentPeriodStartDate"
      :onConsignmentPeriodStartChange="onConsignmentPeriodStartChange"
      :consignmentPeriodEndDate="consignmentPeriodEndDate"
      :onConsignmentPeriodEndChange="onConsignmentPeriodEndChange"
      :loadErrors="loadErrors"
      :activeConsignmentSuppliers="activeConsignmentSuppliers"
      :consignmentSupplierRule="consignmentSupplierRule"
      :actionKey="actionKey"
      :createConsignmentSettlementDraft="createConsignmentSettlementDraft"
      :acting="acting"
    />

    <ConsignmentPayables
      v-if="!refundDetailId && financeView === 'settlements' && settlementView === 'consignment'"
      :loadErrors="loadErrors"
      :loading="loading"
      :refresh="refresh"
      :consignmentPayables="consignmentPayables"
      :payableAssignment="payableAssignment"
    />

    <ConsignmentStatements :direct="canDirectRefund(session.roles)"
      v-if="!refundDetailId && financeView === 'settlements' && settlementView === 'consignment'"
      :loadErrors="loadErrors"
      :loading="loading"
      :refresh="refresh"
      :consignmentSettlements="consignmentSettlements"
      :focusedRecord="focusedRecord"
      :consignmentSupplierName="consignmentSupplierName"
      :consignmentSettlementPeriod="consignmentSettlementPeriod"
      :consignmentSettlementStatusLabel="consignmentSettlementStatusLabel"
      :consignmentLatestTransition="consignmentLatestTransition"
      :actionKey="actionKey"
      :changeConsignmentSettlement="changeConsignmentSettlement"
      :acting="acting"
    />

    <ShiftVariances
      v-if="!refundDetailId && financeView === 'close'"
      :loading="loading"
      :unreviewedShiftVariances="unreviewedShiftVariances"
      :loadErrors="loadErrors"
      :refresh="refresh"
      :focusedRecord="focusedRecord"
      :session="session"
      :actionKey="actionKey"
      :reviewShiftVariance="reviewShiftVariance"
      :acting="acting"
    />

    <BusinessDayClose
      v-if="!refundDetailId && financeView === 'close'"
      :loadErrors="loadErrors"
      :loading="loading"
      :refresh="refresh"
      :focusedRecord="focusedRecord"
      :closeBusinessPeriod="closeBusinessPeriod"
      :reconciliationStatusLabel="reconciliationStatusLabel"
      :reconciliation="reconciliation"
      :reconciliationAmount="reconciliationAmount"
      :canFinanceAction="canFinanceAction"
      :actionKey="actionKey"
      :closeBusinessDay="closeBusinessDay"
      :acting="acting"
    />

    <AllianceMerchants
      v-if="!refundDetailId && financeView === 'settlements' && settlementView === 'alliance'"
      :loadErrors="loadErrors"
      :merchants="merchants"
      :loading="loading"
      :actionKey="actionKey"
      :canFinanceAction="canFinanceAction"
      :createSettlement="createSettlement"
      :acting="acting"
    />

    <AllianceStatements
      v-if="!refundDetailId && financeView === 'settlements' && settlementView === 'alliance'"
      :loading="loading"
      :settlements="settlements"
      :loadErrors="loadErrors"
      :refresh="refresh"
      :focusedRecord="focusedRecord"
      :settlementMerchant="settlementMerchant"
      :settlementPeriod="settlementPeriod"
      :settlementStatusLabel="settlementStatusLabel"
      :ratio="ratio"
      :settlementHint="settlementHint"
      :workflowNote="workflowNote"
      :settlementHasAction="settlementHasAction"
      :canFinanceAction="canFinanceAction"
      :actionKey="actionKey"
      :submitSettlement="submitSettlement"
      :reviseSettlement="reviseSettlement"
      :acting="acting"
      :canMerchantAction="canMerchantAction"
      :confirmSettlement="confirmSettlement"
      :disputeSettlement="disputeSettlement"
      :settleSettlement="settleSettlement"
    />

  </OperationsFrame>
</template>

<style scoped src="./page.css"></style>

<style scoped>
.sync-bar.card { display:flex; padding:16rpx 20rpx; margin:0 0 20rpx; border:0; background:transparent; }.sync-title { display:none; }.sync-bar .muted { font-size:24rpx; }.notice.error { position:sticky; top:0; z-index:15; }
</style>
