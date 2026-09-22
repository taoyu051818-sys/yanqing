// Local mock UI only; all external requests are blocked.
const { chromium } = require('playwright');
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const base = process.env.OPS_UI_BASE_URL || 'http://127.0.0.1:5198';
if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(base)) throw new Error('Use a local mock build');
const out = path.resolve('docs/fixes/2026-09-22-core-task-ux/evidence'); fs.mkdirSync(out,{recursive:true});
(async () => {
  const browser = await chromium.launch({headless:true,channel:'chrome'});
  const context = await browser.newContext({viewport:{width:375,height:812},reducedMotion:'reduce'});
  const errors = [], checks = [];
  await context.route('**/*',r => { const u=new URL(r.request().url()); return /^https?:$/.test(u.protocol)&&u.origin!==base?r.abort():r.continue(); });
  const page = await context.newPage(); page.on('pageerror',e=>errors.push(e.message));
  const go = async route => { await page.goto(base+'/#'+route); await page.reload(); await page.waitForTimeout(900); };
  const shot = async name => {
    await page.waitForTimeout(250);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'page overflow '+name);
    await page.screenshot({path:path.join(out,name+'.png')}); checks.push(name);
  };
  try {
    await go('/packages/admin/pages/switch/index'); await page.getByText('超级管理端',{exact:true}).click(); await page.waitForTimeout(1200);
    assert(await page.evaluate(async()=> (await import('/src/services/http.ts')).isMockMode));
    await go('/packages/ops/pages/venue/index?view=pricing');
    await page.getByText('修改价格',{exact:true}).first().waitFor(); await shot('prices-375');
    await page.getByText('其他操作',{exact:true}).first().click(); await page.getByText('停用此价格',{exact:true}).click(); await page.getByRole('dialog').waitFor(); await page.getByLabel('关闭确认窗口').click();
    await page.getByText('修改价格',{exact:true}).first().click(); await page.locator('#price-amount input').waitFor();
    assert.equal(await page.getByText('规则编码',{exact:true}).count(),0); assert.equal(await page.locator('#price-newcomer').count(),0);
    await page.locator('#price-amount input').fill('79'); await shot('price-editor-375');
    await page.getByText('高级设置',{exact:false}).click(); assert(await page.locator('#price-newcomer input').isVisible()); await page.getByText('收起高级设置',{exact:true}).click();
    await page.getByText('核对并确认',{exact:true}).click(); await page.getByRole('dialog').waitFor(); await shot('price-confirm-375');
    assert((await page.getByRole('dialog').innerText()).includes('¥79.00'));
    await page.setViewportSize({width:320,height:568}); await shot('price-confirm-320');
    const foot=await page.locator('.dialog-footer').boundingBox(); if(foot) assert(foot.y>=0&&foot.y+foot.height<=568);
    await page.getByText('确认修改价格',{exact:true}).click(); await page.getByText('价格已更新',{exact:true}).waitFor();
    await shot('price-result-320');
    assert(await page.evaluate(async()=> (await import('/src/services/mock/state.ts')).getPriceRules().some(p=>p.priceCents===7900&&p.enabled)));
    await page.setViewportSize({width:375,height:812});
    await go('/pages/booking/index'); await page.getByText('代会员订场',{exact:true}).click(); await page.getByRole('dialog').waitFor();
    await page.getByLabel('关闭确认窗口').click(); await page.locator('.checkout-button').filter({hasText:'选择会员'}).click();
    await page.getByRole('dialog').waitFor(); await page.getByText('延庆会员小林',{exact:true}).click(); await page.waitForTimeout(400);
    assert((await page.locator('.dock-member').innerText()).includes('延庆会员小林'));
    const slot=page.locator('.court:not(.disabled)').first(); await slot.click(); await shot('assisted-selection-375');
    await page.locator('.checkout-button').click(); await page.getByRole('dialog').waitFor(); await shot('assisted-review-375');
    if(await page.locator('#booking-override-reason textarea').count()) await page.locator('#booking-override-reason textarea').fill('现场已协调，验收特殊代订');
    await page.getByRole('dialog').getByText('确认代订',{exact:true}).click(); await page.getByText('继续订场',{exact:true}).waitFor(); await shot('assisted-result-375');
    await page.evaluate(async()=>{
      const {saveOrders}=await import('/src/services/mock/venue.ts'); const time=new Date().toISOString();
      saveOrders([{id:'task-ux-refund',orderNo:'TASK-UX-REFUND',memberId:'user-member',member:{id:'user-member',displayName:'退款验收会员'},title:'3号场 · 19:00–20:00',businessType:'VENUE',status:'PAID',paymentChannel:'WECHAT',subjectAccount:'VENUE',sourceChannel:'MINI_PROGRAM',listAmountCents:6000,payableCents:6000,paidCents:6000,refundedCents:0,createdAt:time,parameterSnapshot:{},items:[],bookings:[],refunds:[],payments:[{id:'task-pay',channel:'WECHAT',status:'SUCCEEDED',paidAt:time,amountCents:6000}]}]);
    });
    await go('/pages/order/detail?id=task-ux-refund&management=1'); await page.getByText('直接退款',{exact:true}).click();
    assert((await page.getByRole('dialog').innerText()).includes('微信原路退回')); assert(!(await page.getByRole('dialog').innerText()).includes('退回现金'));
    await page.getByText('行程有变',{exact:true}).click(); await shot('refund-confirm-375');
    await page.setViewportSize({width:320,height:568}); await shot('refund-confirm-320');
    await page.getByText('确认退款 ¥60.00',{exact:true}).click(); await page.waitForTimeout(1300);
    assert.equal(await page.evaluate(async()=> (await import('/src/services/mock/venue.ts')).getOrders().find(o=>o.id==='task-ux-refund').status),'REFUNDED');
    await shot('refund-result-320');
    assert.deepEqual(errors,[]); fs.writeFileSync(path.join(out,'h5-checks.json'),JSON.stringify({checks,errors,payment:'isolated mock only'},null,2)); console.log('PASS',checks);
  } catch(e) { await page.screenshot({path:path.join(out,'failure.png')}); console.error((await page.locator('body').innerText()).slice(-3500)); throw e; }
  finally { await browser.close(); }
})().catch(e=>{console.error(e);process.exitCode=1});
