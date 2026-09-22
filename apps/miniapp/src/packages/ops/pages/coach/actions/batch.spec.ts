import { beforeEach, expect, it, vi } from "vitest";
import { executeLessonBatch } from "./batch";
import { endpoints } from "../../../../../services/api";
import { saveAuthSession } from "../../../../../services/auth-session";
vi.mock("../../../../../services/api", () => ({
  endpoints: { trainingBatch: vi.fn() },
}));
const storage = new Map<string, unknown>();
beforeEach(() => {
  vi.clearAllMocks();
  storage.clear();
  vi.stubGlobal("uni", {
    getStorageSync: (key: string) => storage.get(key),
    setStorageSync: (key: string, value: unknown) => storage.set(key, value),
    removeStorageSync: (key: string) => storage.delete(key),
  });
  saveAuthSession("token-1", "admin-1");
});
it("reuses per-student keys after an ambiguous network failure", async () => {
  vi.mocked(endpoints.trainingBatch)
    .mockRejectedValueOnce(new Error("连接中断"))
    .mockResolvedValueOnce({
      results: [
        { enrollmentId: "a", status: "SUCCEEDED" },
        { enrollmentId: "b", status: "SUCCEEDED" },
      ],
    });
  expect(
    (await executeLessonBatch("lesson", "confirmation", ["a", "b"])).every(
      (item) => item.status === "FAILED",
    ),
  ).toBe(true);
  await executeLessonBatch("lesson", "confirmation", ["a", "b"]);
  expect(vi.mocked(endpoints.trainingBatch).mock.calls[0][2]).toEqual(
    vi.mocked(endpoints.trainingBatch).mock.calls[1][2],
  );
  expect(
    [...storage.keys()].some((key) => key.includes("pending-creation")),
  ).toBe(false);
});
it("retains failed and missing results and clears only explicit successes", async () => {
  vi.mocked(endpoints.trainingBatch).mockResolvedValueOnce({
    results: [
      { enrollmentId: "a", status: "SUCCEEDED" },
      { enrollmentId: "b", status: "FAILED", message: "退款处理中" },
    ],
  });
  const results = await executeLessonBatch("lesson", "confirmation", [
    "a",
    "b",
    "c",
    "a",
  ]);
  const first = vi.mocked(endpoints.trainingBatch).mock.calls[0][2];
  expect(first.items).toHaveLength(3);
  expect(results.map((row) => row.status)).toEqual([
    "SUCCEEDED",
    "FAILED",
    "FAILED",
  ]);
  vi.mocked(endpoints.trainingBatch).mockResolvedValueOnce({
    results: [
      { enrollmentId: "b", status: "SUCCEEDED" },
      { enrollmentId: "c", status: "SUCCEEDED" },
    ],
  });
  await executeLessonBatch(
    "lesson",
    "confirmation",
    results
      .filter((row) => row.status === "FAILED")
      .map((row) => row.enrollmentId),
  );
  expect(vi.mocked(endpoints.trainingBatch).mock.calls[1][2].items).toEqual(
    first.items.slice(1),
  );
});
it("stops dispatching later chunks on connection loss and preserves all retry keys", async () => {
  vi.mocked(endpoints.trainingBatch).mockRejectedValue(new Error("offline"));
  const results = await executeLessonBatch(
    "lesson",
    "attendance",
    Array.from({ length: 65 }, (_, i) => String(i)),
  );
  expect(endpoints.trainingBatch).toHaveBeenCalledTimes(1);
  expect(results).toHaveLength(65);
  expect(results[50].message).toBe("尚未提交，请重试");
});
it("discards responses and stops further chunks after account switch", async () => {
  vi.mocked(endpoints.trainingBatch).mockImplementationOnce(async () => {
    saveAuthSession("token-2", "admin-2");
    return { results: [] };
  });
  await expect(
    executeLessonBatch(
      "lesson",
      "confirmation",
      Array.from({ length: 60 }, (_, i) => String(i)),
    ),
  ).rejects.toThrow("登录身份已变化");
  expect(endpoints.trainingBatch).toHaveBeenCalledTimes(1);
});
