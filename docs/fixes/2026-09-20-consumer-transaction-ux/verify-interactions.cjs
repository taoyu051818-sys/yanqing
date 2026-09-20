const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs=require('fs'),assert=require('assert');
const base='http://127.0.0.1:5198',out=process.cwd()+'/docs/fixes/2026-09-20-consumer-transaction-ux/evidence';
(async()=>{
 const browser=await chromium.launch({headless:true,channel:'chrome'});
 const context=await browser.newContext({viewport:{width:375,height:812},reducedMotion:'reduce'});
 await context.route('**/*',r=>/^https?:/.test(r.request().url())&&!r.request().url().startsWith(base+'/')?r.abort():r.continue());
 const page=await context.newPage(),errors=[],checks=[];page.on('pageerror',e=>errors.push(e.message));
 const go=async path=>{await page.goto(base+'/#'+path);await page.reload();await page.waitForTimeout(1000)};
 const shot=async name=>{await page.screenshot({path:out+'/'+name+'.png'});checks.push({name,overflow:await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)})};
 await go('/packages/admin/pages/switch/index');await page.getByText('超级管理端',{exact:true}).click();await page.waitForTimeout(900);
 assert(await page.evaluate(async()=> (await import('/src/services/http.ts')).isMockMode));
 await page.evaluate(async()=>{
   const {saveOrders}=await import('/src/services/mock/venue.ts');
   const time=new Date().toISOString();
   saveOrders(Array.from({length:26},(_,i)=>({
    id:'ux-order-'+String(i).padStart(2,'0'),orderNo:'UX-20260920-'+i,memberId:'user-member',member:{id:'user-member',displayName:i===25?'退款验收会员':'会员'+i},
    title:i===25?'退款验收场次':'3号场 · 19:00–20:00',businessType:'VENUE',status:'PAID',paymentChannel:'WECHAT',subjectAccount:'VENUE',sourceChannel:'MINI_PROGRAM',listAmountCents:6000,payableCents:6000,paidCents:6000,refundedCents:0,createdAt:time,parameterSnapshot:{},items:[],bookings:[],refunds:[],
    payments:[{id:'ux-payment-'+i,channel:'WECHAT',status:'SUCCEEDED',paidAt:time,amountCents:6000}]
   })));
 });
 await go('/packages/ops/pages/transactions/index');await page.getByText('退款验收场次',{exact:true}).waitFor();
 assert.equal(await page.locator('.record').count(),20);
 const before=await page.locator('.record').first().boundingBox();assert(before.height>100,'record should have clear vertical hierarchy');
 await shot('transactions-dense-375');
 await page.getByText('筛选',{exact:true}).click();await page.getByText('筛选记录',{exact:true}).waitFor();await shot('transaction-filters-375');await page.getByLabel('关闭确认窗口').click();assert.equal(await page.locator('.record').count(),20);
 await page.getByText('加载更多',{exact:true}).click();await page.waitForTimeout(600);assert.equal(await page.locator('.record').count(),26);
 await page.getByText('退款验收场次',{exact:true}).click();await page.getByText('直接退款',{exact:true}).waitFor();await shot('admin-order-detail-375');
 assert.equal(await page.locator('.order-filters').count(),0);
 await page.getByText('直接退款',{exact:true}).click();await page.getByText('行程有变',{exact:true}).click();await shot('admin-refund-confirm-375');await page.getByText('确认退款',{exact:true}).click();await page.waitForTimeout(1100);
 assert.equal(await page.evaluate(async()=> (await import('/src/services/mock/venue.ts')).getOrders().find(x=>x.id==='ux-order-25').status),'REFUNDED');
 await page.evaluate(()=>uni.navigateBack());await page.waitForTimeout(800);assert.equal(await page.locator('.record').count(),26);assert(await page.locator('.record').first().innerText().then(x=>x.includes('已退款')));
 await page.getByText('收支流水',{exact:true}).click();await page.waitForTimeout(600);await shot('ledger-receipts-375');assert(await page.locator('body').innerText().then(x=>x.includes('¥1560.00')));
 await page.getByText('退款',{exact:true}).first().click();await page.waitForTimeout(400);await shot('refund-active-empty-375');
 await go('/packages/admin/pages/switch/index');await page.getByText('会员端',{exact:true}).click();await page.waitForTimeout(700);
 await go('/pages/order/index');await page.locator('.order-list-row').first().waitFor();await shot('member-orders-dense-375');
 await go('/pages/membership/index');await page.getByText('选择',{exact:true}).first().click();await shot('recharge-selected-375');assert(await page.getByText('下一步付款',{exact:true}).isVisible());
 await page.getByText('下一步付款',{exact:true}).click();await page.getByText('立即支付',{exact:true}).waitFor();await page.getByText('立即支付',{exact:true}).click();await page.getByRole('dialog').waitFor();await page.locator('.payment-choice').first().waitFor();await shot('payment-dialog-375');await page.getByLabel('关闭确认窗口').click();assert.equal(await page.getByRole('dialog').count(),0);
 await go('/pages/training/index');await page.getByText('查看课程',{exact:true}).first().click();await page.waitForTimeout(700);await shot('course-detail-375');assert.equal(await page.locator('.product').count()<=1,true);
 await go('/pages/booking/index');await shot('booking-night-375');

 await page.setViewportSize({width:320,height:568});await go('/pages/order/index');await shot('member-orders-320');
 await page.setViewportSize({width:812,height:375});await go('/pages/membership/index');await shot('membership-landscape');
 await page.setViewportSize({width:375,height:812});await go('/pages/order/index');await page.addStyleTag({content:'.order-list-row {font-size:20px!important}.order-list-row text,.order-list-row uni-text{font-size:20px!important}'});await shot('orders-large-text');
 assert.equal(errors.length,0,errors.join('\n'));assert(checks.every(x=>!x.overflow),'horizontal document overflow');
 fs.writeFileSync(out+'/interactions.json',JSON.stringify({checks,errors,directRefund:'verified in isolated mock',realWechatPayment:'not exercised'},null,2));
 console.log(JSON.stringify({passed:true,screens:checks.length,errors},null,2));await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
