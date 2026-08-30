import { beforeEach, describe, expect, it, vi } from "vitest";

import { mockRequest } from "./router";
import {
  getEvents,
  getGames,
  getHostApplications,
  saveGames,
} from "./state";

const storage = new Map<string, unknown>();

vi.stubGlobal("uni", {
  getStorageSync: (key: string) => storage.get(key) ?? "",
  setStorageSync: (key: string, value: unknown) => storage.set(key, value),
  removeStorageSync: (key: string) => storage.delete(key),
});

const request = <T = any>(
  method: string,
  url: string,
  data: Record<string, unknown> = {},
) => mockRequest<T>(method, url, data);
const login = (role: string) => request("POST", "/auth/dev-login", { role });

function shanghaiDate(offsetDays: number) {
  const value = new Date(Date.now() + offsetDays * 86_400_000);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

describe("community host/game/event operation entrypoints", () => {
  beforeEach(async () => {
    storage.clear();
    await login("MEMBER");
  });

  it("persists one idempotent member host application", async () => {
    const first = await request("POST", "/games/hosts/apply");
    const replay = await request("POST", "/games/hosts/apply");

    expect(first).toMatchObject({ userId: "user-member", status: "APPLIED" });
    expect(replay).toEqual(first);
    expect(
      getHostApplications().filter((item) => item.userId === "user-member"),
    ).toHaveLength(1);
  });

  it("runs host create → publish → FIFO waitlist promotion and blocks cross-host actions", async () => {
    await login("HOST");
    const date = shanghaiDate(2);
    const created = await request("POST", "/games", {
      title: "主理人验收球局",
      level: "INTERMEDIATE",
      startsAt: `${date}T13:00:00+08:00`,
      endsAt: `${date}T15:00:00+08:00`,
      courtIds: ["court-1"],
      capacity: 4,
      feeCents: 6800,
      description: "候补晋级验收",
    });
    expect(created).toMatchObject({ status: "DRAFT", hostId: "user-host" });
    await expect(request("POST", `/games/${created.id}/publish`, {
      reason: "主理人核对场地后发布",
    })).resolves.toMatchObject({ status: "OPEN" });

    const games = getGames();
    const game = games.find((item) => item.id === created.id)!;
    game.status = "FULL";
    game.registrations = [
      { id: "seat-1", userId: "member-1", status: "REGISTERED", createdAt: new Date(Date.now() - 4_000).toISOString() },
      { id: "seat-2", userId: "member-2", status: "PAID", createdAt: new Date(Date.now() - 3_000).toISOString() },
      { id: "seat-3", userId: "member-3", status: "PAID", createdAt: new Date(Date.now() - 2_000).toISOString() },
      { id: "wait-1", userId: "member-wait", displayName: "候补会员", status: "WAITLISTED", orderId: null, createdAt: new Date(Date.now() - 1_000).toISOString() },
    ];
    saveGames(games);

    const promoted = await request(
      "POST",
      `/games/${created.id}/promote-waitlist`,
    );
    expect(promoted).toMatchObject({
      registration: { id: "wait-1", status: "REGISTERED" },
      order: { status: "PENDING" },
    });

    const others = getGames();
    others.unshift({
      id: "other-host-draft",
      title: "他人球局",
      hostId: "another-host",
      status: "DRAFT",
      capacity: 4,
      startsAt: `${date}T16:00:00+08:00`,
      endsAt: `${date}T18:00:00+08:00`,
      registrations: [],
    });
    saveGames(others);
    await expect(
      request("POST", "/games/other-host-draft/publish"),
    ).rejects.toThrow("本局主理人");
  });

  it("runs event-manager create → publish while rejecting member mutation", async () => {
    const startsDate = shanghaiDate(7);
    const deadlineDate = shanghaiDate(6);
    const command = {
      code: `EV-MOCK-${Date.now()}`,
      name: "赛事管理员验收积分赛",
      startsAt: `${startsDate}T09:00:00+08:00`,
      registrationEndsAt: `${deadlineDate}T20:00:00+08:00`,
      capacityPeople: 48,
      minimumPeople: 24,
      totalRounds: 5,
      feeCents: 9900,
    };
    await expect(request("POST", "/events", command)).rejects.toThrow("无权");

    await login("EVENT_MANAGER");
    const created = await request("POST", "/events", command);
    expect(created).toMatchObject({ status: "DRAFT", currentRound: 0 });
    const published = await request(
      "POST",
      `/events/${created.id}/publish`,
      { reason: "赛制、时间与费用已复核" },
    );
    expect(published).toMatchObject({ id: created.id, status: "OPEN" });
    expect(getEvents().find((item) => item.id === created.id)).toMatchObject({
      status: "OPEN",
    });
  });
});
