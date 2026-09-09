import { mockUser } from "../../core";
import { getEventPartnerInvites, saveEventPartnerInvites } from "../../state";
import { ok, requireMockRole, text, newId } from "../../policies/common.js";
import { requireEvent } from "../../policies/events.js";
import type { MockRouteResult, MockRouteOptions } from "../route-contract.js";

export async function handleCreateEventPartnerInvitePost(
  method: string,
  url: string,
  data: any,
  options: MockRouteOptions,
): Promise<MockRouteResult> {
  const createEventPartnerInviteMatch = url.match(
    /^\/events\/([^/]+)\/partner-invites$/,
  );
  if (createEventPartnerInviteMatch && method === "POST") {
    requireMockRole("MEMBER");
    const detail = requireEvent(createEventPartnerInviteMatch[1]);
    const now = new Date();
    if (!["OPEN", "FULL"].includes(detail.status))
      throw new Error("赛事不在报名期");
    if (
      (detail.registrationEndsAt &&
        new Date(detail.registrationEndsAt) <= now) ||
      (detail.startsAt && new Date(detail.startsAt) <= now)
    )
      throw new Error("赛事报名已截止");
    const partnerId = mockUser().id;
    const duplicate = (detail.teams || []).find(
      (team: any) =>
        !["CANCELLED", "REFUNDED"].includes(team.status) &&
        [team.captainId, team.playerAUserId, team.playerBUserId]
          .filter(Boolean)
          .includes(partnerId),
    );
    if (duplicate) throw new Error("当前账号已参加本赛事或正在候补");
    const invites = getEventPartnerInvites();
    invites.forEach((invite: any) => {
      if (
        invite.eventId === detail.id &&
        invite.partnerId === partnerId &&
        !invite.consumedAt &&
        !invite.revokedAt
      )
        invite.revokedAt = now.toISOString();
    });
    const expiresAt = new Date(
      Math.min(
        now.getTime() + 15 * 60_000,
        new Date(detail.registrationEndsAt).getTime(),
        new Date(detail.startsAt).getTime(),
      ),
    );
    const partnerInviteCode = `EP_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 14)}`;
    invites.push({
      id: newId("event-partner-invite"),
      eventId: detail.id,
      partnerId,
      partnerDisplayName: mockUser().displayName,
      partnerInviteCode,
      expiresAt: expiresAt.toISOString(),
      revokedAt: null,
      consumedAt: null,
      consumedTeamId: null,
      createdAt: now.toISOString(),
    });
    saveEventPartnerInvites(invites);
    return {
      handled: true,
      value: ok({
        partnerInviteCode,
        partnerDisplayName: mockUser().displayName,
        expiresAt: expiresAt.toISOString(),
      }),
    };
  }
  return { handled: false };
}

export async function handlePreviewEventPartnerInvitePost(
  method: string,
  url: string,
  data: any,
  options: MockRouteOptions,
): Promise<MockRouteResult> {
  const previewEventPartnerInviteMatch = url.match(
    /^\/events\/([^/]+)\/partner-invites\/preview$/,
  );
  if (previewEventPartnerInviteMatch && method === "POST") {
    requireMockRole("MEMBER");
    const detail = requireEvent(previewEventPartnerInviteMatch[1]);
    if (!["OPEN", "FULL"].includes(detail.status))
      throw new Error("赛事不在报名期");
    const invite = getEventPartnerInvites().find(
      (item: any) =>
        item.eventId === detail.id &&
        item.partnerInviteCode === text(data.partnerInviteCode),
    );
    if (
      !invite ||
      invite.revokedAt ||
      invite.consumedAt ||
      new Date(invite.expiresAt) <= new Date()
    )
      throw new Error("搭档授权码无效、已使用或已过期");
    if (invite.partnerId === mockUser().id)
      throw new Error("不能使用自己生成的搭档授权码");
    const duplicate = (detail.teams || []).find(
      (team: any) =>
        !["CANCELLED", "REFUNDED"].includes(team.status) &&
        [team.captainId, team.playerAUserId, team.playerBUserId]
          .filter(Boolean)
          .includes(invite.partnerId),
    );
    if (duplicate) throw new Error("授权搭档已参加本赛事或正在候补");
    return {
      handled: true,
      value: ok({
        partnerDisplayName: invite.partnerDisplayName,
        expiresAt: invite.expiresAt,
      }),
    };
  }
  return { handled: false };
}
