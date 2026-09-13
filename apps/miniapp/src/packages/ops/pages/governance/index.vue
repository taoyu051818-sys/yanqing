<script setup lang="ts">
import UserGovernance from "./sections/UserGovernance.vue";
import ParameterGovernance from "./sections/ParameterGovernance.vue";
import RiskGovernance from "./sections/RiskGovernance.vue";
import AuditHistory from "./sections/AuditHistory.vue";
import PrivacyRequests from "./sections/PrivacyRequests.vue";
import ReportExport from "./sections/ReportExport.vue";

import { computed, reactive, ref } from "vue";
import { onLoad, onShow } from "@dcloudio/uni-app";
import OperationsFrame from "../../components/OperationsFrame.vue";
import SectionEmpty from "../../../../components/SectionEmpty.vue";
import StatusBadge from "../../../../components/StatusBadge.vue";
import {
  businessParameterCatalog,
  businessParameterLabel,
  businessPeriodOptions,
  formatBusinessParameterValue,
  parseBusinessParameterValue,
  visibleGovernanceExportScopes,
  visibleGovernanceTabs,
  type GovernanceTab,
} from "../../config/governance";
import { hasOperationsAccess } from "../../../../config/operations";
import { endpoints } from "../../../../services/api";
import { isMockMode } from "../../../../services/http";
import { useSessionStore } from "../../../../stores/session";
import type { AppRole } from "../../../../types/domain";
import { shortDate } from "../../../../utils/format";
import { withPendingCreationKey } from "../../../../utils/pending-creation-key";

const session = useSessionStore();
const loading = ref(false);
const acting = ref("");
const error = ref("");
const activeTab = ref<GovernanceTab>("users");
const users = ref<any[]>([]);
const parameters = ref<any[]>([]);
const risks = ref<any[]>([]);
const auditLogs = ref<any[]>([]);
const erasureRequests = ref<any[]>([]);
const erasureBlockers = reactive<Record<string, any[]>>({});
const erasureReasons = reactive<Record<string, string>>({});
const userKeyword = ref("");
const selectedUserId = ref("");
const selectedRoles = ref<AppRole[]>([]);
const primaryRole = ref<AppRole>("MEMBER");
const merchantId = ref("");
const merchantChoices = ref<any[]>([]);
const roleReason = ref("");
const auditObjectType = ref("");
const riskReasons = reactive<Record<string, string>>({});

const initialEffectiveAt = new Date(Date.now() + 60 * 60 * 1000);
const parameterForm = reactive({
  key: businessParameterCatalog[0].key,
  scalar: "",
  earlyMinutes: "",
  lateMinutes: "",
  periods: ["EARLY", "DAYTIME"] as string[],
  reason: "",
  effectiveDate: `${initialEffectiveAt.getFullYear()}-${String(initialEffectiveAt.getMonth() + 1).padStart(2, "0")}-${String(initialEffectiveAt.getDate()).padStart(2, "0")}`,
  effectiveTime: `${String(initialEffectiveAt.getHours()).padStart(2, "0")}:${String(initialEffectiveAt.getMinutes()).padStart(2, "0")}`,
  locked: false,
});

const roleOptions: Array<{ value: AppRole; label: string }> = [
  { value: "MEMBER", label: "会员" },
  { value: "FRONT_DESK", label: "前台" },
  { value: "COACH", label: "教练" },
  { value: "HOST", label: "主理人" },
  { value: "EVENT_MANAGER", label: "赛事管理员" },
  { value: "MERCHANT", label: "联盟商户" },
  { value: "FINANCE", label: "财务" },
  { value: "ADMIN", label: "管理员" },
  { value: "SUPER_ADMIN", label: "超级管理员" },
];

const visibleTabs = computed(() => visibleGovernanceTabs(session.roles));
const exportScopes = computed(() =>
  visibleGovernanceExportScopes(session.roles),
);
const canSuperviseUsers = computed(() => session.roles.includes("SUPER_ADMIN"));
const canConfigure = computed(() =>
  session.roles.some((role) => ["ADMIN", "SUPER_ADMIN"].includes(role)),
);
const canResolveRisk = computed(() =>
  session.roles.some((role) => ["ADMIN", "SUPER_ADMIN"].includes(role)),
);
const canCompleteErasure = computed(() =>
  session.roles.includes("SUPER_ADMIN"),
);
const selectedParameterDefinition = computed(
  () =>
    businessParameterCatalog.find((item) => item.key === parameterForm.key) ||
    businessParameterCatalog[0],
);
const selectedUser = computed(() =>
  users.value.find((item) => item.id === selectedUserId.value),
);
const availablePrimaryRoles = computed(() =>
  roleOptions.filter((item) => selectedRoles.value.includes(item.value)),
);

function unwrapItems(value: any) {
  if (Array.isArray(value)) return value;
  return Array.isArray(value?.items) ? value.items : [];
}

function roleLabel(role: string) {
  return roleOptions.find((item) => item.value === role)?.label || role;
}

function selectUser(user: any) {
  selectedUserId.value = user.id;
  selectedRoles.value = [
    ...new Set([
      user.primaryRole,
      ...(user.roles || []).map((item: any) => item.role),
    ]),
  ] as AppRole[];
  primaryRole.value = user.primaryRole;
  merchantId.value =
    user.roles?.find((item: any) => item.role === "MERCHANT")?.merchantId || "";
  roleReason.value = "";
}

function toggleRole(role: AppRole) {
  if (!canSuperviseUsers.value) return;
  if (selectedRoles.value.includes(role)) {
    if (selectedRoles.value.length === 1 || role === primaryRole.value) {
      uni.showToast({
        title:
          role === primaryRole.value ? "请先切换主角色" : "至少保留一个角色",
        icon: "none",
      });
      return;
    }
    selectedRoles.value = selectedRoles.value.filter((item) => item !== role);
  } else {
    selectedRoles.value = [...selectedRoles.value, role];
  }
}

function onPrimaryRoleChange(event: any) {
  const option = availablePrimaryRoles.value[Number(event.detail.value)];
  if (option) primaryRole.value = option.value;
}

function changeParameterDefinition(event: any) {
  const definition = businessParameterCatalog[Number(event.detail.value)];
  if (!definition) return;
  parameterForm.key = definition.key;
  parameterForm.scalar = "";
  parameterForm.earlyMinutes = "";
  parameterForm.lateMinutes = "";
  parameterForm.periods =
    definition.kind === "PERIODS" ? ["EARLY", "DAYTIME"] : [];
}

function toggleParameterPeriod(period: string) {
  parameterForm.periods = parameterForm.periods.includes(period)
    ? parameterForm.periods.filter((item) => item !== period)
    : [...parameterForm.periods, period];
}

async function loadCurrentTab() {
  if (!hasOperationsAccess(session.roles, "governance")) return;
  loading.value = true;
  error.value = "";
  try {
    if (activeTab.value === "users") {
      merchantChoices.value = canSuperviseUsers.value
        ? (await endpoints.merchants()).filter(
            (item: any) => item.status === "ACTIVE",
          )
        : [];
      users.value = unwrapItems(
        await endpoints.governanceUsers({
          page: 1,
          pageSize: 100,
          keyword: userKeyword.value || undefined,
        }),
      );
      if (
        !users.value.some((item) => item.id === selectedUserId.value) &&
        users.value[0]
      )
        selectUser(users.value[0]);
    } else if (activeTab.value === "parameters") {
      parameters.value = unwrapItems(await endpoints.parameters());
    } else if (activeTab.value === "risks") {
      risks.value = unwrapItems(
        await endpoints.riskEvents({ page: 1, pageSize: 100 }),
      );
    } else if (activeTab.value === "audit") {
      auditLogs.value = unwrapItems(
        await endpoints.auditLogs({
          page: 1,
          pageSize: 100,
          objectType: auditObjectType.value || undefined,
        }),
      );
    } else if (activeTab.value === "privacy") {
      erasureRequests.value = unwrapItems(
        await endpoints.dataErasureRequests({ page: 1, pageSize: 100 }),
      );
    }
  } catch (cause: any) {
    error.value = cause?.message || "治理数据加载失败";
  } finally {
    loading.value = false;
  }
}

async function switchTab(tab: GovernanceTab) {
  activeTab.value = tab;
  await loadCurrentTab();
}

async function saveRoles() {
  if (!selectedUser.value || !canSuperviseUsers.value) return;
  if (roleReason.value.trim().length < 2) {
    uni.showToast({ title: "请填写角色变更原因", icon: "none" });
    return;
  }
  if (selectedRoles.value.includes("MERCHANT") && !merchantId.value.trim()) {
    uni.showToast({ title: "商户角色必须填写商户 ID", icon: "none" });
    return;
  }
  const confirm = await uni.showModal({
    title: "确认角色变更",
    content: `将 ${selectedUser.value.displayName} 的主角色设为${roleLabel(primaryRole.value)}，操作将写入审计。`,
  });
  if (!confirm.confirm) return;
  acting.value = `roles:${selectedUser.value.id}`;
  try {
    const command = {
      roles: selectedRoles.value,
      primaryRole: primaryRole.value,
      merchantId: selectedRoles.value.includes("MERCHANT")
        ? merchantId.value.trim()
        : undefined,
      reason: roleReason.value.trim(),
    };
    await withPendingCreationKey(
      `governance.user.roles.${selectedUser.value.id}`,
      command,
      (idempotencyKey) =>
        endpoints.setGovernanceUserRoles(selectedUser.value.id, {
          ...command,
          idempotencyKey,
        }),
    );
    uni.showToast({ title: "角色已更新", icon: "success" });
    await loadCurrentTab();
  } catch (cause: any) {
    uni.showToast({ title: cause?.message || "角色更新失败", icon: "none" });
  } finally {
    acting.value = "";
  }
}

async function changeUserStatus(status: "ACTIVE" | "DISABLED") {
  if (!selectedUser.value || !canSuperviseUsers.value) return;
  if (roleReason.value.trim().length < 2) {
    uni.showToast({ title: "请填写状态变更原因", icon: "none" });
    return;
  }
  const confirm = await uni.showModal({
    title: status === "ACTIVE" ? "确认启用" : "确认停用",
    content: `${selectedUser.value.displayName} ${status === "ACTIVE" ? "将恢复登录" : "将立即失去登录能力"}。`,
  });
  if (!confirm.confirm) return;
  acting.value = `status:${selectedUser.value.id}`;
  try {
    const command = { status, reason: roleReason.value.trim() };
    await withPendingCreationKey(
      `governance.user.status.${selectedUser.value.id}`,
      command,
      (idempotencyKey) =>
        endpoints.setGovernanceUserStatus(selectedUser.value.id, {
          ...command,
          idempotencyKey,
        }),
    );
    uni.showToast({
      title: status === "ACTIVE" ? "已启用" : "已停用",
      icon: "success",
    });
    await loadCurrentTab();
  } catch (cause: any) {
    uni.showToast({ title: cause?.message || "状态更新失败", icon: "none" });
  } finally {
    acting.value = "";
  }
}

async function createParameter() {
  if (!canConfigure.value) return;
  const definition = selectedParameterDefinition.value;
  if (
    !definition ||
    parameterForm.reason.trim().length < 2 ||
    !parameterForm.effectiveDate ||
    !parameterForm.effectiveTime
  ) {
    uni.showToast({
      title: "请选择业务规则并填写变更原因和生效时间",
      icon: "none",
    });
    return;
  }
  let value: unknown;
  try {
    value = parseBusinessParameterValue(definition, parameterForm);
  } catch (cause: any) {
    uni.showToast({ title: cause?.message || "参数值格式错误", icon: "none" });
    return;
  }
  const effectiveFrom = new Date(
    `${parameterForm.effectiveDate}T${parameterForm.effectiveTime}:00+08:00`,
  );
  if (Number.isNaN(effectiveFrom.getTime())) {
    uni.showToast({ title: "生效日期或时间不正确", icon: "none" });
    return;
  }
  const reason = parameterForm.reason.trim(), locked = parameterForm.locked;
  const confirm = await uni.showModal({
    title: "发布参数版本",
    content: `${definition.label}：${formatBusinessParameterValue(definition.key, value)}。生效时间：${parameterForm.effectiveDate} ${parameterForm.effectiveTime}（北京时间）。新订单按此版本执行，历史订单保留原快照。`,
  });
  if (!confirm.confirm) return;
  acting.value = "parameter";
  try {
    await endpoints.createParameter({
      key: definition.key,
      value,
      type: definition.type,
      description: definition.description,
      reason,
      effectiveFrom: effectiveFrom.toISOString(),
      locked,
    });
    parameterForm.scalar = "";
    parameterForm.earlyMinutes = "";
    parameterForm.lateMinutes = "";
    parameterForm.reason = "";
    uni.showToast({ title: "业务规则新版本已创建", icon: "success" });
    await loadCurrentTab();
  } catch (cause: any) {
    uni.showToast({ title: cause?.message || "参数创建失败", icon: "none" });
  } finally {
    acting.value = "";
  }
}

async function actRisk(risk: any, action: "review" | "resolve" | "dismiss") {
  const reason = (riskReasons[risk.id] || "").trim();
  if (reason.length < 2) {
    uni.showToast({ title: "请填写处理原因", icon: "none" });
    return;
  }
  const confirm = await uni.showModal({
    title: "确认风险处理",
    content: `${risk.summary}\n操作：${action}`,
  });
  if (!confirm.confirm) return;
  acting.value = `risk:${risk.id}`;
  try {
    const command = { riskId: risk.id, action, reason };
    await withPendingCreationKey(
      `governance.risk.${risk.id}.${action}`,
      command,
      (idempotencyKey) =>
        endpoints.transitionRiskEvent(risk.id, action, {
          reason,
          idempotencyKey,
        }),
    );
    uni.showToast({ title: "风险状态已更新", icon: "success" });
    await loadCurrentTab();
  } catch (cause: any) {
    uni.showToast({ title: cause?.message || "风险处理失败", icon: "none" });
  } finally {
    acting.value = "";
  }
}

async function inspectErasure(request: any) {
  acting.value = `erasure:blockers:${request.id}`;
  try {
    erasureBlockers[request.id] = await endpoints.dataErasureBlockers(
      request.id,
    );
    if (!erasureBlockers[request.id].length)
      uni.showToast({ title: "业务已结清，可进入复核", icon: "success" });
  } catch (cause: any) {
    uni.showToast({
      title: cause?.message || "注销阻断项检查失败",
      icon: "none",
    });
  } finally {
    acting.value = "";
  }
}

async function decideErasure(request: any, action: "reject" | "complete") {
  if (!canCompleteErasure.value || request.status !== "REQUESTED") return;
  const reason = (erasureReasons[request.id] || "").trim();
  if (reason.length < 2) {
    uni.showToast({ title: "请填写至少2个字的复核原因", icon: "none" });
    return;
  }
  if (action === "complete") {
    await inspectErasure(request);
    if ((erasureBlockers[request.id] || []).length) {
      uni.showToast({ title: "仍有业务未结清，不能匿名化", icon: "none" });
      return;
    }
  }
  const confirm = await uni.showModal({
    title: action === "complete" ? "不可逆匿名化确认" : "驳回注销申请",
    content:
      action === "complete"
        ? "将永久移除微信标识、手机号、头像、姓名与监护学员身份信息；财务和审计历史只保留内部编号。此操作不可撤销。"
        : `将驳回 ${request.user?.displayName || request.userId} 的申请。`,
  });
  if (!confirm.confirm) return;
  acting.value = `erasure:${action}:${request.id}`;
  try {
    const command = { requestId: request.id, action, reason };
    await withPendingCreationKey(
      `privacy.erasure.${action}.${request.id}`,
      command,
      (idempotencyKey) =>
        endpoints.decideDataErasureRequest(request.id, action, {
          reason,
          idempotencyKey,
        }),
    );
    uni.showToast({
      title: action === "complete" ? "匿名化已完成" : "申请已驳回",
      icon: "success",
    });
    delete erasureBlockers[request.id];
    await loadCurrentTab();
  } catch (cause: any) {
    const blockers = cause?.data?.blockers || cause?.blockers;
    if (Array.isArray(blockers)) erasureBlockers[request.id] = blockers;
    uni.showToast({ title: cause?.message || "注销复核失败", icon: "none" });
  } finally {
    acting.value = "";
  }
}

async function exportReport(scope: string) {
  if (isMockMode) {
    uni.showModal({
      title: "需要远端模式",
      content:
        "mock 模式不伪造 Excel。切换 remote 并登录财务/管理员后，导出会由服务端生成并写审计。",
      showCancel: false,
    });
    return;
  }
  acting.value = `export:${scope}`;
  try {
    const file = await endpoints.downloadReport(scope);
    await uni.openDocument({ filePath: file.tempFilePath, showMenu: true });
  } catch (cause: any) {
    uni.showToast({ title: cause?.message || "导出失败", icon: "none" });
  } finally {
    acting.value = "";
  }
}

onLoad((options) => {
  if (
    options?.focus === "privacy" &&
    visibleTabs.value.some((tab) => tab.key === "privacy")
  ) {
    activeTab.value = "privacy";
  }
});

onShow(async () => {
  await session.hydrate();
  if (!hasOperationsAccess(session.roles, "governance")) return;
  if (!visibleTabs.value.some((tab) => tab.key === activeTab.value))
    activeTab.value = visibleTabs.value[0]?.key || "risks";
  await loadCurrentTab();
});
</script>

<template>
  <OperationsFrame
    access="governance"
    icon="governance"
    title="治理与审计"
    eyebrow="GOVERNANCE & CONTROL"
    role="管理员 / 财务"
    description="管理员维护组织权限和业务规则；财务仅处理风险、审计与数据导出。"
  >
    <scroll-view scroll-x enable-flex class="tabs">
      <view class="tab-row">
        <button
          v-for="tab in visibleTabs"
          :key="tab.key"
          class="tab"
          :class="{ active: activeTab === tab.key }"
          @tap="switchTab(tab.key)"
        >
          {{ tab.label }}
        </button>
      </view>
    </scroll-view>

    <view v-if="error" class="error card"
      ><text>{{ error }}</text
      ><button size="mini" @tap="loadCurrentTab">重试</button></view
    >
    <view v-else-if="loading" class="card muted">正在同步治理数据…</view>

    <UserGovernance
      v-else-if="activeTab === 'users'"
      :activeTab="activeTab"
      v-model:userKeyword="userKeyword"
      :loadCurrentTab="loadCurrentTab"
      :users="users"
      :selectedUserId="selectedUserId"
      :selectUser="selectUser"
      :roleLabel="roleLabel"
      :selectedUser="selectedUser"
      :roleOptions="roleOptions"
      :selectedRoles="selectedRoles"
      :toggleRole="toggleRole"
      :availablePrimaryRoles="availablePrimaryRoles"
      :onPrimaryRoleChange="onPrimaryRoleChange"
      :primaryRole="primaryRole"
      :merchantChoices="merchantChoices"
      v-model:merchantId="merchantId"
      v-model:roleReason="roleReason"
      :canSuperviseUsers="canSuperviseUsers"
      :acting="acting"
      :saveRoles="saveRoles"
      :changeUserStatus="changeUserStatus"
    />

    <ParameterGovernance
      v-else-if="activeTab === 'parameters'"
      :activeTab="activeTab"
      :canConfigure="canConfigure"
      :changeParameterDefinition="changeParameterDefinition"
      :selectedParameterDefinition="selectedParameterDefinition"
      :parameterForm="parameterForm"
      :toggleParameterPeriod="toggleParameterPeriod"
      :acting="acting"
      :createParameter="createParameter"
      :parameters="parameters"
    />

    <RiskGovernance
      v-else-if="activeTab === 'risks'"
      :activeTab="activeTab"
      :risks="risks"
      :riskReasons="riskReasons"
      :acting="acting"
      :actRisk="actRisk"
      :canResolveRisk="canResolveRisk"
    />

    <AuditHistory
      v-else-if="activeTab === 'audit'"
      :activeTab="activeTab"
      v-model:auditObjectType="auditObjectType"
      :loadCurrentTab="loadCurrentTab"
      :auditLogs="auditLogs"
    />

    <PrivacyRequests
      v-else-if="activeTab === 'privacy'"
      :activeTab="activeTab"
      :erasureRequests="erasureRequests"
      :acting="acting"
      :inspectErasure="inspectErasure"
      :erasureBlockers="erasureBlockers"
      :canCompleteErasure="canCompleteErasure"
      :erasureReasons="erasureReasons"
      :decideErasure="decideErasure"
    />

    <ReportExport
      v-else
      :exportScopes="exportScopes"
      :acting="acting"
      :exportReport="exportReport"
    />
  </OperationsFrame>
</template>

<style scoped src="./page.css"></style>
