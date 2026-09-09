import { getEvents, saveEventDetail, saveEvents } from "../../state";
import {
  ok,
  requireMockRole,
  text,
  integer,
  newId,
} from "../../policies/common.js";
import {
  eventCapacity,
  eventMinimumPeople,
  eventRoundLimit,
  requireEvent,
  PUBLIC_EVENT_STATUSES,
  publicEvent,
  publicEventDetail,
  eventCommandResponse,
  managedEventSummary,
  managedEventDetail,
} from "../../policies/events.js";
import type { MockRouteResult, MockRouteOptions } from "../route-contract.js";

export async function handleEventsPost(
  method: string,
  url: string,
  data: any,
  options: MockRouteOptions,
): Promise<MockRouteResult> {
  if (url === "/events" && method === "POST") {
    requireMockRole("EVENT_MANAGER", "ADMIN", "SUPER_ADMIN");
    const name = text(data.name);
    const code = text(data.code);
    if (!code || !name) throw new Error("赛事编码和名称不能为空");
    const startsAt = new Date(String(data.startsAt || ""));
    const registrationEndsAt = new Date(String(data.registrationEndsAt || ""));
    if (
      Number.isNaN(startsAt.getTime()) ||
      Number.isNaN(registrationEndsAt.getTime()) ||
      registrationEndsAt >= startsAt
    ) {
      throw new Error("报名截止时间必须早于开赛时间");
    }
    if (startsAt <= new Date()) throw new Error("赛事开始时间必须晚于当前时间");
    if (registrationEndsAt <= new Date())
      throw new Error("报名截止时间必须晚于当前时间");
    const capacityPeople = integer(data.capacityPeople)
      ? Number(data.capacityPeople)
      : 48;
    const minimumPeople = integer(data.minimumPeople)
      ? Number(data.minimumPeople)
      : 24;
    const totalRounds = integer(data.totalRounds)
      ? Number(data.totalRounds)
      : 5;
    if (
      capacityPeople < 24 ||
      capacityPeople > 48 ||
      capacityPeople % 2 !== 0 ||
      minimumPeople !== 24 ||
      totalRounds !== 5
    ) {
      throw new Error("赛事必须固定为24-48人、24人成赛、五轮瑞士制");
    }
    const feeCents =
      integer(data.feeCents) && Number(data.feeCents) >= 0
        ? Number(data.feeCents)
        : 0;
    const created = {
      ...data,
      id: newId("event"),
      code,
      name,
      status: "DRAFT",
      currentRound: 0,
      startsAt: startsAt.toISOString(),
      registrationEndsAt: registrationEndsAt.toISOString(),
      capacityPeople,
      minimumPeople,
      totalRounds,
      feeCents,
      _count: { teams: 0 },
    };
    saveEvents([created, ...getEvents()]);
    return { handled: true, value: ok(created) };
  }
  return { handled: false };
}

export async function handleEventsGet(
  method: string,
  url: string,
  data: any,
  options: MockRouteOptions,
): Promise<MockRouteResult> {
  if (url === "/events" && method === "GET")
    return {
      handled: true,
      value: ok(
        getEvents()
          .filter((event) =>
            PUBLIC_EVENT_STATUSES.includes(String(event.status)),
          )
          .map(publicEvent),
      ),
    };
  return { handled: false };
}

export async function handleEventsManagedGet(
  method: string,
  url: string,
  data: any,
  options: MockRouteOptions,
): Promise<MockRouteResult> {
  if (url === "/events/managed" && method === "GET") {
    requireMockRole("EVENT_MANAGER", "FRONT_DESK", "ADMIN", "SUPER_ADMIN");
    return { handled: true, value: ok(getEvents().map(managedEventSummary)) };
  }
  return { handled: false };
}

export async function handleManagedEventDetailGet(
  method: string,
  url: string,
  data: any,
  options: MockRouteOptions,
): Promise<MockRouteResult> {
  const managedEventDetailMatch = url.match(/^\/events\/managed\/([^/]+)$/);
  if (managedEventDetailMatch && method === "GET") {
    requireMockRole("EVENT_MANAGER", "FRONT_DESK", "ADMIN", "SUPER_ADMIN");
    return {
      handled: true,
      value: ok(managedEventDetail(requireEvent(managedEventDetailMatch[1]))),
    };
  }
  return { handled: false };
}

export async function handleEventDetailGet(
  method: string,
  url: string,
  data: any,
  options: MockRouteOptions,
): Promise<MockRouteResult> {
  const eventDetailMatch = url.match(/^\/events\/([^/]+)$/);
  if (eventDetailMatch && method === "GET") {
    const detail = requireEvent(eventDetailMatch[1]);
    if (!PUBLIC_EVENT_STATUSES.includes(String(detail.status)))
      throw new Error("赛事不存在");
    return { handled: true, value: ok(publicEventDetail(detail)) };
  }
  return { handled: false };
}

export async function handlePublishEventPost(
  method: string,
  url: string,
  data: any,
  options: MockRouteOptions,
): Promise<MockRouteResult> {
  const publishEventMatch = url.match(/^\/events\/([^/]+)\/publish$/);
  if (publishEventMatch && method === "POST") {
    requireMockRole("EVENT_MANAGER", "ADMIN", "SUPER_ADMIN");
    const detail = requireEvent(publishEventMatch[1]);
    if (detail.status === "OPEN")
      return { handled: true, value: ok(eventCommandResponse(detail)) };
    if (detail.status !== "DRAFT")
      throw new Error(`赛事当前状态为 ${detail.status}，不能发布`);
    if (
      eventMinimumPeople(detail) !== 24 ||
      eventRoundLimit(detail) !== 5 ||
      eventCapacity(detail) < 24 ||
      eventCapacity(detail) > 48 ||
      eventCapacity(detail) % 2 !== 0
    ) {
      throw new Error("赛事配置不符合固定24-48人、五轮瑞士制要求");
    }
    if (
      detail.registrationEndsAt &&
      detail.startsAt &&
      new Date(detail.registrationEndsAt) >= new Date(detail.startsAt)
    )
      throw new Error("报名截止时间必须早于开赛时间");
    if (detail.startsAt && new Date(detail.startsAt) <= new Date())
      throw new Error("赛事开赛时间已过，不能发布");
    detail.status = "OPEN";
    saveEventDetail(detail);
    const event = getEvents().find((item) => item.id === publishEventMatch[1]);
    return {
      handled: true,
      value: ok(
        eventCommandResponse(
          event || { id: publishEventMatch[1], status: "OPEN" },
        ),
      ),
    };
  }
  return { handled: false };
}
