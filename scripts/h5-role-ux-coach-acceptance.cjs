// Only local mock data is mutated; external requests are blocked.
const base = process.env.OPS_UI_BASE_URL || "http://127.0.0.1:5198";
if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(base))
  throw new Error("Local mock build required");
require("fs").mkdirSync("/tmp/role-ux-smoke", { recursive: true });
const { chromium } = require("playwright");
const assert = require("assert");
const fs = require("fs");
(async () => {
  const b = await chromium.launch({ channel: "chrome", headless: true });
  const p = await b.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  p.on("pageerror", (e) => errors.push(e.message));
  p.on("dialog", (d) => d.accept());
  await p.route("**/*", (r) =>
    r
      .request()
      .url()
      .startsWith(base + "/")
      ? r.continue()
      : r.abort(),
  );
  const go = async (route) => {
    await p.goto(base + "/#" + route);
    await p.reload();
    await p.waitForTimeout(2200);
  };
  const btn = (text) =>
    p
      .locator("uni-button")
      .filter({
        hasText:
          text instanceof RegExp
            ? new RegExp(
                text.source.replace(/^\^/, "^\\s*").replace(/\$$/, "\\s*$"),
              )
            : text,
      });
  await go("/packages/admin/pages/switch/index");
  assert(
    await p.evaluate(
      async () => (await import("/src/services/http.ts")).isMockMode,
    ),
  );
  await p.getByText("教练端", { exact: true }).click();
  await p.waitForTimeout(1200);
  await p.evaluate(async () => {
    const m = await import("/src/services/mock/state.ts");
    const e = m.getEnrollments()[0],
      l = m.getTrainingSessions()[0];
    const end = Date.now() - 60000,
      start = end - 3600000;
    m.saveTrainingSessions([
      ...m.getTrainingSessions(),
      {
        ...l,
        id: "role-ux-lesson",
        classId: "class-adult",
        startsAt: new Date(start).toISOString(),
        endsAt: new Date(end).toISOString(),
        status: "SCHEDULED",
      },
    ]);
    m.saveEnrollments(
      Array.from({ length: 10 }, (_, i) => ({
        ...e,
        id: "role-enrollment-" + i,
        classId: "class-adult",
        buyer: { ...e.buyer, displayName: "回归学员" + (i + 1) },
        status: "ACTIVE",
        usedSessions: 0,
        consumedSessions: 0,
        prepaidBalanceCents: 128000,
        confirmedRevenueCents: 0,
        expiresAt: new Date(Date.now() + 86400000 * 60).toISOString(),
        attendances: [
          {
            id: "role-attendance-" + i,
            sessionId: "role-ux-lesson",
            enrollmentId: "role-enrollment-" + i,
            status: "ATTENDED",
            consumedSessions: 0,
            operatorId: null,
          },
        ],
      })),
    );
  });
  await go("/packages/ops/pages/coach/index?lessonId=role-ux-lesson");
  await btn(/^提交消课建议 · 10人$/).click();
  assert((await p.locator("body").innerText()).includes("等待管理员确认"));
  await btn(/^选择全部可处理学员$/).click();
  await btn(/^确认提交 · 10人$/).click();
  await p.waitForTimeout(2400);
  assert(
    (await p.locator("body").innerText()).includes("已提交消课建议 10 人"),
  );
  const results = await p.evaluate(async () => {
    const m = await import("/src/services/mock/state.ts");
    return m
      .getEnrollments()
      .filter((e) => e.id.startsWith("role-enrollment"))
      .map((e) => e.attendances[0]);
  });
  assert(
    results.every((a) => a.operatorId === "user-coach" && !a.consumedSessions),
  );
  assert.deepEqual(errors, []);
  await p.screenshot({
    path: "/tmp/role-ux-smoke/coach-proposed.png",
    fullPage: true,
  });
  await b.close();
  console.log("PASS coach: 10 proposals in 3 taps, no balance posting");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
