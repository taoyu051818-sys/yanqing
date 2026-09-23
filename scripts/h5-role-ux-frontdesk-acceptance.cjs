// Only local mock data is mutated; external requests are blocked.
const base = process.env.OPS_UI_BASE_URL || "http://127.0.0.1:5198";
if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(base))
  throw new Error("Local mock build required");
require("fs").mkdirSync("/tmp/role-ux-smoke", { recursive: true });
const { chromium } = require("playwright");
const assert = require("assert");
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
  const go = async (r) => {
    await p.goto(base + "/#" + r);
    await p.reload();
    await p.waitForTimeout(2000);
  };
  const btn = (t) =>
    p
      .locator("uni-button")
      .filter({ hasText: new RegExp("^\\s*" + t + "\\s*$") });
  await go("/packages/admin/pages/switch/index");
  assert(
    await p.evaluate(
      async () => (await import("/src/services/http.ts")).isMockMode,
    ),
  );
  await p.getByText("超级管理端", { exact: true }).click();
  await p.waitForTimeout(1000);
  await go("/packages/ops/pages/coach/index?view=create-trial");
  await p.locator(".member-option").first().click();
  await p.waitForTimeout(500);
  assert.equal(await p.locator(".selected-person").count(), 1);
  console.log(
    "member selected",
    await p.locator(".selected-person").innerText(),
  );
  await p.evaluate(async () => {
    const m = await import("/src/services/mock/state.ts");
    const lesson = m.getTrainingSessions()[0];
    m.saveTrainingSessions([
      ...m.getTrainingSessions(),
      {
        ...lesson,
        id: "role-trial-session",
        classId: "class-adult",
        startsAt: new Date(Date.now() + 86400000).toISOString(),
        endsAt: new Date(Date.now() + 90000000).toISOString(),
        status: "SCHEDULED",
      },
    ]);
  });
  await go("/packages/ops/pages/coach/index?view=create-trial");
  await p.locator(".member-option").first().click();
  await p.waitForTimeout(500);
  await btn("预约试听").click();
  await p.waitForTimeout(2000);
  const trials = await p.evaluate(async () => {
    const m = await import("/src/services/mock/state.ts");
    return m
      .getTrainingTrials()
      .map((t) => ({
        memberId: t.memberId,
        sessionId: t.sessionId,
        status: t.status,
      }));
  });
  console.log("trial records", trials);
  assert.equal(trials.length, 1);
  console.log("trial saved without a second confirmation");
  await go("/pages/workspace/index");
  await p.getByText("代会员订场", { exact: true }).click();
  await p.waitForTimeout(2000);
  assert.equal(await p.locator(".inline-member-search").count(), 1);
  await p.locator(".inline-member-search .member-option").first().click();
  assert.equal(await p.locator(".inline-member-search").count(), 0);
  console.log("assisted picker selected inline");
  await go("/packages/ops/pages/inventory/index");
  const stock = await p.locator("body").innerText();
  console.log("stock", stock.slice(-1100));
  if (await btn("报损").count()) {
    await btn("报损").first().click();
    await p.waitForTimeout(300);
    const form = await p.locator(".operation-form").innerText();
    assert(!form.includes("请选择商品"));
    assert(!form.includes("请选择来源库位"));
    assert(!form.includes("请选择来源批次"));
    await btn("破损").click();
    console.log("stock context prefilled");
  }
  await go(
    "/packages/ops/pages/transactions/index?view=refunds&before=2026-09-20",
  );
  assert((await p.locator("body").innerText()).includes("2026-09-20"));
  console.log("finance date context retained");
  await p.setViewportSize({ width: 844, height: 390 });
  await go("/packages/ops/pages/coach/index?view=create-product");
  await p.emulateMedia({ reducedMotion: "reduce" });
  assert((await p.locator(".save-bar").boundingBox()).height < 150);
  await p.screenshot({
    path: "/tmp/role-ux-smoke/landscape.png",
    fullPage: true,
  });
  assert.deepEqual(errors, []);
  await b.close();
  console.log("PASS other role flows");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
