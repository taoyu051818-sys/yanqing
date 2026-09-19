// Local mock H5 only. Native WeChat map callbacks are covered by use-location.spec.ts.
const { chromium } = require('playwright');
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const base = process.env.OPS_UI_BASE_URL || 'http://127.0.0.1:5197';
if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(base)) throw new Error('Use a local mock build');
const out = path.resolve(process.env.OPS_UI_OUTPUT || 'artifacts/venue-location'); fs.mkdirSync(out, { recursive: true });
(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  try {
    const context = await browser.newContext({ viewport: { width:375, height:812 } });
    const errors = [];
    await context.route('**/*', r => { const url = new URL(r.request().url()); if (/^https?:$/.test(url.protocol) && url.origin !== base) { errors.push(url.origin); return r.abort(); } return r.continue(); });
    const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
    const wait = () => page.waitForTimeout(700);
    const go = async route => { await page.goto(base + '/#' + route); await wait(); };
    await go('/packages/admin/pages/switch/index'); await page.getByText('超级管理端', { exact:true }).click(); await page.waitForTimeout(2200);
    await page.getByText('球馆信息', { exact:true }).click(); await wait();
    await page.getByText('修改球馆信息', { exact:true }).click(); await wait();
    assert.equal(await page.locator('#venue-latitude,#venue-longitude').count(), 0);
    await page.locator('#venue-address textarea').fill('延庆区测试街道金羽球馆');
    await page.getByText('地图选点', { exact:true }).click();
    assert((await page.locator('body').innerText()).includes('请在微信小程序中使用地图选点'));
    await page.screenshot({ path:path.join(out, 'address-editor.png'), fullPage:true });
    await page.setViewportSize({ width:320, height:568 }); await wait();
    const footer = await page.locator('.page-footer').boundingBox(); assert(footer && footer.y + footer.height <= 568);
    const bounds = await page.locator('.location-panel').boundingBox(); assert(bounds && bounds.x >= 0 && bounds.x + bounds.width <= 320);
    await page.screenshot({ path:path.join(out, 'address-editor-320.png'), fullPage:true });
    await page.getByText('保存修改', { exact:true }).click(); await wait();
    assert((await page.locator('.dialog-content').innerText()).includes('仅保存文字地址'));
    await page.getByText('确认保存', { exact:true }).click(); await page.waitForTimeout(1800);
    assert((await page.locator('body').innerText()).includes('延庆区测试街道金羽球馆'));
    assert((await page.locator('body').innerText()).includes('仅文字地址'));
    await go('/pages/home/index');
    assert((await page.locator('.venue-summary').innerText()).includes('延庆区测试街道金羽球馆'));
    assert.equal(await page.getByText('复制地址', { exact:true }).count(), 1);
    assert.equal(await page.getByText('地图导航', { exact:true }).count(), 0);
    await page.screenshot({ path:path.join(out, 'member-address.png'), fullPage:true });
    assert.deepEqual(errors, []);
    console.log('PASS: text-only address saved, member address/copy visible, no coordinate inputs, H5 map fallback, 320px fixed footer, no external requests or browser errors');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
