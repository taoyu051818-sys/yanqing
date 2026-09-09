import { mockUser } from "../../core";
import { assertMockEventContacts } from "../../event-signup";
import {
  participantError,
  participantPhone,
} from "../../../../utils/event-signup";
import { getOrders, saveOrders } from "../../venue";
import {
  getEventPartnerInvites,
  saveEventDetail,
  saveEventPartnerInvites,
} from "../../state";
import {
  ok,
  requireMockRole,
  isMockMemberSelfService,
  text,
  newId,
} from "../../policies/common.js";
import {
  newOrderNo,
  beginMockOrderCreation,
  finishMockOrderCreation,
} from "../../policies/orders.js";
import { mockOperatingShareSnapshot } from "../../policies/master-data.js";
import {
  activeTeamStatuses,
  eventCapacity,
  eventPaymentDueAt,
  promoteMockEventWaitlist,
  requireEvent,
  publicEventRegistration,
} from "../../policies/events.js";
import type { MockRouteResult, MockRouteOptions } from "../route-contract.js";

export async function handleMyEventRegistrationGet(
  method: string,
  url: string,
  data: any,
  options: MockRouteOptions,
): Promise<MockRouteResult> {
  const myEventRegistrationMatch = url.match(
    /^\/events\/([^/]+)\/registration\/me$/,
  );
  if (myEventRegistrationMatch && method === "GET") {
    const detail = requireEvent(myEventRegistrationMatch[1]);
    const registration = (detail.teams || [])
      .filter((team: any) =>
        [team.captainId, team.playerAUserId, team.playerBUserId]
          .filter(Boolean)
          .includes(mockUser().id),
      )
      .sort((left: any, right: any) =>
        String(right.createdAt || "").localeCompare(
          String(left.createdAt || ""),
        ),
      )[0];
    if (!registration) return { handled: true, value: ok(null) };
    if (registration.status !== "WAITLISTED") {
      const order = getOrders().find(
        (item) => item.id === registration.orderId,
      );
      return {
        handled: true,
        value: ok({
          registration: publicEventRegistration(registration, order),
          waitlistPosition: null,
        }),
      };
    }
    const queue = (detail.teams || [])
      .filter((team: any) => team.status === "WAITLISTED")
      .sort((left: any, right: any) =>
        `${left.waitlistedAt || left.createdAt || ""}:${left.id}`.localeCompare(
          `${right.waitlistedAt || right.createdAt || ""}:${right.id}`,
        ),
      );
    return {
      handled: true,
      value: ok({
        registration: publicEventRegistration(registration),
        waitlistPosition: Math.max(
          1,
          queue.findIndex((team: any) => team.id === registration.id) + 1,
        ),
      }),
    };
  }
  return { handled: false };
}

export async function handleRegisterEventPost(
  method: string,
  url: string,
  data: any,
  options: MockRouteOptions,
): Promise<MockRouteResult> {
  const registerEventMatch = url.match(/^\/events\/([^/]+)\/register$/);
  if (registerEventMatch && method === "POST") {
    const memberSelfService =
      isMockMemberSelfService() || Boolean(data.registrationMode);
    if (memberSelfService) requireMockRole("MEMBER");
    const manual = data.registrationMode === "MANUAL";
    const captainPlays = manual ? data.captainPlays !== false : true;
    let playerAPhone = participantPhone(data.playerAPhone),
      playerBPhone = participantPhone(data.playerBPhone);
    const creation = beginMockOrderCreation(data.creationIdempotencyKey, {
      kind: "EVENT_REGISTRATION",
      eventId: registerEventMatch[1],
      name: text(data.name),
      ...(memberSelfService && !manual
        ? { partnerInviteCode: text(data.partnerInviteCode) }
        : {
            playerAName: text(data.playerAName),
            playerBName: text(data.playerBName),
            playerAUserId: text(data.playerAUserId) || null,
            playerBUserId: text(data.playerBUserId) || null,
          }),
      category: text(data.category),
      sourceChannel: text(data.sourceChannel) || "MINI_PROGRAM",
      ...(manual
        ? {
            registrationMode: "MANUAL",
            captainPlays,
            playerAPhone,
            playerBPhone,
            consent: data.consent,
          }
        : {}),
    });
    if (creation.tracked && creation.replayed)
      return { handled: true, value: ok(creation.response) };
    const detail = requireEvent(registerEventMatch[1]);
    if (!["OPEN", "FULL"].includes(detail.status))
      throw new Error("赛事不在报名期");
    if (
      detail.registrationEndsAt &&
      new Date(detail.registrationEndsAt) <= new Date()
    )
      throw new Error("赛事报名已截止");
    const teamName = text(data.name);
    let playerAName = text(data.playerAName);
    let playerBName = text(data.playerBName);
    let playerAUserId = text(data.playerAUserId) || mockUser().id;
    let playerBUserId = text(data.playerBUserId);
    let partnerInvite: any = null;
    let partnerInviteBook: any[] = [];
    if (memberSelfService && manual) {
      if (
        text(data.partnerInviteCode) ||
        text(data.playerBUserId) ||
        (text(data.playerAUserId) && data.playerAUserId !== mockUser().id)
      )
        throw new Error("代填报名不能直接绑定他人账号或同时使用邀请");
      if (data.consent !== true) throw new Error("请确认已征得两位选手同意");
      const error =
        participantError(playerAName, playerAPhone) ||
        participantError(playerBName, playerBPhone);
      if (error) throw new Error(error);
      playerAUserId = captainPlays ? mockUser().id : "";
      playerBUserId = "";
    } else if (memberSelfService) {
      const partnerInviteCode = text(data.partnerInviteCode);
      if (!partnerInviteCode)
        throw new Error("会员报名必须填写搭档本人生成的授权码");
      if (
        text(data.playerAUserId) &&
        text(data.playerAUserId) !== mockUser().id
      )
        throw new Error("会员报名不能替其他账号占用队长席位");
      if (text(data.playerBUserId))
        throw new Error("会员报名不能直接指定搭档账号");
      partnerInviteBook = getEventPartnerInvites();
      partnerInvite = partnerInviteBook.find(
        (item: any) =>
          item.eventId === detail.id &&
          item.partnerInviteCode === partnerInviteCode,
      );
      if (
        !partnerInvite ||
        partnerInvite.revokedAt ||
        partnerInvite.consumedAt ||
        new Date(partnerInvite.expiresAt) <= new Date()
      )
        throw new Error("搭档授权码无效、已使用或已过期");
      if (partnerInvite.partnerId === mockUser().id)
        throw new Error("不能使用自己生成的搭档授权码");
      if (!partnerInvite.partnerId) throw new Error("搭档尚未确认邀请");
      if (partnerInvite.captainId && partnerInvite.captainId !== mockUser().id)
        throw new Error("这份邀请只能由发起的队长提交报名");
      if (
        partnerInvite.captainId &&
        (partnerInvite.teamName !== teamName ||
          partnerInvite.category !== data.category)
      )
        throw new Error("队名或组别与邀请不一致，请重新发起");
      playerAName = partnerInvite.playerAName || mockUser().displayName;
      playerBName =
        partnerInvite.playerBName || partnerInvite.partnerDisplayName;
      playerAPhone = partnerInvite.playerAPhone || "";
      playerBPhone = partnerInvite.playerBPhone || "";
      playerAUserId = mockUser().id;
      playerBUserId = partnerInvite.partnerId;
    }
    if (!teamName || !playerAName || !playerBName)
      throw new Error("固定双打必须填写队名和两名队员");
    if (
      playerAName.toLocaleLowerCase() === playerBName.toLocaleLowerCase() &&
      !(playerAPhone && playerBPhone && playerAPhone !== playerBPhone)
    )
      throw new Error("固定双打的两名队员不能相同");
    if (playerBUserId && playerAUserId === playerBUserId)
      throw new Error("固定双打的两名账号不能相同");
    const orders = getOrders();
    promoteMockEventWaitlist(detail, orders);
    const activeTeams = (detail.teams || []).filter((team: any) =>
      activeTeamStatuses.includes(team.status),
    );
    const waitlistedTeams = (detail.teams || []).filter(
      (team: any) => team.status === "WAITLISTED",
    );
    const currentUserId = mockUser().id;
    const existing = (detail.teams || []).find(
      (team: any) =>
        [...activeTeamStatuses, "WAITLISTED"].includes(team.status) &&
        [team.captainId, team.playerAUserId, team.playerBUserId]
          .filter(Boolean)
          .includes(currentUserId),
    );
    if (existing) throw new Error("当前用户已参加本赛事");
    const participantIds = [playerAUserId, playerBUserId].filter(Boolean);
    assertMockEventContacts(
      detail,
      [playerAPhone, playerBPhone],
      participantIds,
    );
    const duplicateParticipant = (detail.teams || []).some(
      (team: any) =>
        [...activeTeamStatuses, "WAITLISTED"].includes(team.status) &&
        [team.captainId, team.playerAUserId, team.playerBUserId]
          .filter(Boolean)
          .some((id: string) => participantIds.includes(id)),
    );
    if (duplicateParticipant)
      throw new Error("同一账号不能参加同一赛事的多个固定双打队伍");
    const now = new Date();
    const createdAt = now.toISOString();
    const capacityTeams = Math.floor(eventCapacity(detail) / 2);
    const shouldWaitlist =
      activeTeams.length >= capacityTeams || waitlistedTeams.length > 0;
    const orderId = shouldWaitlist ? null : newId("order");
    const team = {
      id: newId("team"),
      name: teamName,
      playerAName,
      playerBName,
      category: data.category || "MIXED_DOUBLES",
      status: shouldWaitlist ? "WAITLISTED" : "REGISTERED",
      captainId: currentUserId,
      playerAUserId,
      playerBUserId: playerBUserId || null,
      ...(manual || playerAPhone || playerBPhone
        ? {
            registrationMode: manual ? "MANUAL" : "INVITE",
            captainPlays,
            playerAPhone,
            playerBPhone,
          }
        : {}),
      orderId,
      createdAt,
      waitlistedAt: shouldWaitlist ? createdAt : null,
      paymentDueAt: shouldWaitlist ? null : eventPaymentDueAt(detail, now),
      payableCents: Number(detail.feeCents || 0),
      listAmountCents: Number(detail.feeCents || 0),
      sourceChannel: text(data.sourceChannel) || "MINI_PROGRAM",
      creationIdempotencyKey: text(data.creationIdempotencyKey) || null,
      creationCommandHash: creation.tracked ? creation.commandHash : null,
      points: 0,
      wins: 0,
      losses: 0,
      scoreDiff: 0,
      finalRank: null,
    };
    if (partnerInvite) {
      partnerInvite.consumedAt = createdAt;
      partnerInvite.consumedTeamId = team.id;
      saveEventPartnerInvites(partnerInviteBook);
    } else if (manual) {
      const outstanding = getEventPartnerInvites();
      outstanding.forEach((item: any) => {
        if (
          item.eventId === detail.id &&
          item.captainId === currentUserId &&
          !item.consumedAt &&
          !item.revokedAt
        )
          item.revokedAt = createdAt;
      });
      saveEventPartnerInvites(outstanding);
    }
    detail.teams = [...(detail.teams || []), team];
    if (shouldWaitlist) {
      detail.status = "FULL";
      saveOrders(orders);
      saveEventDetail(detail);
      return {
        handled: true,
        value: finishMockOrderCreation(creation, {
          registration: team,
          waitlistPosition: waitlistedTeams.length + 1,
          status: "WAITLISTED",
        }),
      };
    }
    detail._count = { ...(detail._count || {}), teams: activeTeams.length + 1 };
    if (detail._count.teams >= capacityTeams) detail.status = "FULL";
    saveEventDetail(detail);
    const createdOrder = {
      id: orderId,
      orderNo: newOrderNo("EV"),
      title: `${detail.name} 报名`,
      status: "PENDING",
      businessType: "EVENT",
      eventId: detail.id,
      eventTeamId: team.id,
      payableCents: Number(detail.feeCents || 0),
      paidCents: 0,
      refundedCents: 0,
      createdAt,
      memberId: currentUserId,
      member: { displayName: mockUser().displayName },
      eventTeam: {
        ...team,
        event: {
          id: detail.id,
          name: detail.name,
          status: detail.status,
          startsAt: detail.startsAt,
        },
      },
      parameterSnapshot: {
        eventId: detail.id,
        eventTeamId: team.id,
        paymentDueAt: team.paymentDueAt,
        operatingShare: mockOperatingShareSnapshot("EVENT"),
      },
    };
    saveOrders([createdOrder, ...orders]);
    return {
      handled: true,
      value: finishMockOrderCreation(creation, {
        ...createdOrder,
        eventTeam: team,
      }),
    };
  }
  return { handled: false };
}

export async function handlePromoteEventWaitlistPost(
  method: string,
  url: string,
  data: any,
  options: MockRouteOptions,
): Promise<MockRouteResult> {
  const promoteEventWaitlistMatch = url.match(
    /^\/events\/([^/]+)\/promote-waitlist$/,
  );
  if (promoteEventWaitlistMatch && method === "POST") {
    requireMockRole("EVENT_MANAGER", "ADMIN", "SUPER_ADMIN");
    const detail = requireEvent(promoteEventWaitlistMatch[1]);
    const orders = getOrders();
    const result = promoteMockEventWaitlist(detail, orders);
    saveOrders(orders);
    saveEventDetail(detail);
    return { handled: true, value: ok(result) };
  }
  return { handled: false };
}
