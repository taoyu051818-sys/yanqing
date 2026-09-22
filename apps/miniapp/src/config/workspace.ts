import { hasOperationsAccess, visibleOperationsCenters } from "./operations";
import type { AppRole } from "../types/domain";

export type WorkspaceTab = "today" | "business" | "data" | "manage";
export interface WorkspaceItem {
  key: string;
  title: string;
  icon: string;
  route: string;
  description: string;
}
export const workspaceTabs: {
  key: WorkspaceTab;
  title: string;
  icon: string;
}[] = [
  { key: "today", title: "今日", icon: "work" },
  { key: "business", title: "业务", icon: "work" },
  { key: "data", title: "数据", icon: "analytics" },
  { key: "manage", title: "管理", icon: "governance" },
];
export function canViewOperatingData(roles: AppRole[]) {
  return roles.some((role) =>
    ["FINANCE", "ADMIN", "SUPER_ADMIN"].includes(role),
  );
}
export function workspaceMenu(roles: AppRole[]): WorkspaceItem[] {
  const titles: Record<string, string> = {
    venue: "场地维护",
    members: "会员管理",
    training: "课表与点名",
    games: "球局管理",
    events: "赛事管理",
    alliance: "核销与结算",
    inventory: "商品库存",
    governance: roles.some((role) => ["ADMIN", "SUPER_ADMIN"].includes(role))
      ? "员工与权限"
      : "风险与审计",
  };
  const items: WorkspaceItem[] = visibleOperationsCenters(roles).map(
    (item) => ({ ...item, title: titles[item.key] || item.title }),
  );
  if (hasOperationsAccess(roles, "today"))
    items.unshift({
      key: "booking",
      title: "代会员订场",
      icon: "booking",
      route: "/pages/booking/index",
      description: "预约时段、代会员订场",
    });
  if (hasOperationsAccess(roles, "venueSettings"))
    items.push(
      {
        key: "courts",
        title: "场地管理",
        icon: "booking",
        route: "/packages/ops/pages/venue-settings/index?view=courts",
        description: "新增、编辑、删除场地",
      },
      {
        key: "venue-profile",
        title: "球馆信息",
        icon: "venue",
        route: "/packages/ops/pages/venue-settings/index",
        description: "地址、营业时间、联系方式",
      },
      {
        key: "training-products",
        title: "课程与班级",
        icon: "training",
        route: "/packages/ops/pages/coach/index?view=products",
        description: "课包、课程与培训班级",
      },
      {
        key: "coupon-campaigns",
        title: "优惠券设置",
        icon: "ticket",
        route: "/packages/ops/pages/merchant/index?view=coupons",
        description: "设置优惠券、发放规则与启停",
      },
    );
  if (canViewOperatingData(roles))
    items.push({
      key: "pc-login",
      title: "电脑登录",
      icon: "scan",
      route: "/packages/ops/pages/pc-login/index",
      description: "扫码登录电脑管理后台",
    });
  return items;
}
export function visibleWorkspaceTabs(roles: AppRole[]) {
  if (!hasOperationsAccess(roles, "workQueue")) return [];
  return workspaceTabs.filter(
    (tab) =>
      (tab.key !== "data" && tab.key !== "manage") ||
      (tab.key === "data"
        ? canViewOperatingData(roles)
        : workspaceMenu(roles).some((item) =>
            managementKeys.includes(item.key),
          )),
  );
}
export const managementKeys = [
  "venue-profile",
  "courts",
  "training-products",
  "coupon-campaigns",
  "governance",
  "pc-login",
];
export const workspaceGroups = [
  { title: "日常营业", keys: ["transactions", "booking", "today", "venue"] },
  {
    title: "客户与活动",
    keys: ["members", "training", "games", "events", "alliance"],
  },
  { title: "财务与商品", keys: ["finance", "inventory"] },
];
