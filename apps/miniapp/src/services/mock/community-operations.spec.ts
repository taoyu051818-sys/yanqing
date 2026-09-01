import { beforeEach, describe, expect, it, vi } from "vitest";

import { mockRequest } from "./router";
import {
  getEvents,
  getEventDetail,
  getAuditLogs,
  getGames,
  getHostApplications,
  saveGames,
  saveEventDetail,
  saveEvents,
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

  it("scopes the management list to the host while administrators receive every game", async () => {
    const date = shanghaiDate(2);
    const games = getGames();
    games.unshift({
      id: "other-host-managed",
      title: "其他主理人球局",
      hostId: "another-host",
      host: { id: "another-host", displayName: "其他主理人" },
      status: "OPEN",
      capacity: 4,
      startsAt: `${date}T18:00:00+08:00`,
      endsAt: `${date}T20:00:00+08:00`,
      registrations: [],
    });
    saveGames(games);

    await login("HOST");
    const hostList = await request<any[]>("GET", "/games/managed");
    expect(hostList.map((item) => item.id)).not.toContain("other-host-managed");
    expect(hostList.some((item) => item.host?.displayName === "周末主理人阿凯")).toBe(true);

    await login("ADMIN");
    const adminList = await request<any[]>("GET", "/games/managed");
    expect(adminList.map((item) => item.id)).toEqual(
      expect.arrayContaining(["game-weekend", "other-host-managed"]),
    );

    await login("MEMBER");
    await expect(request("GET", "/games/managed")).rejects.toThrow("无权");
  });

  it("keeps public game reads published and free of operations fields", async () => {
    const games = getGames();
    games.unshift(
      {
        id: "draft-hidden",
        title: "未发布草稿",
        status: "DRAFT",
        hostId: "host-secret",
        courtBookings: [{ id: "booking-secret" }],
      },
      {
        id: "cancelled-hidden",
        title: "已取消球局",
        status: "CANCELLED",
        cancelReason: "内部原因",
      },
    );
    saveGames(games);

    const publicGames = await request<any[]>("GET", "/games");

    expect(publicGames.map((game) => game.id)).not.toEqual(
      expect.arrayContaining(["draft-hidden", "cancelled-hidden"]),
    );
    expect(publicGames.length).toBeGreaterThan(0);
    expect(publicGames[0]).not.toHaveProperty("hostId");
    expect(publicGames[0]).not.toHaveProperty("registrations");
    expect(publicGames[0]).not.toHaveProperty("courtBookings");
    expect(publicGames[0].host).not.toHaveProperty("id");
  });

  it("blocks finance from manually promoting a game waitlist", async () => {
    await login("FINANCE");
    await expect(
      request("POST", "/games/game-weekend/promote-waitlist"),
    ).rejects.toThrow("无权");
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

  it("projects public events while preserving protected management detail", async () => {
    const base = getEventDetail("event-yanqing-open");
    const completed = {
      ...base,
      id: "event-public-result",
      code: "EV-PUBLIC-RESULT",
      name: "公开赛果",
      status: "COMPLETED",
      teams: [
        {
          id: "team-secret",
          captainId: "captain-secret",
          playerAUserId: "member-a",
          playerBUserId: "member-b",
          orderId: "order-secret",
          name: "冠军队",
          category: "MIXED_DOUBLES",
          status: "COMPLETED",
          points: 10,
          wins: 5,
          losses: 0,
          scoreDiff: 30,
          finalRank: 1,
        },
      ],
      matches: [{ id: "match-secret", teamAId: "team-secret" }],
    };
    const draft = {
      ...base,
      id: "event-draft-hidden",
      code: "EV-DRAFT-HIDDEN",
      name: "赛事草稿",
      status: "DRAFT",
    };
    const cancelled = {
      ...base,
      id: "event-cancelled-hidden",
      code: "EV-CANCEL-HIDDEN",
      name: "取消赛事",
      status: "CANCELLED",
    };
    saveEvents([completed, draft, cancelled, ...getEvents()]);
    saveEventDetail(completed);
    saveEventDetail(draft);
    saveEventDetail(cancelled);

    const publicEvents = await request<any[]>("GET", "/events");
    expect(publicEvents.map((event) => event.id)).not.toEqual(
      expect.arrayContaining([draft.id, cancelled.id]),
    );
    expect(publicEvents.find((event) => event.id === completed.id)).not.toHaveProperty("teams");

    const publicDetail = await request<any>("GET", `/events/${completed.id}`);
    expect(publicDetail).not.toHaveProperty("teams");
    expect(publicDetail).not.toHaveProperty("matches");
    expect(publicDetail.standings[0]).toEqual(
      expect.objectContaining({ name: "冠军队", finalRank: 1 }),
    );
    expect(publicDetail.standings[0]).not.toHaveProperty("id");
    expect(publicDetail.standings[0]).not.toHaveProperty("captainId");
    await expect(request("GET", `/events/${draft.id}`)).rejects.toThrow("不存在");

    await expect(request("GET", "/events/managed")).rejects.toThrow("无权");
    await login("EVENT_MANAGER");
    const managed = await request<any>("GET", `/events/managed/${completed.id}`);
    expect(managed.teams[0]).toMatchObject({
      id: "team-secret",
      name: "冠军队",
    });
    expect(managed.teams[0]).not.toHaveProperty("captainId");
    expect(managed.teams[0]).not.toHaveProperty("playerAUserId");
    expect(managed.teams[0]).not.toHaveProperty("playerBUserId");
    expect(managed.teams[0]).not.toHaveProperty("orderId");
    expect(managed.matches[0]).toHaveProperty("id", "match-secret");
  });

  it("lets an event manager replace one complete unplayed pairing round with an idempotent audit", async () => {
    await login("EVENT_MANAGER");
    const detail = getEventDetail("event-golden");
    const teams = detail.teams as any[];
    const round = 3;
    const current = Array.from({ length: 6 }, (_, index) => ({
      id: `manual-source-${index + 1}`,
      round,
      teamAId: teams[index * 2].id,
      teamBId: teams[index * 2 + 1].id,
      courtLabel: `${index + 1}号场`,
      startingScoreA: 0,
      startingScoreB: 0,
      scoreA: null,
      scoreB: null,
      status: "PENDING",
    }));
    detail.status = "IN_PROGRESS";
    detail.currentRound = round;
    detail.matches = [
      ...(detail.matches as any[]).filter((match) => match.round < round),
      ...current,
    ];
    saveEventDetail(detail);
    const command = {
      pairings: current.map((match, index) => ({
        teamAId: match.teamAId,
        teamBId:
          index === 0
            ? current[1].teamBId
            : index === 1
              ? current[0].teamBId
              : match.teamBId,
        courtLabel: match.courtLabel,
      })),
      reason: "同俱乐部队伍已相遇，现场调整对手",
      idempotencyKey: "mock-pairing-correction-1",
    };

    const first = await request(
      "POST",
      `/events/event-golden/rounds/${round}/pairings/correct`,
      command,
    );
    const replay = await request(
      "POST",
      `/events/event-golden/rounds/${round}/pairings/correct`,
      command,
    );

    expect(first).toEqual(replay);
    expect(first[0]).toMatchObject({
      teamAId: current[0].teamAId,
      teamBId: current[1].teamBId,
      status: "PENDING",
    });
    expect(
      getAuditLogs().filter(
        (item) => item.action === "EVENT_PAIRINGS_CORRECTED",
      ),
    ).toHaveLength(1);

    await login("MEMBER");
    await expect(
      request(
        "POST",
        `/events/event-golden/rounds/${round}/pairings/correct`,
        { ...command, idempotencyKey: "mock-pairing-member-denied" },
      ),
    ).rejects.toThrow("无权");
  });
});
