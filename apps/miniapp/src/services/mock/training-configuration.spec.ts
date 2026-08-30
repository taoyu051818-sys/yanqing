import { beforeEach, describe, expect, it, vi } from "vitest";

import { mockRequest } from "./router";
import {
  getTrainingCreationCommands,
  getTrainingProducts,
  getTrainingSessions,
  getVenueBookings,
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

describe("mock training configuration creation", () => {
  beforeEach(async () => {
    storage.clear();
    await login("MEMBER");
  });

  it("requires an admin, reason and persistent idempotency key for products", async () => {
    const command = {
      code: "MOCK-PRODUCT-01",
      name: "模拟成人提高课包",
      audience: "ADULT",
      totalSessions: 12,
      validityDays: 120,
      priceCents: 128_000,
      refundRule: { beforeStart: "FULL_REFUND", afterStart: "UNUSED" },
      reason: "新学期课程配置",
      creationIdempotencyKey: "training-product-mock-01",
    };

    await expect(request("POST", "/training/products", command)).rejects.toThrow("无权");
    await login("ADMIN");
    await expect(
      request("POST", "/training/products", { ...command, reason: "" }),
    ).rejects.toThrow("创建原因");
    await expect(
      request("POST", "/training/products", {
        ...command,
        creationIdempotencyKey: "",
      }),
    ).rejects.toThrow("培训创建幂等键");

    const first = await request("POST", "/training/products", command);
    const replay = await request("POST", "/training/products", command);

    expect(replay).toEqual(first);
    expect(getTrainingProducts().filter((item) => item.code === command.code)).toHaveLength(1);
    expect(getTrainingCreationCommands()).toHaveLength(1);
    await expect(
      request("POST", "/training/products", { ...command, name: "篡改后的课包" }),
    ).rejects.toThrow("不同命令");
  });

  it("creates and replays an admin class under the selected product", async () => {
    await login("ADMIN");
    const command = {
      code: "MOCK-CLASS-01",
      productId: "training-adult",
      name: "周日晚提高班",
      coachId: "user-coach",
      schedule: { weekday: 7, startsAt: "19:00", endsAt: "21:00" },
      capacity: 16,
      coachCostCents: 20_000,
      assistantCostCents: 3_000,
      materialCostCents: 1_000,
      reason: "新增周日固定班",
      creationIdempotencyKey: "training-class-mock-01",
    };

    const first = await request("POST", "/training/classes", command);
    const replay = await request("POST", "/training/classes", command);

    expect(replay).toEqual(first);
    expect(
      getTrainingProducts()
        .find((product) => product.id === command.productId)
        ?.classes.filter((item: any) => item.code === command.code),
    ).toHaveLength(1);
    await expect(
      request("POST", "/training/classes", {
        ...command,
        capacity: 0,
        creationIdempotencyKey: "training-class-invalid-01",
      }),
    ).rejects.toThrow("容量");

    await login("COACH");
    const date = shanghaiDate(3);
    const ownedSession = await request("POST", "/training/sessions", {
      classId: first.id,
      startsAt: `${date}T10:00:00+08:00`,
      endsAt: `${date}T12:00:00+08:00`,
      courtIds: ["court-18"],
      reason: "主教练发布新班首节课",
      creationIdempotencyKey: "training-owned-session-01",
    });
    await expect(request<any[]>("GET", "/training/sessions")).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: ownedSession.id })]),
    );
    await expect(
      request("POST", "/training/classes", {
        ...command,
        creationIdempotencyKey: "training-class-coach-01",
      }),
    ).rejects.toThrow("无权");
  });

  it("creates one coach-owned session with court occupancy and replays before conflict checks", async () => {
    await login("COACH");
    const date = shanghaiDate(2);
    const command = {
      classId: "class-adult",
      startsAt: `${date}T13:00:00+08:00`,
      endsAt: `${date}T15:00:00+08:00`,
      courtIds: ["court-17"],
      note: "双打轮转训练",
      reason: "补充本周训练课表",
      creationIdempotencyKey: "training-session-mock-01",
    };

    const first = await request("POST", "/training/sessions", command);
    const replay = await request("POST", "/training/sessions", command);

    expect(replay).toEqual(first);
    expect(getTrainingSessions().filter((item) => item.id === first.id)).toHaveLength(1);
    expect(
      getVenueBookings().filter(
        (item) => item.trainingClassId === command.classId && item.courtId === "court-17",
      ),
    ).toHaveLength(1);
    await expect(
      request("POST", "/training/sessions", {
        ...command,
        creationIdempotencyKey: "training-session-conflict-02",
      }),
    ).rejects.toThrow("已有预订冲突");

    await expect(
      request("POST", "/training/sessions", {
        ...command,
        classId: "class-youth",
        startsAt: `${date}T16:00:00+08:00`,
        endsAt: `${date}T18:00:00+08:00`,
        courtIds: ["court-18"],
        creationIdempotencyKey: "training-session-other-03",
      }),
    ).rejects.toThrow("自己负责的班级");
  });
});
