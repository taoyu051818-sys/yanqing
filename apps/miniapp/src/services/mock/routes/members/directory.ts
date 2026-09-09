import { mockUser } from "../../core";
import { getOrders } from "../../venue";
import {
  getCoupons,
  getEnrollments,
  getEvents,
  getGames,
  getMemberAccounts,
  getGovernanceUsers,
  getAuditLogs,
  getReferralInvites,
  saveGovernanceUsers,
  saveAuditLogs,
  saveReferralInvites,
} from "../../state";
import {
  ok,
  mockRoles,
  hasMockRole,
  requireMockRole,
  text,
  newId,
} from "../../policies/common.js";
import {
  mockMemberPrivacyScope,
  maskMockPhone,
} from "../../policies/members.js";
import { mockFrontDeskPaymentSummary } from "../../policies/orders.js";
import { MOCK_ACTIVE_MEMBERS } from "../../policies/venues.js";
import { referralInviteTokenHash } from "../../policies/referrals.js";
import type { MockRouteResult, MockRouteOptions } from "../route-contract.js";

export async function handleMembersMeReferrerPost(
  method: string,
  url: string,
  data: any,
  options: MockRouteOptions,
): Promise<MockRouteResult> {
  if (url === "/members/me/referrer" && method === "POST") {
    const inviteCode = text(data.inviteCode);
    if (
      inviteCode.length < 20 ||
      inviteCode.length > 128 ||
      !/^[A-Za-z0-9_-]+$/.test(inviteCode)
    )
      throw new Error("邀请码无效或已过期");
    const actor = mockUser();
    const invites = getReferralInvites();
    const invite = invites.find(
      (item) => item.tokenHash === referralInviteTokenHash(inviteCode),
    );
    if (
      !invite ||
      invite.revokedAt ||
      new Date(invite.expiresAt).getTime() <= Date.now()
    )
      throw new Error("邀请码无效或已过期");
    const referrerId = invite.inviterId;
    if (referrerId === actor.id) throw new Error("不能推荐自己");
    const users = getGovernanceUsers();
    const user = users.find((item) => item.id === actor.id);
    const referrer = users.find((item) => item.id === referrerId);
    const hasMemberIdentity = (item: any) =>
      Array.isArray(item?.roles) &&
      item.roles.some(
        (role: any) =>
          (typeof role === "string" ? role : role?.role) === "MEMBER",
      );
    if (!user || user.status !== "ACTIVE" || !hasMemberIdentity(user))
      throw new Error("会员不存在或已停用");
    if (
      !referrer ||
      referrer.status !== "ACTIVE" ||
      !hasMemberIdentity(referrer)
    )
      throw new Error("推荐人不存在或已停用");
    const visited = new Set<string>();
    let ancestor: any = referrer;
    while (ancestor) {
      if (ancestor.id === actor.id || visited.has(String(ancestor.id)))
        throw new Error("推荐关系不能形成闭环");
      visited.add(String(ancestor.id));
      ancestor = ancestor.referrerId
        ? users.find((item) => item.id === ancestor.referrerId)
        : null;
    }
    if (user.referrerId === referrerId)
      return { handled: true, value: ok({ bound: true }) };
    if (user.referrerId) throw new Error("直接推荐人已绑定，不能更换");
    user.referrerId = referrerId;
    user.updatedAt = new Date().toISOString();
    invite.useCount = Number(invite.useCount || 0) + 1;
    invite.lastUsedAt = user.updatedAt;
    invite.updatedAt = user.updatedAt;
    saveGovernanceUsers(users);
    saveReferralInvites(invites);
    saveAuditLogs([
      {
        id: newId("audit"),
        actorId: actor.id,
        actor: { id: actor.id, displayName: actor.displayName },
        actorRole: "MEMBER",
        action: "DIRECT_REFERRAL_BOUND",
        objectType: "User",
        objectId: actor.id,
        oldValue: { referrerId: null },
        newValue: { referrerId },
        reason: "会员本人确认一层直接推荐关系",
        result: "SUCCESS",
        createdAt: user.updatedAt,
      },
      ...getAuditLogs(),
    ]);
    return { handled: true, value: ok({ bound: true }) };
  }
  return { handled: false };
}

export async function handleMember360Get(
  method: string,
  url: string,
  data: any,
  options: MockRouteOptions,
): Promise<MockRouteResult> {
  const member360Match = url.match(/^\/members\/([^/]+)\/360$/);
  if (member360Match && method === "GET") {
    requireMockRole("FRONT_DESK", "COACH", "FINANCE", "ADMIN", "SUPER_ADMIN");
    const id = member360Match[1];
    if (!["member-1", "member-2"].includes(id)) throw new Error("会员不存在");
    const coachOnly =
      hasMockRole("COACH") &&
      !hasMockRole("FRONT_DESK", "FINANCE", "ADMIN", "SUPER_ADMIN");
    const privacyScope = mockMemberPrivacyScope();
    const frontDeskLimited = privacyScope === "FRONT_DESK_LIMITED";
    if (coachOnly && id !== "member-1")
      throw new Error("会员不在当前教练负责的班级中");
    const member =
      id === "member-1"
        ? {
            id,
            displayName: "延庆会员小林",
            phone: coachOnly
              ? null
              : privacyScope === "ADMIN"
                ? "13800000005"
                : maskMockPhone("13800000005"),
            memberProfile: {
              level: "GOLD",
              visitCount: 18,
              lastVisitAt: new Date().toISOString(),
            },
          }
        : {
            id,
            displayName: "羽友小周",
            phone:
              privacyScope === "ADMIN"
                ? "13800000007"
                : maskMockPhone("13800000007"),
            memberProfile: {
              level: "REGULAR",
              visitCount: 6,
              lastVisitAt: new Date(Date.now() - 86400000).toISOString(),
            },
          };
    const memberAccounts = getMemberAccounts()[id] || [];
    return {
      handled: true,
      value: ok({
        member,
        accounts: coachOnly || frontDeskLimited ? [] : memberAccounts,
        paymentSummary: frontDeskLimited
          ? mockFrontDeskPaymentSummary(memberAccounts)
          : undefined,
        recentOrders: coachOnly
          ? []
          : frontDeskLimited
            ? getOrders()
                .slice(0, 5)
                .map((order) => ({
                  id: order.id,
                  orderNo: order.orderNo,
                  businessType: order.businessType,
                  status: order.status,
                  title: order.title,
                  createdAt: order.createdAt,
                }))
            : getOrders().slice(0, 5),
        recentTraining:
          id !== "member-1"
            ? []
            : frontDeskLimited
              ? getEnrollments()
                  .slice(0, 5)
                  .map((enrollment) => ({
                    id: enrollment.id,
                    enrollmentNo: enrollment.enrollmentNo,
                    status: enrollment.status,
                    totalSessions: enrollment.totalSessions,
                    consumedSessions: enrollment.consumedSessions,
                    expiresAt: enrollment.expiresAt,
                    product: enrollment.product,
                    class: enrollment.class,
                    student: enrollment.student,
                  }))
              : getEnrollments().slice(0, 5),
        recentGames: coachOnly
          ? []
          : getGames()
              .slice(0, 3)
              .map((game) => ({
                id: `reg-${game.id}`,
                status: "CHECKED_IN",
                game,
              })),
        recentEvents: coachOnly
          ? []
          : getEvents()
              .slice(0, 3)
              .map((event) => ({
                id: `team-${event.id}`,
                status: "COMPLETED",
                event,
              })),
        recentCoupons: coachOnly ? [] : getCoupons().slice(0, 5),
        privacyScope,
        financialsRedacted: coachOnly || frontDeskLimited,
        accountTypesLimited: coachOnly || frontDeskLimited,
      }),
    };
  }
  return { handled: false };
}

export async function handleMembersAny(
  method: string,
  url: string,
  data: any,
  options: MockRouteOptions,
): Promise<MockRouteResult> {
  if (url === "/members") {
    requireMockRole("FRONT_DESK", "COACH", "FINANCE", "ADMIN", "SUPER_ADMIN");
    const privacyScope = mockMemberPrivacyScope();
    const members =
      mockRoles().includes("COACH") &&
      !hasMockRole("FRONT_DESK", "FINANCE", "ADMIN", "SUPER_ADMIN")
        ? [
            {
              id: "member-1",
              displayName: "延庆会员小林",
              level: "GOLD",
              status: "ACTIVE",
              memberProfile: { level: "GOLD" },
              trainingContext: "当前负责班级",
              privacyScope: "COACH_ASSIGNED",
            },
          ]
        : MOCK_ACTIVE_MEMBERS.map((member) => ({
            ...member,
            phone:
              privacyScope === "ADMIN"
                ? member.phone
                : maskMockPhone(member.phone),
            privacyScope,
          }));
    const keyword = text(data.keyword).trim().toLowerCase();
    const filtered = [...members].filter(
      (member) =>
        !keyword ||
        member.displayName.toLowerCase().includes(keyword) ||
        (privacyScope !== "COACH_ASSIGNED" &&
          Boolean(
            MOCK_ACTIVE_MEMBERS.find(
              (item) => item.id === member.id,
            )?.phone?.includes(keyword),
          )),
    );
    const page = Math.max(1, Number(data.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(data.pageSize) || 20));
    return {
      handled: true,
      value: ok({
        items: filtered.slice((page - 1) * pageSize, page * pageSize),
        total: filtered.length,
      }),
    };
  }
  return { handled: false };
}
