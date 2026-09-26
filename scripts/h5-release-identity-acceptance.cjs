// Local mock UI only. Browser checks do not replace WeChat device acceptance.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const base = process.env.OPS_UI_BASE_URL || 'http://127.0.0.1:5208';
if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(base)) throw new Error('Use a local mock build');
const out = path.resolve('output/role-workflows-2026-09-26/version');
fs.mkdirSync(out, { recursive: true });
(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  try {
    const page = await browser.newPage({ viewport: { width: 375, height: 812 }, reducedMotion: 'reduce' });
    const errors = [], blocked = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => {
      const url = new URL(route.request().url());
      if (/^https?:$/.test(url.protocol) && url.origin !== base) { blocked.push(url.origin); return route.abort(); }
      return route.continue();
    });
    await page.goto(base + '/#/pages/profile/index');
    await page.getByText('关于金羽会员', { exact: true }).click();
    await page.getByText('复制版本信息', { exact: true }).waitFor();
    assert.equal(await page.getByRole('dialog').count(), 0);
    assert.equal(await page.getByText('登录管理个人资料', { exact: true }).count(), 0);
    assert.equal(await page.getByText('检查服务连接', { exact: true }).count(), 0, 'Mock mode must not offer live connectivity checks');
    for (const [name, width, height] of [['375', 375, 812], ['320', 320, 568], ['landscape', 812, 375]]) {
      await page.setViewportSize({ width, height });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      const button = await page.getByText('复制版本信息', { exact: true }).boundingBox();
      assert(button && button.height >= 44);
      await page.screenshot({ path: path.join(out, 'about-' + name + '.png'), fullPage: true });
    }
    assert.deepEqual(errors, []);
    fs.writeFileSync(path.join(out, 'checks.json'), JSON.stringify({ checks: ['guest-about-entry', 'no-login-prompt', 'no-production-request', '375px', '320px', 'landscape', 'touch-target'], errors, blocked, mode: 'local mock' }, null, 2));
    console.log('PASS guest version information, portrait and landscape');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
