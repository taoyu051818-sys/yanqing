import type { AppRole } from "../types/domain";

export type OperationsCenter = {
  key: string;
  title: string;
  description: string;
  route: string;
  roles: AppRole[];
};

export const workQueueRoute = "/packages/ops/pages/admin/index";

export const operationsAccessRoles = {
  workQueue: [
    "FRONT_DESK",
    "COACH",
    "HOST",
    "MERCHANT",
    "FINANCE",
    "EVENT_MANAGER",
    "ADMIN",
    "SUPER_ADMIN",
  ],
  today: ["FRONT_DESK", "ADMIN", "SUPER_ADMIN"],
  venue: ["FRONT_DESK", "ADMIN", "SUPER_ADMIN"],
  members: ["FRONT_DESK", "COACH", "FINANCE", "ADMIN", "SUPER_ADMIN"],
  training: ["COACH", "FRONT_DESK", "ADMIN", "SUPER_ADMIN"],
  games: ["HOST", "ADMIN", "SUPER_ADMIN"],
  events: ["EVENT_MANAGER", "FRONT_DESK", "ADMIN", "SUPER_ADMIN"],
  alliance: ["MERCHANT", "FRONT_DESK", "FINANCE", "ADMIN", "SUPER_ADMIN"],
  inventory: ["FRONT_DESK", "ADMIN", "SUPER_ADMIN"],
  finance: ["FINANCE", "ADMIN", "SUPER_ADMIN"],
  governance: ["FINANCE", "ADMIN", "SUPER_ADMIN"],
} satisfies Record<string, AppRole[]>;

export type OperationsAccessScope = keyof typeof operationsAccessRoles;

export function hasOperationsAccess(
  roles: AppRole[],
  scope: OperationsAccessScope,
) {
  return operationsAccessRoles[scope].some((role) => roles.includes(role));
}

export const operationsCenters: OperationsCenter[] = [
  {
    key: "today",
    title: "今日营业",
    description: "开班、现场队列、订单履约与岗位交接",
    route: "/packages/ops/pages/frontdesk/index",
    roles: operationsAccessRoles.today,
  },
  {
    key: "venue",
    title: "场馆资源",
    description: "封场维护、资源占用、价格与可售状态",
    route: "/packages/ops/pages/venue/index",
    roles: operationsAccessRoles.venue,
  },
  {
    key: "members",
    title: "客户与会员",
    description: "线索、客户 360、会员权益与服务记录",
    route: "/packages/ops/pages/members/index",
    roles: operationsAccessRoles.members,
  },
  {
    key: "training",
    title: "培训运营",
    description: "试听、课表、签到、消课与训练反馈",
    route: "/packages/ops/pages/coach/index",
    roles: operationsAccessRoles.training,
  },
  {
    key: "games",
    title: "球局运营",
    description: "发布报名、候补、现场签到与激励结算",
    route: "/packages/ops/pages/host/index",
    roles: operationsAccessRoles.games,
  },
  {
    key: "events",
    title: "赛事运营",
    description: "队伍、轮次、比分、排名与奖品签收",
    route: "/packages/ops/pages/event/index",
    roles: operationsAccessRoles.events,
  },
  {
    key: "alliance",
    title: "联盟运营",
    description: "商户、券码核销、消费归因与周期结算",
    route: "/packages/ops/pages/merchant/index",
    roles: operationsAccessRoles.alliance,
  },
  {
    key: "inventory",
    title: "商品与库存",
    description: "前台查看低库存预警；管理员处理采购、盘点与库存作业",
    route: "/packages/ops/pages/inventory/index",
    roles: operationsAccessRoles.inventory,
  },
  {
    key: "finance",
    title: "财务结算",
    description: "收款、退款、日结、分成、结算与导出",
    route: "/packages/ops/pages/finance/index",
    roles: operationsAccessRoles.finance,
  },
  {
    key: "governance",
    title: "治理与权限",
    description: "员工身份、岗位权限、参数、风险与审计",
    route: "/packages/ops/pages/governance/index",
    roles: operationsAccessRoles.governance,
  },
];

export function visibleOperationsCenters(roles: AppRole[]) {
  return operationsCenters.filter((center) =>
    center.roles.some((role) => roles.includes(role)),
  );
}

export function preferredOperationsCenter(roles: AppRole[]) {
  if (roles.some((role) => ["ADMIN", "SUPER_ADMIN"].includes(role)))
    return null;

  const roleCenterKeys: Partial<Record<AppRole, string>> = {
    FRONT_DESK: "today",
    COACH: "training",
    HOST: "games",
    EVENT_MANAGER: "events",
    MERCHANT: "alliance",
    FINANCE: "finance",
  };
  const rolePriority: AppRole[] = [
    "FRONT_DESK",
    "COACH",
    "HOST",
    "EVENT_MANAGER",
    "MERCHANT",
    "FINANCE",
  ];
  const primaryRole = rolePriority.find((role) => roles.includes(role));
  const centerKey = primaryRole ? roleCenterKeys[primaryRole] : undefined;
  return operationsCenters.find((center) => center.key === centerKey) || null;
}
