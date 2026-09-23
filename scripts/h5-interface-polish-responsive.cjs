// Local mock only; validates narrow and landscape layouts.
const {chromium}=require('playwright'); const fs=require('fs'),assert=require('assert'); const base=process.env.OPS_UI_BASE_URL || 'http://127.0.0.1:5198',out=process.env.OPS_UI_OUTPUT || '/tmp/yanqing-interface-polish';
if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(base)) throw new Error('Local mock app required');
fs.mkdirSync(out,{recursive:true});
(async()=>{ const b=await chromium.launch({channel:'chrome',headless:true}); const p=await b.newPage(); await p.route('**/*',r=>r.request().url().startsWith(base+'/')?r.continue():r.abort()); const go=async r=>{await p.goto(base+'/#'+r);await p.reload();await p.waitForTimeout(2200)};
await go('/packages/admin/pages/switch/index'); assert(await p.evaluate(async()=>(await import('/src/services/http.ts')).isMockMode)); await p.getByText('超级管理端',{exact:true}).click(); await p.waitForTimeout(1000);
const results=[];
for(const [width,height,label] of [[375,812,'375'],[844,390,'landscape']]) { await p.setViewportSize({width,height}); await p.emulateMedia({reducedMotion:'reduce',colorScheme:'dark'});
for(const [name,route]of [['price','venue/index?view=pricing'],['analytics','admin/index?view=analytics'],['purchase','inventory/index?form=purchase'],['class','coach/index?view=create-class']]) {
await go('/packages/ops/pages/'+route); assert(await p.evaluate(w=>document.documentElement.scrollWidth<=w,width));
const footer=p.locator('.task-footer:visible,.save-bar:visible'); if(await footer.count()) {const box=await footer.boundingBox();assert(box.y>=0&&box.y+box.height<=height+1);}
await p.screenshot({path:out+'/'+name+'-'+label+'.png',fullPage:true}); results.push(name+'-'+label);
}}
fs.writeFileSync(out+'/responsive-checks.json',JSON.stringify(results)); console.log('PASS',results.length,'responsive views'); await b.close();})().catch(e=>{console.error(e);process.exit(1)});
