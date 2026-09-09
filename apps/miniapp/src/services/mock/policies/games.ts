import { mockUser } from "../core";
import { getMockVenueCourts, getOrders } from "../venue";
import { getGames, getVenueBookings } from "../state";
import { hasMockRole, integer, newId } from "./common.js";
import { mockOperationWindow } from "./operation-window.js";
import { newOrderNo } from "./orders.js";
import { mockOperatingShareSnapshot } from "./master-data.js";

export const GAME_CAPACITY_MIN = 4;

export const GAME_CAPACITY_MAX = 6;

export const validGameCapacity = (capacity: unknown) => {
  const parsed = integer(capacity);
  return (
    Number.isFinite(parsed) &&
    parsed >= GAME_CAPACITY_MIN &&
    parsed <= GAME_CAPACITY_MAX
  );
};

export const gameCapacity = (game: any) =>
  validGameCapacity(game.capacity) ? integer(game.capacity) : 0;

export const activeRegistrationStatuses = ["REGISTERED", "PAID", "CHECKED_IN"];

export const promoteMockGameWaitlist = (game: any) => {
  const registrations = game.registrations || [];
  const seated = registrations.filter((item: any) =>
    activeRegistrationStatuses.includes(item.status),
  );
  game._count = { ...(game._count || {}), registrations: seated.length };
  if (!["OPEN", "FULL"].includes(game.status)) return null;
  if (seated.length >= gameCapacity(game)) return null;
  const next = registrations
    .filter((item: any) => item.status === "WAITLISTED" && !item.orderId)
    .sort((a: any, b: any) =>
      String(a.createdAt || a.id).localeCompare(String(b.createdAt || b.id)),
    )[0];
  if (!next) {
    if (game.status === "FULL") game.status = "OPEN";
    return null;
  }
  const orderId = newId("order");
  Object.assign(next, {
    status: "REGISTERED",
    orderId,
    promotedAt: new Date().toISOString(),
  });
  game._count = { ...(game._count || {}), registrations: seated.length + 1 };
  game.status = seated.length + 1 >= gameCapacity(game) ? "FULL" : "OPEN";
  const order = {
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
    memberId: next.userId,
    gameRegistration: {
      id: next.id,
      status: next.status,
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
      promotedFromWaitlist: true,
      operatingShare: mockOperatingShareSnapshot("GAME"),
    },
  };
  return { order, registration: next };
};

export const PUBLIC_GAME_STATUSES = [
  "OPEN",
  "FULL",
  "IN_PROGRESS",
  "COMPLETED",
];

export const publishedGameDetail = (id: string) => {
  const game = getGames().find(
    (item) =>
      item.id === id &&
      [...PUBLIC_GAME_STATUSES, "CANCELLED"].includes(item.status),
  );
  if (!game)
    throw Object.assign(new Error("球局不存在或尚未发布"), { statusCode: 404 });
  return game;
};

export const gameDetail = (game: any) => {
  const rows = game.registrations || [];
  const pendingCount = rows.filter(
    (item: any) => item.status === "REGISTERED",
  ).length;
  const confirmedCount = rows.filter((item: any) =>
    ["PAID", "CHECKED_IN", "COMPLETED"].includes(item.status),
  ).length;
  const courts = getMockVenueCourts();
  const courtIds = getVenueBookings()
    .filter((item) => item.gameId === game.id)
    .map((item) => item.courtId);
  return {
    id: game.id,
    title: game.title,
    level: game.level,
    status: game.status,
    startsAt: game.startsAt,
    endsAt: game.endsAt || null,
    capacity: game.capacity,
    feeCents: game.feeCents,
    newcomerOnly: Boolean(game.newcomerOnly),
    description: game.description || null,
    host: game.host
      ? {
          displayName: game.host.displayName,
          avatarUrl: game.host.avatarUrl || null,
        }
      : null,
    courtNames: courts
      .filter((court: any) => courtIds.includes(court.id))
      .map((court: any) => court.name),
    occupiedCount: pendingCount + confirmedCount,
    confirmedCount,
    pendingCount,
    waitlistCount: rows.filter((item: any) => item.status === "WAITLISTED")
      .length,
  };
};

export const gameParticipants = (game: any) => {
  if (!uni.getStorageSync("yanqing_access_token"))
    throw Object.assign(new Error("请登录后查看球友"), { statusCode: 401 });
  const user = mockUser();
  const rows = [...(game.registrations || [])].sort(
    (a, b) =>
      String(a.createdAt || "").localeCompare(String(b.createdAt || "")) ||
      String(a.id).localeCompare(String(b.id)),
  );
  const mine = rows.find((item) => item.userId === user.id);
  const order = mine?.orderId
    ? getOrders().find(
        (item) => item.id === mine.orderId && item.memberId === user.id,
      )
    : null;
  return {
    participants: rows
      .filter((item) =>
        ["PAID", "CHECKED_IN", "COMPLETED"].includes(item.status),
      )
      .map((item) => ({
        displayName:
          item.userId === user.id
            ? user.displayName
            : item.user?.displayName || item.displayName || "球友",
        avatarUrl:
          (item.userId === user.id
            ? user.avatarUrl
            : item.user?.avatarUrl || item.avatarUrl) || null,
        isMe: item.userId === user.id,
      })),
    myRegistration: mine
      ? {
          id: mine.id,
          status: mine.status,
          order: order ? { id: order.id, status: order.status } : null,
          waitlistPosition:
            mine.status === "WAITLISTED"
              ? rows
                  .filter((item) => item.status === "WAITLISTED")
                  .findIndex((item) => item.id === mine.id) + 1
              : null,
        }
      : null,
  };
};

export const publicGame = (game: any) => {
  const registration = (game.registrations || []).find(
    (item: any) => item.userId === mockUser().id,
  );
  const order = registration?.orderId
    ? getOrders().find((item: any) => item.id === registration.orderId)
    : null;
  return {
    id: game.id,
    title: game.title,
    level: game.level,
    status: game.status,
    startsAt: game.startsAt,
    endsAt: game.endsAt,
    capacity: game.capacity,
    feeCents: game.feeCents,
    newcomerOnly: Boolean(game.newcomerOnly),
    description: game.description || null,
    host: game.host
      ? {
          displayName: game.host.displayName,
          avatarUrl: game.host.avatarUrl || null,
        }
      : null,
    _count: {
      registrations: Number(game._count?.registrations || 0),
    },
    myRegistration: registration
      ? {
          id: registration.id,
          status: registration.status,
          orderStatus: order?.status || null,
        }
      : null,
  };
};

export const managedGame = (game: any) => {
  const observedAt = new Date();
  const configuration = mockOperationWindow(
    "operations.game_check_in_window.v1",
    { earlyMinutes: 30, lateMinutes: 30 },
    observedAt,
  );
  const scheduled = new Date(game.startsAt).getTime();
  const opensAt = new Date(scheduled - configuration.earlyMinutes * 60_000);
  const closesAt = new Date(scheduled + configuration.lateMinutes * 60_000);
  const state =
    observedAt < opensAt
      ? "NOT_OPEN"
      : observedAt <= closesAt
        ? "OPEN"
        : "CLOSED";
  return {
    id: game.id,
    code: game.code,
    title: game.title,
    level: game.level,
    status: game.status,
    startsAt: game.startsAt,
    endsAt: game.endsAt,
    capacity: game.capacity,
    feeCents: game.feeCents,
    newcomerOnly: Boolean(game.newcomerOnly),
    description: game.description || null,
    cancelReason: game.cancelReason || null,
    cancelledAt: game.cancelledAt || null,
    host: game.host
      ? {
          displayName: game.host.displayName,
          avatarUrl: game.host.avatarUrl || null,
        }
      : null,
    registrations: (game.registrations || []).map((registration: any) => {
      const order =
        registration.order ||
        getOrders().find((item: any) => item.id === registration.orderId);
      return {
        id: registration.id,
        status: registration.status,
        checkedInAt: registration.checkedInAt || null,
        createdAt: registration.createdAt,
        user: {
          displayName:
            registration.user?.displayName ||
            registration.displayName ||
            "报名球友",
          avatarUrl: registration.user?.avatarUrl || null,
        },
        order: order ? { status: order.status } : null,
      };
    }),
    checkInWindow: {
      opensAt: opensAt.toISOString(),
      closesAt: closesAt.toISOString(),
      state,
      mayHistoricallyOverride:
        state === "CLOSED" && hasMockRole("ADMIN", "SUPER_ADMIN"),
    },
  };
};

export const gameCommandResponse = (game: any) => ({
  id: game.id,
  code: game.code,
  title: game.title,
  level: game.level,
  status: game.status,
  startsAt: game.startsAt,
  endsAt: game.endsAt,
  capacity: game.capacity,
  feeCents: game.feeCents,
  newcomerOnly: Boolean(game.newcomerOnly),
  description: game.description || null,
  cancelReason: game.cancelReason || null,
  cancelledAt: game.cancelledAt || null,
});

export const gameCancellationResponse = (value: any) => {
  const policy = value.game?.cancelPolicySnapshot || {};
  return {
    game: gameCommandResponse(value.game),
    cancelledBookingCount: Number(value.cancelledBookingCount || 0),
    cancelledPendingOrders: Number(
      value.cancelledPendingOrders ?? policy.pendingOrderCount ?? 0,
    ),
    cancelledRegistrationCount: Number(
      value.cancelledRegistrationCount ??
        value.cancelledRegistrationIds?.length ??
        policy.registrationCount ??
        0,
    ),
    refundRequestCount: Number(
      value.refundRequestCount ??
        value.refundRequests?.length ??
        policy.refundRequestCount ??
        0,
    ),
    refundRequestedCents: Number(policy.refundRequestedCents || 0),
    idempotent: Boolean(value.idempotent),
  };
};

export const gameRegistrationCommandResponse = (registration: any) => ({
  id: registration.id,
  status: registration.status,
  checkedInAt: registration.checkedInAt || null,
});
