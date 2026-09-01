import type { AppRole } from "../types/domain";

export type GovernanceTab =
  "users" | "parameters" | "risks" | "privacy" | "audit" | "exports";

export const governanceTabs: Array<{
  key: GovernanceTab;
  label: string;
  roles: AppRole[];
}> = [
  { key: "users", label: "组织权限", roles: ["ADMIN", "SUPER_ADMIN"] },
  { key: "parameters", label: "业务规则", roles: ["ADMIN", "SUPER_ADMIN"] },
  {
    key: "risks",
    label: "风险事件",
    roles: ["FINANCE", "ADMIN", "SUPER_ADMIN"],
  },
  { key: "privacy", label: "注销复核", roles: ["ADMIN", "SUPER_ADMIN"] },
  {
    key: "audit",
    label: "审计日志",
    roles: ["FINANCE", "ADMIN", "SUPER_ADMIN"],
  },
  {
    key: "exports",
    label: "数据导出",
    roles: ["FINANCE", "ADMIN", "SUPER_ADMIN"],
  },
];

export function visibleGovernanceTabs(roles: AppRole[]) {
  return governanceTabs.filter((tab) =>
    tab.roles.some((role) => roles.includes(role)),
  );
}

const governanceExportScopes = [
  ["orders", "订单与支付"],
  ["members", "会员与账户"],
  ["training", "培训运营"],
  ["events", "赛事经营"],
  ["alliance", "联盟商户"],
  ["inventory", "商品库存"],
  ["finance", "财务结算"],
  ["audit", "审计与关账"],
  ["all", "全量审计包"],
] as const;

const financeExportScopeKeys = new Set(["orders", "finance"]);

export type FinancePageExportScope =
  "orders" | "finance" | "events" | "inventory";

const financePageExportScopes: Array<[FinancePageExportScope, string]> = [
  ["orders", "订单 Excel"],
  ["finance", "财务账簿 Excel"],
  ["events", "赛事 Excel"],
  ["inventory", "库存 Excel"],
];

export function visibleGovernanceExportScopes(roles: AppRole[]) {
  if (roles.some((role) => ["ADMIN", "SUPER_ADMIN"].includes(role)))
    return governanceExportScopes;
  if (roles.includes("FINANCE")) {
    return governanceExportScopes.filter(([scope]) =>
      financeExportScopeKeys.has(scope),
    );
  }
  return [];
}

export function visibleFinancePageExportScopes(roles: AppRole[]) {
  if (roles.some((role) => ["ADMIN", "SUPER_ADMIN"].includes(role))) {
    return financePageExportScopes;
  }
  if (roles.includes("FINANCE")) {
    return financePageExportScopes.filter(([scope]) =>
      financeExportScopeKeys.has(scope),
    );
  }
  return [];
}

export type BusinessParameterKind =
  "RATE_BPS" | "CENTS" | "DAYS" | "MINUTES" | "COINS" | "PERIODS" | "WINDOW";

export type BusinessParameterDefinition = {
  key: string;
  label: string;
  description: string;
  type: "INTEGER" | "JSON";
  kind: BusinessParameterKind;
  placeholder?: string;
};

export const businessParameterCatalog: BusinessParameterDefinition[] = [
  {
    key: "training.contract_rate_bps",
    label: "培训合同收入计提比例",
    description: "培训有效流水计入场馆合同收入的比例",
    type: "INTEGER",
    kind: "RATE_BPS",
    placeholder: "输入百分比，例如 20",
  },
  {
    key: "training.venue_fee_cents",
    label: "培训附加场地费",
    description: "培训订单额外收取的场地费用；当前规则要求为 0 元",
    type: "INTEGER",
    kind: "CENTS",
    placeholder: "输入金额（元）",
  },
  {
    key: "newcomer.experience.valid_days",
    label: "新客体验权益有效期",
    description: "新客领取体验权益后的可用天数",
    type: "INTEGER",
    kind: "DAYS",
    placeholder: "输入天数",
  },
  {
    key: "newcomer.experience.allowed_slot_periods",
    label: "新客体验可用时段",
    description: "新客体验权益允许预约的非黄金时段",
    type: "JSON",
    kind: "PERIODS",
  },
  {
    key: "referral.first_payment.coin_reward",
    label: "邀请人首单奖励",
    description: "新客完成首单后发给邀请人的羽毛球币",
    type: "INTEGER",
    kind: "COINS",
    placeholder: "输入羽毛球币数量",
  },
  {
    key: "referral.new_user.first_payment.coin_reward",
    label: "新客首单奖励",
    description: "受邀新客完成首单后获得的羽毛球币",
    type: "INTEGER",
    kind: "COINS",
    placeholder: "输入羽毛球币数量",
  },
  {
    key: "referral.refund_observation_days",
    label: "首单退款观察期",
    description: "首单完成后延迟发放邀请奖励的观察天数",
    type: "INTEGER",
    kind: "DAYS",
    placeholder: "输入天数",
  },
  {
    key: "booking.hold_minutes",
    label: "待支付占场时长",
    description: "订场订单待支付期间保留场地的分钟数",
    type: "INTEGER",
    kind: "MINUTES",
    placeholder: "输入分钟数",
  },
  {
    key: "operations.venue_check_in_window.v1",
    label: "场地签到窗口",
    description: "场地订单允许提前和延后签到的时间范围",
    type: "JSON",
    kind: "WINDOW",
  },
  {
    key: "operations.game_check_in_window.v1",
    label: "球局签到窗口",
    description: "拼场球局允许提前和延后签到的时间范围",
    type: "JSON",
    kind: "WINDOW",
  },
  {
    key: "operations.event_check_in_window.v1",
    label: "赛事签到窗口",
    description: "赛事允许提前和延后签到的时间范围",
    type: "JSON",
    kind: "WINDOW",
  },
  {
    key: "training.attendance_window.v1",
    label: "培训点名窗口",
    description: "培训点名和试听签到允许的提前、延后时间",
    type: "JSON",
    kind: "WINDOW",
  },
  {
    key: "training.completion_window.v1",
    label: "培训消课窗口",
    description: "培训消课、结课和试听未到允许的提前、延后时间",
    type: "JSON",
    kind: "WINDOW",
  },
];

export const businessPeriodOptions = [
  { value: "EARLY", label: "早场" },
  { value: "DAYTIME", label: "日间" },
  { value: "EVENING", label: "晚场" },
  { value: "WEEKEND", label: "周末" },
] as const;

export function businessParameterDefinition(key: string) {
  return businessParameterCatalog.find((item) => item.key === key);
}

export function businessParameterLabel(key: string, fallbackDescription = "") {
  return (
    businessParameterDefinition(key)?.label ||
    fallbackDescription ||
    "其他业务规则"
  );
}

function finiteNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function formatBusinessParameterValue(key: string, value: unknown) {
  const definition = businessParameterDefinition(key);
  const number = finiteNumber(value);
  if (definition?.kind === "RATE_BPS" && number !== null)
    return `${number / 100}%`;
  if (definition?.kind === "CENTS" && number !== null)
    return `¥${(number / 100).toFixed(2)}`;
  if (definition?.kind === "DAYS" && number !== null) return `${number} 天`;
  if (definition?.kind === "MINUTES" && number !== null)
    return `${number} 分钟`;
  if (definition?.kind === "COINS" && number !== null)
    return `${number} 羽毛球币`;
  if (definition?.kind === "PERIODS" && Array.isArray(value)) {
    const labels = value
      .map(
        (period) =>
          businessPeriodOptions.find((item) => item.value === period)?.label,
      )
      .filter(Boolean);
    return labels.length ? labels.join("、") : "未选择可用时段";
  }
  if (
    definition?.kind === "WINDOW" &&
    value &&
    typeof value === "object" &&
    !Array.isArray(value)
  ) {
    const window = value as Record<string, unknown>;
    return `提前 ${finiteNumber(window.earlyMinutes) ?? 0} 分钟 · 延后 ${finiteNumber(window.lateMinutes) ?? 0} 分钟`;
  }
  if (Array.isArray(value)) return `已配置 ${value.length} 项规则`;
  if (value && typeof value === "object")
    return `已配置 ${Object.keys(value as object).length} 项结构化规则`;
  if (typeof value === "boolean") return value ? "启用" : "停用";
  return value === null || value === undefined || value === ""
    ? "未配置"
    : String(value);
}

export type BusinessParameterEditorValue = {
  scalar: string;
  earlyMinutes: string;
  lateMinutes: string;
  periods: string[];
};

function nonNegativeInteger(raw: string, label: string, maximum?: number) {
  const value = Number(raw);
  if (
    !Number.isInteger(value) ||
    value < 0 ||
    (maximum !== undefined && value > maximum)
  ) {
    throw new Error(
      `${label}必须是${maximum === undefined ? "非负整数" : `0-${maximum} 的整数`}`,
    );
  }
  return value;
}

export function parseBusinessParameterValue(
  definition: BusinessParameterDefinition,
  editor: BusinessParameterEditorValue,
) {
  if (definition.kind === "WINDOW") {
    return {
      version: 1,
      earlyMinutes: nonNegativeInteger(editor.earlyMinutes, "提前分钟数", 240),
      lateMinutes: nonNegativeInteger(editor.lateMinutes, "延后分钟数", 240),
    };
  }
  if (definition.kind === "PERIODS") {
    const allowed = new Set<string>(
      businessPeriodOptions.map((item) => item.value),
    );
    const periods = [...new Set(editor.periods)].filter((item) =>
      allowed.has(item),
    );
    if (!periods.length) throw new Error("请至少选择一个可用时段");
    return periods;
  }
  if (definition.kind === "RATE_BPS") {
    const rate = Number(editor.scalar);
    if (!Number.isFinite(rate) || rate < 0 || rate > 100)
      throw new Error("比例必须在 0%-100% 之间");
    return Math.round(rate * 100);
  }
  if (definition.kind === "CENTS") {
    const yuan = Number(editor.scalar);
    if (
      !Number.isFinite(yuan) ||
      yuan < 0 ||
      !/^\d+(\.\d{1,2})?$/.test(editor.scalar.trim())
    ) {
      throw new Error("金额必须是最多两位小数的非负数");
    }
    return Math.round(yuan * 100);
  }
  return nonNegativeInteger(
    editor.scalar,
    definition.kind === "DAYS"
      ? "天数"
      : definition.kind === "MINUTES"
        ? "分钟数"
        : "数量",
  );
}
