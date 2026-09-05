import type { WorkItem } from "../services/api";
import type { AppRole } from "../types/domain";

export type WorkGroupKey =
  | "customer"
  | "refund"
  | "training"
  | "event"
  | "alliance"
  | "inventory"
  | "fulfillment"
  | "reconciliation"
  | "governance";

export type WorkGroupDefinition = {
  key: WorkGroupKey;
  title: string;
  description: string;
  emptyText: string;
  route: string;
  roles: AppRole[];
};

export const workGroupDefinitions: WorkGroupDefinition[] = [
  {
    key: "customer",
    title: "客户经营",
    description: "线索 SLA、主理人申请与责任交接",
    emptyText: "暂无逾期线索或主理人申请",
    route: "/packages/ops/pages/members/index",
    roles: ["FRONT_DESK", "FINANCE", "ADMIN", "SUPER_ADMIN"],
  },
  {
    key: "refund",
    title: "资金复核",
    description: "账户调整、退款申请和原路冲正",
    emptyText: "暂无账户调整或退款待复核",
    route: "/packages/ops/pages/finance/index",
    roles: ["FINANCE", "ADMIN", "SUPER_ADMIN"],
  },
  {
    key: "training",
    title: "培训消课",
    description: "试听到场、点名、消课建议与冲正复核",
    emptyText: "暂无培训待处理事项",
    route: "/packages/ops/pages/coach/index",
    roles: ["COACH", "FRONT_DESK", "ADMIN", "SUPER_ADMIN"],
  },
  {
    key: "event",
    title: "赛事执行",
    description: "轮次、比分、奖品出库与签收",
    emptyText: "暂无赛事比分或奖品待办",
    route: "/packages/ops/pages/event/index",
    roles: ["EVENT_MANAGER", "FRONT_DESK", "ADMIN", "SUPER_ADMIN"],
  },
  {
    key: "alliance",
    title: "联盟券",
    description: "券码领取、核销和消费归因",
    emptyText: "暂无联盟券待办",
    route: "/packages/ops/pages/merchant/index",
    roles: ["FRONT_DESK", "MERCHANT", "ADMIN", "SUPER_ADMIN"],
  },
  {
    key: "inventory",
    title: "库存预警",
    description: "低于安全线的商品、培训及赛事耗材",
    emptyText: "库存均高于安全线",
    route: "/packages/ops/pages/inventory/index",
    roles: ["FRONT_DESK", "ADMIN", "SUPER_ADMIN"],
  },
  {
    key: "fulfillment",
    title: "现场履约",
    description: "订场、球局与赛事的待签到、待完成事项",
    emptyText: "暂无待处理履约订单",
    route: "/packages/ops/pages/frontdesk/index",
    roles: ["FRONT_DESK", "HOST", "EVENT_MANAGER", "ADMIN", "SUPER_ADMIN"],
  },
  {
    key: "reconciliation",
    title: "对账与结算",
    description: "培训、联盟和寄售结算复核",
    emptyText: "暂无待处理对账或结算",
    route: "/packages/ops/pages/finance/index",
    roles: ["FINANCE", "MERCHANT", "ADMIN", "SUPER_ADMIN"],
  },
  {
    key: "governance",
    title: "治理复核",
    description: "经营规则、账号注销和不可逆操作复核",
    emptyText: "暂无治理待办",
    route: "/packages/ops/pages/governance/index",
    roles: ["ADMIN", "SUPER_ADMIN"],
  },
];

const normalizeToken = (value: unknown) =>
  String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, "_");

const explicitGroupMap: Record<string, WorkGroupKey> = {
  CUSTOMER: "customer",
  CUSTOMER_LEAD_SLA: "customer",
  HOST_APPLICATION_REVIEW: "customer",
  LEAD: "customer",
  REFUND: "refund",
  REFUNDS: "refund",
  REFUND_REVIEW: "refund",
  ACCOUNT_ADJUSTMENT_REVIEW: "refund",
  TRAINING: "training",
  TRAINING_ATTENDANCE: "training",
  TRAINING_CONSUME: "training",
  TRAINING_CONSUME_CORRECTION_REVIEW: "training",
  TRAINING_SESSION_OPERATION: "training",
  TRAINING_TRIAL_CHECK_IN: "training",
  TRAINING_TRIAL_ASSESSMENT: "training",
  TRAINING_TRIAL_DECISION: "training",
  ATTENDANCE: "training",
  EVENT: "event",
  EVENT_SCORE: "event",
  EVENT_PRIZE_RECEIPT: "event",
  SCORE: "event",
  ALLIANCE: "alliance",
  COUPON: "alliance",
  COUPON_REVIEW: "alliance",
  COUPON_REDEMPTION: "alliance",
  ALLIANCE_COUPON: "alliance",
  INVENTORY: "inventory",
  LOW_STOCK: "inventory",
  STOCK: "inventory",
  FULFILLMENT: "fulfillment",
  GAME_OPERATION: "fulfillment",
  ORDER_FULFILLMENT: "fulfillment",
  RECONCILIATION: "reconciliation",
  SETTLEMENT: "reconciliation",
  ALLIANCE_SETTLEMENT: "reconciliation",
  TRAINING_SETTLEMENT: "reconciliation",
  CONSIGNMENT_SETTLEMENT: "reconciliation",
  GOVERNANCE: "governance",
  DATA_ERASURE_REVIEW: "governance",
  YOUTH_TRAINING_RULE_REVIEW: "governance",
};

/**
 * Prefer the server-owned group. Text inference is retained only for an older
 * API during rolling deployment, and unknown records remain visibly unmapped.
 */
export function workGroupKey(item: WorkItem): WorkGroupKey | null {
  const explicit =
    explicitGroupMap[normalizeToken(item.group)] ||
    explicitGroupMap[normalizeToken(item.category)] ||
    explicitGroupMap[normalizeToken(item.kind)];
  if (explicit) return explicit;

  const searchable =
    `${item.objectType || ""} ${item.title || ""} ${item.description || ""}`.toUpperCase();
  if (/客户|线索|主理人申请|CUSTOMER|LEAD|HOST_APPLICATION/.test(searchable))
    return "customer";
  if (/账户调整|资金复核|退款|ACCOUNT_ADJUSTMENT|REFUND/.test(searchable))
    return "refund";
  if (/培训|点名|消课|TRAINING|ATTENDANCE|CONSUME/.test(searchable))
    return "training";
  if (/赛事|比分|轮次|EVENT|MATCH|SCORE/.test(searchable)) return "event";
  if (/券|核销|COUPON|REDEEM/.test(searchable)) return "alliance";
  if (/库存|安全线|低库存|INVENTORY|STOCK/.test(searchable)) return "inventory";
  if (/履约|FULFILLMENT/.test(searchable)) return "fulfillment";
  if (/对账|结算|RECONCILIATION|SETTLEMENT/.test(searchable))
    return "reconciliation";
  if (/注销|匿名化|规则复核|DATA_ERASURE|PRIVACY|GOVERNANCE/.test(searchable))
    return "governance";
  return null;
}

export function isUrgentWorkItem(item: WorkItem) {
  return Number(item.priority || 0) >= 90;
}
