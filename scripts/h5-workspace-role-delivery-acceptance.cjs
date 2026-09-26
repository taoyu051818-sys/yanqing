// Local mock only: role landing pages, direct task routes and dashboard failure recovery.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');
const base = process.env.OPS_UI_BASE_URL || 'http://127.0.0.1:5210';
if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(base)) throw Error('Local mock server required');
const out = path.resolve(process.env.OPS_UI_OUTPUT || 'output/workspace-role-delivery');
fs.mkdirSync(out, { recursive: true });

(async () => {
  const browser = await chromium.launch({ channel:'chrome', headless:true });
  const context = await browser.newContext({ viewport:{ width:375, height:812 }, reducedMotion:'reduce' });
  const errors = [];
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    return /^https?:$/.test(url.protocol) && url.origin !== base ? route.abort() : route.continue();
  });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  const go = async route => {
    await page.goto(base + '/#' + route);
    await page.waitForTimeout(700);
  };
  const selectRole = async label => {
    await go('/packages/admin/pages/switch/index');
    assert.equal(await page.evaluate(async () => (await import('/src/services/http.ts')).isMockMode), true);
    await page.getByText(label, { exact:true }).click();
    await page.waitForURL('**/#/pages/workspace/index');
    await page.locator('.shortcut-tile').first().waitFor();
    await page.waitForTimeout(1800);
  };
  const labels = () => page.locator('.shortcut-tile').allInnerTexts();
  const capture = async filename => {
    // Wait for font/layout paint without changing or hiding the application's content.
    await page.evaluate(async () => {
      await document.fonts.ready;
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    });
    const viewport = page.viewportSize();
    const textRegions = await page.locator('.workspace-title .title,.shortcut-tile uni-text,.workspace-nav uni-text,.summary-metric .metric-value').evaluateAll(nodes => nodes.map(node => {
      const r = node.getBoundingClientRect();
      return { text:node.textContent, x:r.x, y:r.y, right:r.right, bottom:r.bottom };
    }));
    // First-screen acceptance uses a viewport capture: fullPage can trigger an H5 reflow.
    const buffer = await page.screenshot({ fullPage:false });
    const { data, info } = await sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject:true });
    for (const rect of textRegions.filter(r => r.x >= 0 && r.y >= 0 && r.right <= viewport.width && r.bottom <= viewport.height)) {
      let ink = 0;
      for (let y = Math.ceil(rect.y); y < Math.floor(rect.bottom); y++) {
        for (let x = Math.ceil(rect.x); x < Math.floor(rect.right); x++) {
          const index = (y * info.width + x) * info.channels;
          if (data[index] < 180 && data[index + 1] < 180 && data[index + 2] < 180 && data[index + 3] > 0) ink++;
        }
      }
      assert(ink > 8, `${filename}: no rendered text pixels for ${rect.text}`);
    }
    fs.writeFileSync(path.join(out, filename), buffer);
  };
  const checkLayout = async name => {
    for (const size of [{ width:375,height:812 }, { width:320,height:568 }, { width:812,height:375 }]) {
      await page.setViewportSize(size);
      await page.waitForTimeout(100);
      const bounds = await page.locator('.shortcut-tile,.workspace-nav').evaluateAll(nodes => nodes.map(node => {
        const rect = node.getBoundingClientRect();
        return { x:rect.x, right:rect.right, y:rect.y, bottom:rect.bottom, width:rect.width, height:rect.height };
      }));
      assert(bounds.every(item => item.x >= 0 && item.right <= size.width + 1 && item.width >= 44 && item.height >= 44));
      const footer = bounds.at(-1);
      assert(footer.bottom <= size.height + 1);
      if (size.width < 500) assert(bounds.slice(0, -1).every(item => item.bottom <= footer.y), `${name}: shortcuts below fold`);
      await capture(`${name}-${size.width}.png`);
    }
    await page.setViewportSize({ width:375, height:812 });
  };
  await selectRole('前台端');
  assert.deepEqual((await labels()).map(text => text.trim()), ['代会员订场','订单与流水','预约试听']);
  assert.equal(await page.locator('.today-summary').count(), 0);
  await checkLayout('frontdesk');
  await page.getByText('预约试听', { exact:true }).click();
  await page.waitForURL('**view=create-trial');
  await go('/pages/workspace/index');
  await page.getByText('代会员订场', { exact:true }).click();
  await page.waitForURL('**/#/pages/booking/index**');
  await page.locator('.mode-switch .active').filter({ hasText:'代会员订场' }).waitFor();
  await selectRole('教练端');
  assert.deepEqual((await labels()).map(text => text.trim()), ['今日课表','试听跟进','学员档案']);
  await checkLayout('coach');
  await page.getByText('今日课表', { exact:true }).click();
  await page.waitForURL('**view=lessons');
  await page.getByText('今日', { exact:true }).waitFor();
  await selectRole('超级管理端');
  await page.getByText('场地预约率', { exact:true }).waitFor();
  await checkLayout('admin');
  await page.evaluate(async () => {
    const { endpoints } = await import('/src/services/api.ts');
    window.restoreWorkspaceDashboard = endpoints.dashboard;
    window.restoreWorkspaceWork = endpoints.workItems;
    endpoints.dashboard = async period => ({
      collections: { grossPaymentCents: new Date(period.periodEnd) - new Date(period.periodStart) > 2 * 86400000 ? 45600 : 12300 },
      venue: { utilizationRate:25 },
    });
  });
  await page.getByLabel('刷新今日工作').click();
  await page.getByText('¥123.00', { exact:true }).waitFor();
  await page.locator('.summary-link').click();
  await page.getByText('近7天', { exact:true }).click();
  await page.getByText('¥456.00', { exact:true }).waitFor();
  await page.locator('.workspace-nav').getByText('今日', { exact:true }).click();
  await page.getByText('¥123.00', { exact:true }).waitFor();
  await page.evaluate(async () => {
    const { endpoints } = await import('/src/services/api.ts');
    endpoints.dashboard = async () => { throw Error('local failure'); };
    endpoints.workItems = async () => { throw Error('local failure'); };
  });
  await page.getByLabel('刷新今日工作').click();
  await page.getByText('经营数据加载失败，请重试。', { exact:true }).waitFor();
  await page.getByText('待办暂未同步，请重试。', { exact:true }).waitFor();
  assert.equal(await page.locator('.shortcut-tile').count(), 3);
  assert.equal(await page.getByText('¥0.00', { exact:true }).count(), 0);
  await capture('failure-recoverable.png');
  await page.evaluate(async () => {
    const { endpoints } = await import('/src/services/api.ts');
    endpoints.dashboard = window.restoreWorkspaceDashboard;
    endpoints.workItems = window.restoreWorkspaceWork;
  });
  await page.getByLabel('刷新今日工作').click();
  await page.getByText('¥49020.00', { exact:true }).waitFor();
  await page.locator('.workspace-nav').getByText('业务', { exact:true }).click();
  await page.getByText('会员管理', { exact:true }).waitFor();
  await page.locator('.workspace-nav').getByText('管理', { exact:true }).click();
  await page.getByText('球馆信息', { exact:true }).waitFor();
  assert.deepEqual(errors, []);
  await browser.close();
  console.log('PASS role shortcuts and direct routes; 320/375/landscape bounds; today versus week; independent errors and retry; full navigation retained');
})().catch(error => { console.error(error); process.exit(1); });
