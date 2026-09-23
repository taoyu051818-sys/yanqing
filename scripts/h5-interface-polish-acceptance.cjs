// Runs exclusively against the local mock app. No production business data is changed.
const { chromium } = require('playwright');
const fs = require('fs');
const assert = require('assert/strict');
const base = process.env.OPS_UI_BASE_URL || 'http://127.0.0.1:5198';
if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(base)) throw new Error('Local mock app required');
const out = process.env.OPS_UI_OUTPUT || '/tmp/yanqing-interface-polish'; fs.mkdirSync(out,{recursive:true});
(async () => {
 const browser = await chromium.launch({channel:'chrome', headless:true});
 const page = await browser.newPage({viewport:{width:390,height:844}});
 const errors = [], checks = [];
 page.on('pageerror', e => errors.push(e.message)); page.on('dialog', d => d.accept());
 await page.route('**/*', r => r.request().url().startsWith(base+'/') ? r.continue() : r.abort());
 const wait = (ms=1000) => page.waitForTimeout(ms);
 const go = async route => { await page.goto(base+'/#'+route); await page.reload(); await wait(2600); };
 const click = async label => { await page.getByText(label,{exact:true}).and(page.locator(':visible')).first().click(); await wait(); };
 const body = () => page.locator('body').innerText();
 const shot = async name => { await page.screenshot({path:out+'/'+name+'.png',fullPage:true}); checks.push({name,url:page.url()}); fs.writeFileSync(out+'/checks.json',JSON.stringify({checks,errors},null,2)); console.log(name); };
 const ops = (name,query='') => '/packages/ops/pages/'+name+'/index'+query;
 try {
  await go('/packages/admin/pages/switch/index');
  assert(await page.evaluate(async()=> (await import('/src/services/http.ts')).isMockMode));
  await click('超级管理端');
  // Inline validation must show once, retain focus while typing, and not open a toast/modal.
  await go(ops('coach','?view=create-product')); await click('创建并上架');
  assert.equal((await body()).split('请填写课程名称，最多 100 字。').length-1,1);
  assert.equal(await page.locator('.error-panel').count(),0);
  await shot('course-name-error');
  await page.locator('#training-productName input').fill('打磨验收课程');
  assert.equal(await page.locator('.field-error:visible').count(),0);
  await page.locator('#training-productPriceYuan input').fill('1.999'); await click('创建并上架');
  assert.equal(await page.locator('.field-error:visible').count(),1); await shot('course-price-error');
  await page.locator('#training-productPriceYuan input').fill('1280');
  await click('创建并上架'); await click('确认创建'); await wait(1600);
  assert((await body()).includes('课程产品已创建')); await shot('course-created');
  await go(ops('coach','?view=create-class'));
  assert(!(await body()).includes('班级编码\n')); assert.equal(await page.locator('input:visible').count(),2);
  await page.locator('#training-className input').fill('打磨验收班级');
  await click('创建培训班级'); await click('确认创建'); await wait(1800);
  const classes = await page.evaluate(async()=> (await import('/src/services/mock/state.ts')).getTrainingProducts().flatMap(product => product.classes || []));
  assert(classes.some(c=>c.name==='打磨验收班级' && c.code.startsWith('CLS-')));
  await go(ops('coach','?view=create-class')); await shot('class-simple');
  await page.setViewportSize({width:320,height:740}); await go(ops('coach','?view=create-session')); await shot('scheduling-320');
  assert(await page.evaluate(()=>document.documentElement.scrollWidth <= 320));
  await page.setViewportSize({width:390,height:844});
  // Each inventory task has a real route, no unrelated metrics/list, fixed footer, inline error.
  await go(ops('inventory','?view=PURCHASE')); await click('新建采购单'); await wait(1500);
  assert(page.url().includes('form=purchase')); assert.equal(await page.locator('.metric-grid:visible').count(),0);
  assert.equal(await page.locator('.document:visible').count(),0); await click('保存');
  assert((await body()).includes('请选择供应商')); assert.equal(await page.locator('.task-error:visible').count(),1);
  assert.equal(await page.locator('.task-footer').evaluate(el=>getComputedStyle(el).position),'fixed');
  await shot('purchase-task');
  await page.locator('input').last().fill('2'); await click('取消'); await click('继续填写');
  assert.equal(await page.locator('input').last().inputValue(),'2');
  await click('取消'); await click('放弃填写'); await wait(); assert(!page.url().includes('form=')); assert((await body()).includes('新建采购单'));
  await go(ops('inventory','?form=master&masterType=LOCATION'));
  await page.locator('input').nth(0).fill('POLISH-TEST'); await page.locator('input').nth(1).fill('打磨验收库位'); await page.locator('textarea').fill('新增库位验收');
  await click('保存'); await click('确定'); await wait(1800);
  assert(!page.url().includes('form='));
  for(const [query,name] of [['?form=master&masterType=ITEM','item-task'],['?form=movement&movementType=LOSS','loss-task'],['?form=stocktake','stocktake-task']]) { await go(ops('inventory',query)); assert.equal(await page.locator('.document:visible').count(),0); await shot(name); }
  await go(ops('inventory','?form=master&source=missing')); assert((await body()).includes('资料已不存在')); assert.equal(await page.locator('.task-footer').count(),0);
  // Membership date picking and automatic codes.
  await go(ops('members','?form=recharge')); assert.equal(await page.locator('.sales-dates uni-picker').count(),1);
  assert(!(await body()).includes('2099')); await shot('recharge-simple');
  await page.locator('input').nth(0).fill('打磨验收充值'); await page.locator('input').nth(1).fill('100'); await click('保存草稿'); await wait(1400);
  assert(!page.url().includes('form='));
  await go(ops('members','?form=product')); await shot('membership-simple');
  // Secondary pages and completed matches are disclosed on demand.
  await go(ops('merchant','?view=redeem')); assert(!(await body()).includes('合作商户档案')); await shot('merchant-redeem');
  await click('商户'); assert((await body()).includes('合作商户档案'));
  await go(ops('admin','?view=analytics')); assert.equal(await page.locator('.metric-grid').first().locator('.metric').count(),4); await shot('analytics-simple');
  await click('查看待办并处理 ›'); assert(!page.url().includes('analytics'));
  await go(ops('venue','?view=pricing')); await shot('price-list');
  await go(ops('event')); await click('延庆金羽积分赛·秋季站'); await wait(1000); await click('轮次比分');
  assert.equal(await page.locator('.pairing-correction:visible').count(),0);
  assert((await page.locator('.match-card').first().innerText()).includes('录入比分')); await shot('event-pending-first');
  const completed = page.locator('uni-button').filter({hasText:/查看已完成对阵/}); if(await completed.count()) { await completed.click(); await wait(); assert(await page.locator('.match-card').count()>1); }
  await go('/pages/workspace/index'); await click('代会员订场'); await wait(1500);
  assert((await body()).includes('查看全天（含已过时）'));
  await page.locator('.inline-member-search').getByText('选择',{exact:true}).first().click(); await wait();
  assert.equal(await page.locator('.inline-member-search').count(),0);
  assert((await page.locator('.dock-member').innerText()).includes('代订会员'));
  const before = await page.locator('.slot-label').count();
  await shot('booking-upcoming'); await click('查看全天（含已过时）');
  assert((await body()).includes('只看接下来时段')); assert(await page.locator('.slot-label').count() >= before); await shot('booking-all-day');
  await go('/packages/admin/pages/switch/index'); await click('前台端'); await go(ops('inventory','?form=purchase'));
  assert((await body()).includes('当前身份只能查看库存预警')); assert.equal(await page.locator('.task-footer').count(),0);
  assert.deepEqual(errors,[]); console.log('PASS',checks.length,'screens');
 } catch(error) { await fs.promises.writeFile(out+'/failure.txt',page.url()+'\n'+await body()); await page.screenshot({path:out+'/failure.png',fullPage:true}); throw error; }
 finally { await browser.close(); }
})().catch(error=>{console.error(error);process.exitCode=1;});
