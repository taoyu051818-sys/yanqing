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
  await p.getByText("超级管理端", { exact: true }).click();
  await p.waitForTimeout(1200);
  await p.evaluate(async () => {
    const m = await import("/src/services/mock/state.ts");
    m.saveYouthTrainingRules([
      {
        id: "role-test-rule",
        version: "test",
        status: "PUBLISHED",
        effectiveFrom: new Date(Date.now() - 86400000).toISOString(),
        maxTotalSessions: 100,
        maxValidityDays: 365,
        maxContractAmountCents: 1000000,
        warningThresholdDays: 7,
        hardBlock: true,
      },
    ]);
  });
  await go("/packages/ops/pages/coach/index?view=create-product");
  console.log(
    "before creation",
    p.url(),
    (await p.locator("body").innerText()).slice(-1100),
  );
  await p.locator(".creation-form input").nth(0).fill("负担回归不限课程");
  await btn(/^不限$/).click();
  await btn(/^创建并上架$/).click();
  await p.getByText("确认创建", { exact: true }).click();
  await p.waitForTimeout(2500);
  console.log("course", (await p.locator("body").innerText()).slice(-700));
  await go("/packages/ops/pages/coach/index?view=products");
  assert((await p.locator("body").innerText()).includes("负担回归不限课程"));
  await p
    .locator(".product-card")
    .filter({ hasText: "负担回归不限课程" })
    .getByText("编辑设置", { exact: true })
    .click();
  await p.waitForTimeout(1800);
  assert(p.url().includes("edit-product"));
  await p.screenshot({ path: "/tmp/role-ux-smoke/editor.png", fullPage: true });
  await go("/packages/ops/pages/coach/index?view=create-trial");
  await p.locator(".person").filter({ hasText: "小羽学员" }).click();
  await p.waitForTimeout(500);
  assert((await p.locator("body").innerText()).includes("小羽学员"));
  await p.screenshot({
    path: "/tmp/role-ux-smoke/trial-selected.png",
    fullPage: true,
  });
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
            status: "PENDING",
            consumedSessions: 0,
          },
        ],
      })),
    );
  });
  await go("/packages/ops/pages/coach/index?lessonId=role-ux-lesson");
  console.log(
    "attendance",
    (await p.locator("body").innerText()).slice(0, 1300),
  );
  assert.equal(await btn(/^到场$/).count(), 10);
  for (let i = 0; i < 10; i++)
    await btn(/^到场$/)
      .first()
      .click();
  assert((await p.locator("body").innerText()).includes("待保存 10 人到场"));
  await btn(/^保存点名$/).click();
  await p.waitForTimeout(2400);
  console.log("saved", (await p.locator("body").innerText()).slice(0, 850));
  assert((await p.locator("body").innerText()).includes("已登记到场 10 人"));
  await btn(/^确认消课 · 10人$/).click();
  await btn(/^选择全部可处理学员$/).click();
  await btn(/^确认扣课入账 · 10人$/).click();
  await p.waitForTimeout(2600);
  console.log("posted", (await p.locator("body").innerText()).slice(0, 850));
  assert(
    (await p.locator("body").innerText()).includes("已确认扣课入账 10 人"),
  );
  await p.screenshot({
    path: "/tmp/role-ux-smoke/batch-confirmed.png",
    fullPage: true,
  });
  await p.setViewportSize({ width: 320, height: 568 });
  await go("/packages/ops/pages/coach/index?view=create-product");
  const bounds = await p.locator(".save-bar").boundingBox();
  assert(bounds.y + bounds.height <= 569);
  await p.screenshot({
    path: "/tmp/role-ux-smoke/small-phone.png",
    fullPage: true,
  });
  assert.deepEqual(errors, []);
  console.log(
    "PASS course-create/edit, learner selection, 10 arrivals (11 taps), bulk confirmation (3 taps), 320px fixed footer; no page errors",
  );
  await b.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
