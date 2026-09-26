const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const base = process.env.OPS_UI_BASE_URL;
if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(base || '')) throw new Error('Use the isolated mock UI runner');
const output = path.resolve(process.env.OPS_UI_OUTPUT_DIR, 'training-pagination');
fs.mkdirSync(output, {recursive:true});
(async()=>{
  const browser=await chromium.launch({headless:true});
  const page=await browser.newPage({timezoneId:"Asia/Shanghai",viewport:{width:375,height:812}});
  await page.clock.setFixedTime(new Date("2030-09-26T09:00:00+08:00"));
  const errors=[]; page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',route=>route.request().url().startsWith(base+'/')?route.continue():route.abort());
  const visible=()=>page.locator('uni-page:visible');
  try {
    await page.goto(base+'/#/packages/admin/pages/switch/index');
    await page.getByText('超级管理端',{exact:true}).click();
    await page.getByText('代会员订场',{exact:true}).waitFor();
    await page.evaluate(async()=>{
      const {isMockMode}=await import('/src/services/http.ts'); if(!isMockMode)throw new Error('Mock only');
      const state=await import('/src/services/mock/state.ts');
      const sample=state.getTrainingSessions()[0];
      if(!sample)throw new Error('Missing mock session seed');
      const rows=Array.from({length:102},(_,i)=>{
        const start=new Date(); start.setDate(start.getDate()+(i===101?-30:i)); start.setHours(12,0,0,0);
        const id=i===0?'session-current':i===101?'history-session':`future-${i}`;
        return {...sample,id,startsAt:start.toISOString(),endsAt:new Date(+start+3600000).toISOString(),attendances:[]};
      });
      state.saveTrainingSessions(rows);
    });
    await page.goto(base+'/#/packages/ops/pages/coach/index'); await page.reload();
    await visible().locator('.lesson-row').first().waitFor();
    assert.equal(await visible().locator('.lesson-row').count(),1,'today must survive 100 newer future sessions');
    await visible().getByText('全部',{exact:true}).click();
    await visible().getByText('加载更多课次',{exact:true}).waitFor();
    assert.equal(await visible().locator('.lesson-row').count(),50);
    await visible().getByText('加载更多课次',{exact:true}).click();
    await page.waitForFunction(()=>[...document.querySelectorAll('uni-page')].filter(p=>p.offsetHeight).at(-1)?.querySelectorAll('.lesson-row').length===100);
    await visible().getByText('加载更多课次',{exact:true}).click();
    await page.waitForFunction(()=>[...document.querySelectorAll('uni-page')].filter(p=>p.offsetHeight).at(-1)?.querySelectorAll('.lesson-row').length===102);
    await page.goto(base+'/#/packages/ops/pages/coach/index?lessonId=history-session'); await page.reload();
    await visible().locator('#coach-lesson-history-session').waitFor();
    assert.equal(await visible().getByText('未找到该课次，可能已移除或当前账号无权查看。',{exact:true}).count(),0);
    await page.screenshot({path:path.join(output,'history-session.png')});
    assert.deepEqual(errors,[]);
    console.log('PASS: 102 sessions, today query, three pages and direct historical detail.');
  } catch(error) { await page.screenshot({path:path.join(output,'failure.png')}); throw error; }
  finally { await browser.close(); }
})().catch(error=>{console.error(error);process.exitCode=1});
