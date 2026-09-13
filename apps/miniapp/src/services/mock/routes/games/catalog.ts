import { mockUser } from "../../core";
import { availability } from "../../venue";
import {
  getGames,
  getVenueBookings,
  getVenueClosures,
  saveGames,
  saveVenueBookings,
} from "../../state";
import {
  ok,
  hasMockRole,
  requireMockRole,
  text,
  integer,
  newId,
} from "../../policies/common.js";
import { mockShanghaiBusinessDate } from "../../policies/front-desk.js";
import {
  GAME_CAPACITY_MIN,
  GAME_CAPACITY_MAX,
  validGameCapacity,
  PUBLIC_GAME_STATUSES,
  publishedGameDetail,
  gameDetail,
  gameParticipants,
  publicGame,
  managedGame,
  gameCommandResponse,
} from "../../policies/games.js";
import type { MockRouteResult, MockRouteOptions } from "../route-contract.js";

export async function handleGamesPost(
  method: string,
  url: string,
  data: any,
  options: MockRouteOptions,
): Promise<MockRouteResult> {
  if (url === "/games" && method === "POST") {
    requireMockRole("HOST", "ADMIN", "SUPER_ADMIN");
    const title = text(data.title);
    if (!title) throw new Error("球局标题不能为空");
    const startsAt = new Date(String(data.startsAt || ""));
    const endsAt = new Date(String(data.endsAt || ""));
    if (
      Number.isNaN(startsAt.getTime()) ||
      Number.isNaN(endsAt.getTime()) ||
      endsAt <= startsAt
    ) {
      throw new Error("球局时间设置无效");
    }
    if (startsAt <= new Date()) throw new Error("球局开始时间必须晚于当前时间");
    const capacity = integer(data.capacity) ? Number(data.capacity) : NaN;
    if (!validGameCapacity(capacity)) {
      throw new Error(
        `普通主理人球局人数上限必须在${GAME_CAPACITY_MIN}-${GAME_CAPACITY_MAX}人之间`,
      );
    }
    const feeCents = integer(data.feeCents) ? Number(data.feeCents) : 0;
    if (feeCents < 0) throw new Error("球局费用必须为非负整数");
    const courtIds = Array.isArray(data.courtIds)
      ? data.courtIds.map((id: unknown) => text(id)).filter(Boolean)
      : [];
    if (new Set(courtIds).size !== courtIds.length)
      throw new Error("场地不能重复");
    if (!courtIds.length) throw new Error("至少选择一个场地");
    const calendar = availability(mockShanghaiBusinessDate(startsAt));
    const selectedCourts = calendar.courts.filter((court: any) =>
      courtIds.includes(court.id),
    );
    if (selectedCourts.length !== courtIds.length)
      throw new Error("部分场地不存在或已停用");
    if (
      selectedCourts.some((court: any) =>
        ["MAINTENANCE", "TRAINING"].includes(court.usage),
      )
    )
      throw new Error("球局不能使用维护场或培训专用场");
    const closure = getVenueClosures().find(
      (item: any) =>
        courtIds.includes(item.courtId) &&
        item.status === "ACTIVE" &&
        new Date(item.startsAt).getTime() < endsAt.getTime() &&
        new Date(item.endsAt).getTime() > startsAt.getTime(),
    );
    if (closure) throw new Error(`所选场地时段已封场：${closure.reason}`);
    const occupied = (calendar.bookings || []).find(
      (item: any) =>
        courtIds.includes(item.courtId) &&
        item.status !== "CANCELLED" &&
        new Date(item.startsAt).getTime() < endsAt.getTime() &&
        new Date(item.endsAt).getTime() > startsAt.getTime(),
    );
    if (occupied) throw new Error("所选场地时段已被占用");
    const created = {
      ...data,
      id: newId("game"),
      title,
      status: "DRAFT",
      startsAt: startsAt.toISOString(),
      endsAt: endsAt.toISOString(),
      capacity,
      feeCents,
      hostId: mockUser().id,
      host: { displayName: mockUser().displayName },
      registrations: [],
      _count: { registrations: 0 },
      courtIds,
    };
    const gameBookings = courtIds.map((courtId: string) => ({
      id: newId("game-booking"),
      gameId: created.id,
      courtId,
      memberId: mockUser().id,
      status: "CONFIRMED",
      startsAt: created.startsAt,
      endsAt: created.endsAt,
      usage: "RETAIL",
    }));
    saveVenueBookings([...gameBookings, ...getVenueBookings()]);
    saveGames([created, ...getGames()]);
    return { handled: true, value: ok(created) };
  }
  return { handled: false };
}

export async function handleGamesGet(
  method: string,
  url: string,
  data: any,
  options: MockRouteOptions,
): Promise<MockRouteResult> {
  if (["/games", "/games/public"].includes(url) && method === "GET")
    return {
      handled: true,
      value: ok(
        getGames()
          .filter((game) => PUBLIC_GAME_STATUSES.includes(String(game.status)))
          .map(game => publicGame(game, url === "/games/public")),
      ),
    };
  return { handled: false };
}

export async function handleGamesManagedGet(
  method: string,
  url: string,
  data: any,
  options: MockRouteOptions,
): Promise<MockRouteResult> {
  if (url === "/games/managed" && method === "GET") {
    requireMockRole("HOST", "ADMIN", "SUPER_ADMIN");
    if (hasMockRole("ADMIN", "SUPER_ADMIN"))
      return { handled: true, value: ok(getGames().map(managedGame)) };
    const user = mockUser();
    return {
      handled: true,
      value: ok(
        getGames()
          .filter(
            (game) =>
              game.hostId === user.id ||
              (!game.hostId && game.host?.displayName === user.displayName),
          )
          .map(managedGame),
      ),
    };
  }
  return { handled: false };
}

export async function handleGameDetailGet(
  method: string,
  url: string,
  data: any,
  options: MockRouteOptions,
): Promise<MockRouteResult> {
  const gameDetailMatch = url.match(/^\/games\/([^/]+)(\/participants)?$/);
  if (gameDetailMatch && method === "GET") {
    const game = publishedGameDetail(decodeURIComponent(gameDetailMatch[1]));
    return {
      handled: true,
      value: ok(gameDetailMatch[2] ? gameParticipants(game) : gameDetail(game)),
    };
  }
  return { handled: false };
}

export async function handlePublishGamePost(
  method: string,
  url: string,
  data: any,
  options: MockRouteOptions,
): Promise<MockRouteResult> {
  const publishGameMatch = url.match(/^\/games\/([^/]+)\/publish$/);
  if (publishGameMatch && method === "POST") {
    requireMockRole("HOST", "ADMIN", "SUPER_ADMIN");
    const list = getGames();
    const game = list.find((item) => item.id === publishGameMatch[1]);
    if (!game) throw new Error("球局不存在");
    const hostOnly =
      hasMockRole("HOST") && !hasMockRole("ADMIN", "SUPER_ADMIN");
    if (hostOnly && game.hostId && game.hostId !== mockUser().id)
      throw new Error("只有本局主理人或管理员可操作该球局");
    if (game.status === "OPEN")
      return { handled: true, value: ok(gameCommandResponse(game)) };
    if (
      ["FULL", "IN_PROGRESS", "COMPLETED", "CANCELLED"].includes(game.status)
    ) {
      throw new Error(`球局当前状态为 ${game.status}，不能发布`);
    }
    if (game.startsAt && new Date(game.startsAt) <= new Date())
      throw new Error("球局时间已过期，不能发布");
    if (!validGameCapacity(game.capacity)) {
      throw new Error(
        `普通主理人球局人数上限必须在${GAME_CAPACITY_MIN}-${GAME_CAPACITY_MAX}人之间`,
      );
    }
    game.status = "OPEN";
    saveGames(list);
    return { handled: true, value: ok(gameCommandResponse(game)) };
  }
  return { handled: false };
}
