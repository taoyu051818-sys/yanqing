import { mockUser } from "../../core";
import {
  getCustomerLeads,
  getGovernanceUsers,
  saveCustomerLeads,
} from "../../state";
import {
  ok,
  hasMockRole,
  requireMockRole,
  text,
  newId,
} from "../../policies/common.js";
import type { MockRouteResult, MockRouteOptions } from "../route-contract.js";

export async function handleMembersLeadsOwnersGet(
  method: string,
  url: string,
  data: any,
  options: MockRouteOptions,
): Promise<MockRouteResult> {
  if (url === "/members/leads/owners" && method === "GET") {
    requireMockRole("FRONT_DESK", "ADMIN", "SUPER_ADMIN");
    const allowed = ["FRONT_DESK", "COACH", "ADMIN", "SUPER_ADMIN"];
    const items = getGovernanceUsers()
      .map((user): Record<string, any> => ({
        ...user,
        roles: [
          ...new Set(
            [
              user.primaryRole,
              ...(user.roles || []).map((role: any) =>
                typeof role === "string" ? role : role.role,
              ),
            ].filter((role: string) => allowed.includes(role)),
          ),
        ],
      }))
      .filter(
        (user) =>
          user.status === "ACTIVE" &&
          !user.deletedAt &&
          user.roles.length &&
          user.displayName.includes(text(data.keyword)),
      );
    const page = Math.max(1, Number(data.page) || 1),
      pageSize = Math.min(50, Number(data.pageSize) || 20);
    return {
      handled: true,
      value: ok({
        items: items
          .slice((page - 1) * pageSize, page * pageSize)
          .map((user) => ({
            id: user.id,
            displayName: user.displayName,
            roles: user.roles.filter((role: string) => allowed.includes(role)),
          })),
        total: items.length,
        page,
        pageSize,
      }),
    };
  }
  return { handled: false };
}

export async function handleMembersLeadsGet(
  method: string,
  url: string,
  data: any,
  options: MockRouteOptions,
): Promise<MockRouteResult> {
  if (url === "/members/leads" && method === "GET") {
    requireMockRole("FRONT_DESK", "COACH", "ADMIN", "SUPER_ADMIN");
    const coachOnly =
      hasMockRole("COACH") &&
      !hasMockRole("FRONT_DESK", "ADMIN", "SUPER_ADMIN");
    const terminal = ["CONVERTED", "LOST", "ARCHIVED"];
    const keyword = text(data.keyword).toLowerCase();
    let leads = getCustomerLeads().filter(
      (lead) =>
        !coachOnly ||
        lead.ownerId === mockUser().id ||
        lead.convertedMemberId === "member-1",
    );
    if (data.status)
      leads = leads.filter((lead) => lead.status === data.status);
    if (data.sourceChannel)
      leads = leads.filter((lead) => lead.sourceChannel === data.sourceChannel);
    if (data.ownerId)
      leads = leads.filter((lead) => lead.ownerId === data.ownerId);
    if (data.overdue === "true")
      leads = leads.filter(
        (lead) =>
          !terminal.includes(lead.status) &&
          new Date(lead.slaDueAt).getTime() < Date.now(),
      );
    if (keyword)
      leads = leads.filter((lead) =>
        `${lead.displayName}${coachOnly ? "" : lead.phone || ""}${lead.campaign || ""}`
          .toLowerCase()
          .includes(keyword),
      );
    if (coachOnly)
      leads = leads.map((lead) => ({
        ...lead,
        phone: lead.phone ? "已登记（教练不可见）" : null,
      }));
    return {
      handled: true,
      value: ok({ items: leads, total: leads.length, page: 1, pageSize: 100 }),
    };
  }
  return { handled: false };
}

export async function handleMembersLeadsPost(
  method: string,
  url: string,
  data: any,
  options: MockRouteOptions,
): Promise<MockRouteResult> {
  if (url === "/members/leads" && method === "POST") {
    requireMockRole("FRONT_DESK", "ADMIN", "SUPER_ADMIN");
    if (!text(data.displayName)) throw new Error("客户姓名不能为空");
    if (!text(data.sourceChannel)) throw new Error("客户来源不能为空");
    const leads = getCustomerLeads();
    if (
      text(data.phone) &&
      leads.some(
        (lead) =>
          lead.phone === text(data.phone) &&
          !["CONVERTED", "LOST", "ARCHIVED"].includes(lead.status),
      )
    )
      throw new Error("该手机号已有未结束线索");
    const now = new Date();
    const lead = {
      id: newId("lead"),
      displayName: text(data.displayName),
      phone: text(data.phone) || null,
      status: "NEW",
      sourceChannel: data.sourceChannel,
      campaign: text(data.campaign) || null,
      referrerId: data.referrerId || null,
      ownerId: data.ownerId || null,
      owner: data.ownerId
        ? {
            id: data.ownerId,
            displayName:
              data.ownerId === mockUser().id
                ? mockUser().displayName
                : getGovernanceUsers().find((user) => user.id === data.ownerId)
                    ?.displayName || "待核对员工",
          }
        : null,
      convertedMemberId: null,
      nextFollowUpAt: data.nextFollowUpAt || null,
      slaDueAt:
        data.slaDueAt || new Date(now.getTime() + 86400000).toISOString(),
      followUps: [],
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };
    saveCustomerLeads([lead, ...leads]);
    return { handled: true, value: ok(lead) };
  }
  return { handled: false };
}

export async function handleLeadActionPost(
  method: string,
  url: string,
  data: any,
  options: MockRouteOptions,
): Promise<MockRouteResult> {
  const leadActionMatch = url.match(
    /^\/members\/leads\/([^/]+)\/(claim|assign|follow-ups|convert|lost|archive)$/,
  );
  if (leadActionMatch && method === "POST") {
    requireMockRole("FRONT_DESK", "ADMIN", "SUPER_ADMIN");
    const [, leadId, action] = leadActionMatch;
    const leads = getCustomerLeads();
    const lead = leads.find((item) => item.id === leadId);
    if (!lead) throw new Error("客户线索不存在");
    const terminal = ["CONVERTED", "LOST", "ARCHIVED"];
    if (action === "claim") {
      if (terminal.includes(lead.status)) throw new Error("终态线索不能认领");
      if (lead.ownerId && lead.ownerId !== mockUser().id)
        throw new Error("线索已由其他员工认领");
      lead.ownerId = mockUser().id;
      lead.owner = { id: mockUser().id, displayName: mockUser().displayName };
    } else if (action === "assign") {
      if (terminal.includes(lead.status))
        throw new Error("终态线索不能重新分配");
      if (!text(data.ownerId)) throw new Error("负责人不能为空");
      lead.ownerId = data.ownerId;
      lead.owner = {
        id: data.ownerId,
        displayName:
          data.ownerId === mockUser().id
            ? mockUser().displayName
            : "已分配员工",
      };
    } else if (action === "follow-ups") {
      if (terminal.includes(lead.status))
        throw new Error("终态线索不能继续跟进");
      if (!text(data.content)) throw new Error("跟进内容不能为空");
      const rank: Record<string, number> = {
        NEW: 0,
        CONTACTING: 1,
        TRIAL_RESERVED: 2,
        ATTENDED: 3,
      };
      const nextStatus =
        data.nextStatus || (lead.status === "NEW" ? "CONTACTING" : lead.status);
      if (
        rank[nextStatus] === undefined ||
        rank[nextStatus] < rank[lead.status]
      )
        throw new Error("跟进状态不能回退或直接进入终态");
      const followUp = {
        id: newId("follow-up"),
        kind: text(data.kind) || "OTHER",
        content: text(data.content),
        statusBefore: lead.status,
        statusAfter: nextStatus,
        nextFollowUpAt: data.nextFollowUpAt || lead.nextFollowUpAt,
        createdAt: new Date().toISOString(),
        actor: { id: mockUser().id, displayName: mockUser().displayName },
      };
      lead.status = nextStatus;
      lead.nextFollowUpAt = followUp.nextFollowUpAt;
      lead.followUps = [followUp, ...(lead.followUps || [])];
    } else if (action === "convert") {
      if (
        lead.status === "CONVERTED" &&
        lead.convertedMemberId === data.memberId
      )
        return { handled: true, value: ok(lead) };
      if (terminal.includes(lead.status)) throw new Error("终态线索不能转换");
      if (!["member-1", "member-2"].includes(data.memberId))
        throw new Error("转换目标不是有效会员");
      lead.status = "CONVERTED";
      lead.convertedMemberId = data.memberId;
      lead.convertedAt = new Date().toISOString();
      lead.nextFollowUpAt = null;
    } else if (action === "lost") {
      if (terminal.includes(lead.status))
        throw new Error("终态线索不能标记丢失");
      if (text(data.reason).length < 2) throw new Error("丢失原因不能为空");
      lead.status = "LOST";
      lead.lostReason = text(data.reason);
      lead.lostAt = new Date().toISOString();
      lead.nextFollowUpAt = null;
    } else {
      if (!["CONVERTED", "LOST", "ARCHIVED"].includes(lead.status))
        throw new Error("只有已转换或已丢失线索可以归档");
      lead.status = "ARCHIVED";
      lead.archivedAt = new Date().toISOString();
    }
    lead.updatedAt = new Date().toISOString();
    saveCustomerLeads(leads);
    return { handled: true, value: ok(lead) };
  }
  return { handled: false };
}
