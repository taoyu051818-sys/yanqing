import { mockUser } from "../../core";
import { getOrders, saveOrders } from "../../venue";
import { getGames, saveGames } from "../../state";
import {
  ok,
  hasMockRole,
  requireMockRole,
  text,
  newId,
} from "../../policies/common.js";
import { assertMockOperationWindow } from "../../policies/operation-window.js";
import {
  newOrderNo,
  beginMockOrderCreation,
  finishMockOrderCreation,
} from "../../policies/orders.js";
import { mockOperatingShareSnapshot } from "../../policies/master-data.js";
import {
  GAME_CAPACITY_MIN,
  GAME_CAPACITY_MAX,
  validGameCapacity,
  gameCapacity,
  activeRegistrationStatuses,
  promoteMockGameWaitlist,
  gameRegistrationCommandResponse,
} from "../../policies/games.js";
import type { MockRouteResult, MockRouteOptions } from "../route-contract.js";

export async function handleRegisterGamePost(
  method: string,
  url: string,
  data: any,
  options: MockRouteOptions,
): Promise<MockRouteResult> {
  const registerGameMatch = url.match(/^\/games\/([^/]+)\/register$/);
  if (registerGameMatch && method === "POST") {
    const creation = beginMockOrderCreation(data.creationIdempotencyKey, {
      kind: "GAME_REGISTRATION",
      gameId: registerGameMatch[1],
      sourceChannel: text(data.sourceChannel) || "MINI_PROGRAM",
    });
    if (creation.tracked && creation.replayed)
      return { handled: true, value: ok(creation.response) };
    const list = getGames();
    const game = list.find((item) => item.id === registerGameMatch[1]);
    if (!game || !["OPEN", "FULL"].includes(String(game.status)))
      throw new Error("球局不在报名中");
    if (!validGameCapacity(game.capacity)) {
      throw new Error(
        `普通主理人球局人数上限必须在${GAME_CAPACITY_MIN}-${GAME_CAPACITY_MAX}人之间`,
      );
    }
    const userId = mockUser().id;
    const registrations = game.registrations || [];
    const activeRegistrations = registrations.filter((item: any) =>
      activeRegistrationStatuses.includes(item.status),
    );
    const waitlisted = registrations.filter(
      (item: any) => item.status === "WAITLISTED",
    );
    const existing = registrations.find((item: any) => item.userId === userId);
    if (
      existing &&
      [...activeRegistrationStatuses, "WAITLISTED"].includes(existing.status)
    ) {
      throw new Error("已经报名该球局或正在候补");
    }
    // Preserve FIFO when a seat has opened but an older waiting member has not
    // yet been promoted by the operations workflow.
    if (
      activeRegistrations.length >= gameCapacity(game) ||
      waitlisted.length > 0
    ) {
      const registration = existing
        ? {
            ...existing,
            status: "WAITLISTED",
            orderId: undefined,
            checkedInAt: undefined,
          }
        : {
            id: newId("reg"),
            userId,
            displayName: mockUser().displayName,
            status: "WAITLISTED",
            createdAt: new Date().toISOString(),
          };
      game.registrations = existing
        ? registrations.map((item: any) =>
            item.id === existing.id ? registration : item,
          )
        : [registration, ...registrations];
      game._count = {
        ...(game._count || {}),
        registrations: activeRegistrations.length,
      };
      game.status = "FULL";
      game.waitlistCount = waitlisted.length + 1;
      saveGames(list);
      return {
        handled: true,
        value: finishMockOrderCreation(creation, {
          registration,
          waitlistPosition: waitlisted.length + 1,
          status: "WAITLISTED",
        }),
      };
    }
    const orderId = newId("order");
    const registration = existing
      ? { ...existing, status: "REGISTERED", orderId, checkedInAt: undefined }
      : {
          id: newId("reg"),
          userId,
          displayName: mockUser().displayName,
          status: "REGISTERED",
          orderId,
          createdAt: new Date().toISOString(),
        };
    game.registrations = existing
      ? registrations.map((item: any) =>
          item.id === existing.id ? registration : item,
        )
      : [...registrations, registration];
    game._count = {
      ...(game._count || {}),
      registrations: activeRegistrations.length + 1,
    };
    if (game._count.registrations >= gameCapacity(game)) game.status = "FULL";
    const createdOrder = {
      id: orderId,
      orderNo: newOrderNo("GO"),
      title: game.title,
      status: "PENDING",
      businessType: "GAME",
      gameId: game.id,
      payableCents: Number(game.feeCents || 0),
      paidCents: 0,
      refundedCents: 0,
      createdAt: new Date().toISOString(),
      memberId: userId,
      member: { displayName: mockUser().displayName },
      gameRegistration: {
        id: registration.id,
        status: registration.status,
        game: {
          id: game.id,
          title: game.title,
          status: game.status,
          startsAt: game.startsAt,
          endsAt: game.endsAt,
        },
      },
      parameterSnapshot: {
        gameId: game.id,
        hostId: game.hostId,
        operatingShare: mockOperatingShareSnapshot("GAME"),
      },
    };
    saveGames(list);
    const orders = getOrders();
    saveOrders([createdOrder, ...orders]);
    return {
      handled: true,
      value: finishMockOrderCreation(creation, createdOrder),
    };
  }
  return { handled: false };
}

export async function handlePromoteGameWaitlistPost(
  method: string,
  url: string,
  data: any,
  options: MockRouteOptions,
): Promise<MockRouteResult> {
  const promoteGameWaitlistMatch = url.match(
    /^\/games\/([^/]+)\/promote-waitlist$/,
  );
  if (promoteGameWaitlistMatch && method === "POST") {
    requireMockRole("HOST", "FRONT_DESK", "ADMIN", "SUPER_ADMIN");
    const games = getGames();
    const game = games.find((item) => item.id === promoteGameWaitlistMatch[1]);
    if (!game) throw new Error("球局不存在");
    const hostOnly =
      hasMockRole("HOST") && !hasMockRole("FRONT_DESK", "ADMIN", "SUPER_ADMIN");
    if (hostOnly && game.hostId && game.hostId !== mockUser().id)
      throw new Error("只有本局主理人或管理员可操作该球局");
    const promoted = promoteMockGameWaitlist(game);
    saveGames(games);
    if (!promoted) return { handled: true, value: ok(null) };
    saveOrders([promoted.order, ...getOrders()]);
    return { handled: true, value: ok(promoted) };
  }
  return { handled: false };
}

export async function handleGameCheckInPost(
  method: string,
  url: string,
  data: any,
  options: MockRouteOptions,
): Promise<MockRouteResult> {
  const gameCheckInMatch = url.match(/^\/games\/([^/]+)\/check-in\/([^/]+)$/);
  if (gameCheckInMatch && method === "POST") {
    requireMockRole("HOST", "FRONT_DESK", "ADMIN", "SUPER_ADMIN");
    const list = getGames();
    const game = list.find((item) => item.id === gameCheckInMatch[1]);
    if (!game) throw new Error("球局不存在");
    if (
      hasMockRole("HOST") &&
      !hasMockRole("FRONT_DESK", "ADMIN", "SUPER_ADMIN") &&
      game.hostId &&
      game.hostId !== mockUser().id
    )
      throw new Error("主理人只能操作自己负责的球局");
    if (["DRAFT", "CANCELLED", "COMPLETED"].includes(game.status))
      throw new Error("当前球局状态不可签到");
    const registration = game?.registrations?.find(
      (item: any) =>
        item.id === gameCheckInMatch[2] || item.userId === gameCheckInMatch[2],
    );
    if (registration?.status === "CHECKED_IN")
      return {
        handled: true,
        value: ok(gameRegistrationCommandResponse(registration)),
      };
    if (!registration) throw new Error("报名记录不存在");
    if (registration.status !== "PAID") throw new Error("报名未支付或不存在");
    const registrationOrder = getOrders().find(
      (order) => order.id === registration.orderId,
    );
    if (registrationOrder?.status === "REFUND_PENDING")
      throw new Error("订单正在等待退款审批，请先处理退款后再签到");
    const timeWindowPolicy = assertMockOperationWindow({
      parameterKey: "operations.game_check_in_window.v1",
      defaults: { earlyMinutes: 30, lateMinutes: 30 },
      startsAt: game.startsAt,
      endsAt: game.startsAt,
      action: "GAME_CHECK_IN",
      objectType: "GameRegistration",
      objectId: registration.id,
      overrideReason: data.overrideReason,
    });
    Object.assign(registration, {
      status: "CHECKED_IN",
      checkedInAt: new Date().toISOString(),
      checkInTimeWindowPolicy: timeWindowPolicy,
    });
    saveGames(list);
    return {
      handled: true,
      value: ok(gameRegistrationCommandResponse(registration)),
    };
  }
  return { handled: false };
}
