// Run only against a local mock H5 server. All external requests are blocked.
const { chromium }=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const base=process.env.OPS_UI_BASE_URL || 'http://127.0.0.1:5197';
if(!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(base)) throw new Error('Use a local mock build');
const out=path.resolve(process.env.OPS_UI_OUTPUT || 'artifacts/workspace-ui');fs.mkdirSync(out,{recursive:true});
(async()=>{
const browser=await chromium.launch({headless:true,channel:'chrome'}),context=await browser.newContext({viewport:{width:375,height:812},reducedMotion:'reduce'}),errors=[];
await context.route('**/*',r=>{let u=new URL(r.request().url());if(/^https?:$/.test(u.protocol)&&u.origin!==base){errors.push(u.origin);return r.abort()}return r.continue()});
const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
const wait=()=>page.waitForTimeout(650),go=async route=>{await page.goto(base+'/#'+route);await wait()};
const snap=async name=>page.screenshot({path:path.join(out,name+'.png'),fullPage:true});
await go('/packages/admin/pages/switch/index');await page.getByText('超级管理端',{exact:true}).click();await page.waitForTimeout(2200);
assert.equal(await page.locator('.menu-group').count(),4);assert.equal(await page.locator('.menu-tile').count(),17);await snap('workspace');
for (const size of [{width:320,height:568},{width:812,height:375}]) {
 await page.setViewportSize(size);await wait();
 const bounds = await page.locator('.menu-group,.menu-tile').evaluateAll(nodes => nodes.map(n => {const r=n.getBoundingClientRect();return {left:r.left,right:r.right}}));
 assert(bounds.every(r => r.left >= 0 && r.right <= size.width));await snap('workspace-'+size.width);
}
await page.setViewportSize({width:375,height:812});
await page.locator('.search-box input').fill('门店管理');assert.equal(await page.locator('.menu-group').count(),1);await page.locator('.search-box input').fill('');
await page.getByText('球馆信息',{exact:true}).click();await wait();assert.equal(await page.locator('input').count(),0);await snap('venue');
await page.getByText('修改联系方式',{exact:true}).click();await wait();await page.locator('input').fill('01012345678');await page.locator('uni-button').filter({hasText:/^取消$/}).click();await wait();assert(!((await page.locator('body').innerText()).includes('01012345678')));
await page.getByText('修改联系方式',{exact:true}).click();await wait();await page.locator('input').fill('01012345678');await page.getByText('保存修改',{exact:true}).click();await wait();await page.getByText('确认保存',{exact:true}).click();await wait();assert.equal(await page.locator('input').count(),0);assert((await page.locator('body').innerText()).includes('01012345678'));await page.waitForTimeout(1800);await snap('venue-saved');
await page.getByText('场地管理',{exact:true}).click();await wait();await snap('courts');assert.equal(await page.locator('.court-row').count(),20);let b=await page.getByText('新增场地',{exact:true}).boundingBox();assert(b.y+b.height<=812);
await page.getByText('新增场地',{exact:true}).click();await wait();
await page.locator('#court-name input').fill('验收新场');await page.locator('#court-code input').fill('TEST21');await page.getByText('确认保存',{exact:true}).click();await wait();
assert.equal(await page.locator('.court-row').count(),21);await page.locator('.court-search input').fill('TEST21');assert.equal(await page.locator('.court-row').count(),1);await page.locator('.court-row').click();await wait();assert.equal(await page.locator('input').count(),0);await page.waitForTimeout(1600);await snap('court-detail');
await page.getByText('编辑场地',{exact:true}).click();await wait();await page.locator('#court-name input').fill('不应保存');await page.locator('uni-button').filter({hasText:/^取消$/}).click();await wait();assert(!(await page.locator('body').innerText()).includes('不应保存'));
await page.getByText('编辑场地',{exact:true}).click();await wait();await page.locator('#court-name input').fill('比赛新场');await page.locator('#court-code input').fill('MATCH21');await snap('court-edit');await page.setViewportSize({width:320,height:568});await wait();await snap('court-edit-320');const footer=await page.locator('.dialog-footer').boundingBox();assert(footer && footer.y>=0 && footer.y+footer.height<=568);await page.setViewportSize({width:375,height:812});await wait();await page.getByText('确认保存',{exact:true}).click();await wait();assert((await page.locator('body').innerText()).includes('MATCH21'));
// A second editor changes the court while this page holds an older draft.
await page.getByText('编辑场地',{exact:true}).click();await wait();await page.locator('#court-name input').fill('旧表单不应覆盖');
await page.evaluate(async()=>{const {endpoints}=await import('/src/services/api.ts');const c=(await endpoints.venueSettings()).courts.find(c=>c.code==='MATCH21');await endpoints.updateVenueCourt(c.id,{...c,revision:c.updatedAt,enabled:false,usage:'MAINTENANCE'})});
await page.getByText('确认保存',{exact:true}).click();await wait();assert((await page.locator('.dialog-window').innerText()).includes('已被修改'));await snap('court-stale-conflict');
await page.getByText('重新加载场地',{exact:true}).click();await wait();assert.equal(await page.locator('#court-name input').inputValue(),'比赛新场');assert((await page.locator('.dialog-window').innerText()).includes('维护中'));
await page.getByText('确认保存',{exact:true}).click();await wait();
const latest=await page.evaluate(async()=>{const {endpoints}=await import('/src/services/api.ts');return (await endpoints.venueSettings()).courts.find(c=>c.code==='MATCH21')});assert.equal(latest.enabled,false);assert.equal(latest.usage,'MAINTENANCE');assert.equal(latest.name,'比赛新场');
// Persistence succeeds but the following GET fails: keep the page recoverable,
// make the committed outcome explicit, and never offer a duplicate submission.
await page.getByText('编辑场地',{exact:true}).click();await wait();
await page.evaluate(async()=>{const {endpoints}=await import('/src/services/api.ts');window.__restoreVenueRead=endpoints.venueSettings;endpoints.venueSettings=async()=>{throw new Error('本地模拟刷新失败')}});
await page.getByText('确认保存',{exact:true}).click();await wait();assert((await page.locator('body').innerText()).includes('操作已保存，但页面刷新失败'));assert.equal(await page.getByText('确认保存',{exact:true}).count(),0);await snap('court-saved-refresh-failed');
await page.evaluate(async()=>{const {endpoints}=await import('/src/services/api.ts');endpoints.venueSettings=window.__restoreVenueRead;delete window.__restoreVenueRead});
await page.getByText('重新加载',{exact:true}).click();await wait();assert((await page.locator('body').innerText()).includes('比赛新场'));
await page.getByText('删除场地',{exact:true}).click();await wait();await snap('court-delete');await page.locator('uni-button').filter({hasText:/^取消$/}).click();await wait();assert((await page.locator('body').innerText()).includes('比赛新场'));
await page.getByText('删除场地',{exact:true}).click();await wait();await page.getByText('确认删除',{exact:true}).click();await wait();await page.locator('.court-search input').fill('');assert.equal(await page.locator('.court-row').count(),20);assert(!(await page.locator('body').innerText()).includes('比赛新场'));
await go('/packages/ops/pages/governance/index');await snap('staff-list');await page.locator('.row-card').first().click();await wait();assert.equal(await page.locator('textarea').count(),0);await snap('staff');
await page.getByText('修改岗位',{exact:true}).click();await wait();await page.getByText('教练',{exact:true}).click();await page.locator('uni-button').filter({hasText:/^取消$/}).click();await wait();assert.equal(await page.locator('textarea').count(),0);
await page.getByText('修改岗位',{exact:true}).click();await wait();await page.getByText('教练',{exact:true}).click();await page.locator('textarea').fill('本地分组界面验收');await page.getByText('保存角色',{exact:true}).click();await page.getByText('确定',{exact:true}).last().click();await wait();assert.equal(await page.locator('textarea').count(),0);assert((await page.locator('body').innerText()).includes('教练'));
await go('/packages/ops/pages/members/index');await snap('members');await page.locator('.member-row').first().click();await wait();await snap('member-detail');await page.getByText('账户',{exact:true}).click();await snap('accounts');
await go('/packages/admin/pages/switch/index');await page.getByText('前台端',{exact:true}).click();await page.waitForTimeout(2200);
assert.equal(await page.getByText('员工权限',{exact:true}).count(),0);assert.equal(await page.getByText('球馆信息',{exact:true}).count(),0);
await page.getByText('会员管理',{exact:true}).click();await wait();await page.locator('.member-row').first().click();await wait();await page.getByText('账户',{exact:true}).click();assert.equal(await page.getByText('申请账户调整',{exact:true}).count(),0);
await go('/packages/admin/pages/switch/index');await page.getByText('教练端',{exact:true}).click();await page.waitForTimeout(2200);await page.getByText('会员管理',{exact:true}).click();await wait();await page.locator('.member-row').first().click();await wait();assert.equal(await page.getByText('账户',{exact:true}).count(),0);
assert.deepEqual(errors,[]);console.log('PASS grouped navigation, venue cancel/save, court CRUD/cancel/delete/stale-conflict-reload/refresh-failure-recovery, staff cancel/save, member details; no browser errors');await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
