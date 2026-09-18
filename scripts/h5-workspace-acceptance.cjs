const { chromium } = require('playwright');
// Local mock-only acceptance: blocks all external network requests.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const base=process.env.OPS_UI_BASE_URL || 'http://127.0.0.1:5197';
if(!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(base)) throw new Error('Use a local mock build');
const out=path.resolve(process.env.OPS_UI_OUTPUT || 'artifacts/workspace-ui');fs.mkdirSync(out,{recursive:true});
(async()=>{
const browser=await chromium.launch({headless:true,channel:'chrome'});
const context=await browser.newContext({viewport:{width:375,height:812},reducedMotion:'reduce'});
const errors=[],checks=[];
await context.route('**/*',route=>{const u=new URL(route.request().url()); if(/^https?:$/.test(u.protocol)&&u.origin!==base){errors.push('external request '+u.origin);return route.abort()}return route.continue()});
const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
const go=async route=>{await page.goto(base+'/#'+route);await page.waitForTimeout(450)};
const role=async name=>{await go('/packages/admin/pages/switch/index');await page.getByText(name,{exact:true}).click();await page.waitForTimeout(2300)};
const snap=async name=>page.screenshot({path:path.join(out,name+'.png'),fullPage:true});
await role('超级管理端');
for(const size of [{width:375,height:812},{width:320,height:568},{width:812,height:375}]){
 await page.setViewportSize(size);await page.waitForTimeout(100);
 const tiles=await page.locator('.menu-tile').evaluateAll(es=>es.map(e=>{const r=e.getBoundingClientRect();return {bottom:r.bottom,right:r.right,left:r.left,width:r.width,height:r.height}}));
 assert.equal(tiles.length,15);assert(tiles.every(r=>r.left>=0&&r.right<=size.width&&r.width>=44&&r.height>=44));
 if(size.width<400)assert(tiles.every(r=>r.bottom<=size.height),'menu below fold');
 await snap('workspace-'+size.width);checks.push('menu layout '+size.width+'x'+size.height);
}
await page.setViewportSize({width:375,height:812});
await page.getByText('组织权限',{exact:true}).click();await page.waitForTimeout(450);
const first=await page.locator('.row-card .strong').first().innerText();
await page.locator('.row-card').first().click();await page.waitForTimeout(450);
assert.equal(await page.locator('.row-card').count(),0);assert((await page.locator('.editor').innerText()).includes(first));
const save=page.getByText('保存角色',{exact:true});let box=await save.boundingBox();assert(box.y+box.height<=812&&box.y>=0);
await page.getByText('教练',{exact:true}).click();await page.locator('textarea').fill('本地界面验收');await save.click();await page.getByText('确定',{exact:true}).last().click();await page.waitForTimeout(800);
assert((await page.locator('.chip.on').allTextContents()).includes('教练'));
await page.waitForTimeout(1800);await snap('permissions');checks.push('permission detail and save in isolated mock');
await page.goBack();await page.waitForTimeout(500);assert(await page.locator('.row-card').count()>0);
await go('/packages/ops/pages/members/index');
assert.equal(await page.locator('.host-row').count(),0);
await page.locator('.search-card input').fill('小林');await page.getByText('查询',{exact:true}).click();await page.waitForTimeout(400);
await page.locator('.member-row').first().click();await page.waitForTimeout(400);
assert.equal(await page.locator('.member-row').count(),0);assert(await page.locator('.customer-detail').count());
await page.getByText('账户',{exact:true}).click();box=await page.getByText('申请账户调整',{exact:true}).boundingBox();assert(box.y+box.height<=812);
await snap('accounts');await page.getByText('订单',{exact:true}).click();assert(await page.locator('.customer-detail .record').count()>0);
await page.goBack();await page.waitForTimeout(400);assert.equal(await page.locator('.search-card input').inputValue(),'小林');checks.push('member detail tabs, fixed action and return search preservation');
await role('前台端');assert.equal(await page.getByText('组织权限',{exact:true}).count(),0);
await page.getByText('客户会员',{exact:true}).click();await page.waitForTimeout(400);await page.locator('.member-row').first().click();await page.waitForTimeout(400);await page.getByText('账户',{exact:true}).click();assert.equal(await page.getByText('申请账户调整',{exact:true}).count(),0);checks.push('front desk permissions');
await role('教练端');await page.getByText('客户会员',{exact:true}).click();await page.waitForTimeout(400);await page.locator('.member-row').first().click();await page.waitForTimeout(400);assert.equal(await page.getByText('账户',{exact:true}).count(),0);assert.equal(await page.getByText('订单',{exact:true}).count(),0);checks.push('coach privacy');
assert.deepEqual(errors,[]);console.log(JSON.stringify({checks,errors},null,2));await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
