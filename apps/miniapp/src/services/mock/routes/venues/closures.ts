import { mockUser } from "../../core";
import { availability, getMockVenueCourts } from "../../venue";
import { getVenueClosures, saveVenueClosures } from "../../state";
import {
  ok,
  requireMockRole,
  text,
  requireIdempotencyKey,
  newId,
} from "../../policies/common.js";
import { mockShanghaiBusinessDate } from "../../policies/front-desk.js";
import { venueClosureView } from "../../policies/venues.js";
import type { MockRouteResult, MockRouteOptions } from "../route-contract.js";

export async function handleVenuesClosuresGet(
  method: string,
  url: string,
  data: any,
  options: MockRouteOptions,
): Promise<MockRouteResult> {
  if (url === "/venues/closures" && method === "GET") {
    requireMockRole("FRONT_DESK", "ADMIN", "SUPER_ADMIN");
    const status = text(data.status);
    if (status && !["ACTIVE", "CANCELLED"].includes(status))
      throw new Error("封场状态无效");
    const from = data.from ? new Date(String(data.from)) : null;
    const to = data.to ? new Date(String(data.to)) : null;
    if (from && Number.isNaN(from.getTime()))
      throw new Error("查询开始时间无效");
    if (to && Number.isNaN(to.getTime())) throw new Error("查询结束时间无效");
    if (from && to && from >= to)
      throw new Error("查询结束时间必须晚于开始时间");
    const courtId = text(data.courtId);
    return {
      handled: true,
      value: ok(
        getVenueClosures()
          .filter((closure) => !courtId || closure.courtId === courtId)
          .filter((closure) => !status || closure.status === status)
          .filter((closure) => !to || new Date(closure.startsAt) < to)
          .filter((closure) => !from || new Date(closure.endsAt) > from)
          .sort(
            (left, right) =>
              new Date(left.startsAt).getTime() -
              new Date(right.startsAt).getTime(),
          )
          .map(venueClosureView),
      ),
    };
  }
  return { handled: false };
}

export async function handleVenuesClosuresPost(
  method: string,
  url: string,
  data: any,
  options: MockRouteOptions,
): Promise<MockRouteResult> {
  if (url === "/venues/closures" && method === "POST") {
    requireMockRole("ADMIN", "SUPER_ADMIN");
    const courtId = text(data.courtId);
    const startsAt = new Date(String(data.startsAt || ""));
    const endsAt = new Date(String(data.endsAt || ""));
    const reason = text(data.reason);
    const creationIdempotencyKey = requireIdempotencyKey(
      data.creationIdempotencyKey,
      "封场创建幂等键",
    );
    if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime()))
      throw new Error("封场开始或结束时间无效");
    if (endsAt <= startsAt) throw new Error("封场结束时间必须晚于开始时间");
    if (endsAt <= new Date()) throw new Error("不能创建已经结束的封场计划");
    if (reason.length < 2 || reason.length > 300)
      throw new Error("封场原因长度必须为2-300个字符");

    const closures = getVenueClosures();
    const replay = closures.find(
      (closure) => closure.creationIdempotencyKey === creationIdempotencyKey,
    );
    if (replay) {
      if (
        replay.createdById !== mockUser().id ||
        replay.courtId !== courtId ||
        new Date(replay.startsAt).getTime() !== startsAt.getTime() ||
        new Date(replay.endsAt).getTime() !== endsAt.getTime() ||
        replay.reason !== reason
      ) {
        throw new Error("封场幂等键已用于不同命令");
      }
      return { handled: true, value: ok(venueClosureView(replay)) };
    }

    const date = mockShanghaiBusinessDate(startsAt);
    const calendar = availability(date);
    const court = getMockVenueCourts().find((item) => item.id === courtId);
    if (!court) throw new Error("场地不存在");
    const overlappingClosure = closures.find(
      (closure) =>
        closure.courtId === courtId &&
        closure.status === "ACTIVE" &&
        new Date(closure.startsAt).getTime() < endsAt.getTime() &&
        new Date(closure.endsAt).getTime() > startsAt.getTime(),
    );
    if (overlappingClosure)
      throw new Error(`该场地已有重叠封场：${overlappingClosure.reason}`);
    const blockingBookings = (calendar.bookings || []).filter(
      (booking: any) =>
        booking.courtId === courtId &&
        booking.status !== "CANCELLED" &&
        new Date(booking.endsAt).getTime() > Date.now() &&
        new Date(booking.startsAt).getTime() < endsAt.getTime() &&
        new Date(booking.endsAt).getTime() > startsAt.getTime(),
    );
    if (blockingBookings.length) {
      const details = blockingBookings
        .slice(0, 20)
        .map(
          (booking: any) =>
            `${booking.startsAt}~${booking.endsAt}[${booking.orderId || booking.id || "fixture"}]`,
        )
        .join("；");
      throw new Error(
        `封场范围内已有 ${blockingBookings.length} 笔未取消预约，需先逐笔处理，系统不会自动取消或退款：${details}`,
      );
    }
    const now = new Date().toISOString();
    const created = {
      id: newId("court-closure"),
      courtId,
      startsAt: startsAt.toISOString(),
      endsAt: endsAt.toISOString(),
      reason,
      status: "ACTIVE",
      creationIdempotencyKey,
      createdById: mockUser().id,
      cancelledById: null,
      cancelledAt: null,
      cancelReason: null,
      court: {
        id: court.id,
        code: court.code,
        name: court.name,
        enabled: court.enabled,
      },
      createdBy: { id: mockUser().id, displayName: mockUser().displayName },
      cancelledBy: null,
      createdAt: now,
      updatedAt: now,
      auditTrail: [
        {
          action: "COURT_CLOSURE_CREATED",
          actorId: mockUser().id,
          createdAt: now,
        },
      ],
    };
    saveVenueClosures([created, ...closures]);
    return { handled: true, value: ok(venueClosureView(created)) };
  }
  return { handled: false };
}

export async function handleCancelVenueClosurePost(
  method: string,
  url: string,
  data: any,
  options: MockRouteOptions,
): Promise<MockRouteResult> {
  const cancelVenueClosureMatch = url.match(
    /^\/venues\/closures\/([^/]+)\/cancel$/,
  );
  if (cancelVenueClosureMatch && method === "POST") {
    requireMockRole("ADMIN", "SUPER_ADMIN");
    const reason = text(data.reason);
    if (reason.length < 2 || reason.length > 300)
      throw new Error("取消原因长度必须为2-300个字符");
    const closures = getVenueClosures();
    const closure = closures.find(
      (item) => item.id === cancelVenueClosureMatch[1],
    );
    if (!closure) throw new Error("封场记录不存在");
    if (closure.status === "CANCELLED")
      return { handled: true, value: ok(venueClosureView(closure)) };
    const now = new Date().toISOString();
    closure.status = "CANCELLED";
    closure.cancelledById = mockUser().id;
    closure.cancelledAt = now;
    closure.cancelReason = reason;
    closure.cancelledBy = {
      id: mockUser().id,
      displayName: mockUser().displayName,
    };
    closure.updatedAt = now;
    closure.auditTrail = [
      ...(closure.auditTrail || []),
      {
        action: "COURT_CLOSURE_CANCELLED",
        actorId: mockUser().id,
        reason,
        createdAt: now,
      },
    ];
    saveVenueClosures(closures);
    return { handled: true, value: ok(venueClosureView(closure)) };
  }
  return { handled: false };
}
