import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { JwtService } from '@nestjs/jwt'
const url=process.env.AUTH_CHECK_DATABASE_URL
if(!url)throw new Error('AUTH_CHECK_DATABASE_URL required')
const client=new pg.Client({connectionString:url});await client.connect()
assert.equal((await client.query('SELECT current_database() AS name')).rows[0].name,'auth_check')
const jwt=new JwtService({secret:'isolated-auth-check-not-a-production-secret'})
const base='http://127.0.0.1:56392/api/v1',origin='http://127.0.0.1:5190'
let assertions=0
async function call(path,method='GET',body,headers={}){const options={method,headers:{...(body?{'Content-Type':'application/json'}:{}),...headers}};if(body&&!['GET','HEAD'].includes(method))options.body=JSON.stringify(body);const r=await fetch(base+path,options);const json=await r.json();return{status:r.status,data:json.data??json,headers:r.headers}}
function expectStatus(r,status){assert.equal(r.status,status,JSON.stringify(r.data));assertions++}
const cookieOf=(r)=>r.headers.getSetCookie().map(s=>s.split(';')[0]).filter(s=>!s.endsWith('=')).join('; ')
const claims=(sub,loginMethod='wechat')=>jwt.signAsync({sub,roles:[],loginMethod},{expiresIn:'10m'})
async function challenge(){const r=await call('/admin-auth/challenges','POST',{}, {Origin:origin});expectStatus(r,201);assert.match(r.headers.get('set-cookie'),/HttpOnly/);assert.match(r.headers.get('set-cookie'),/SameSite=Strict/);assert.match(r.data.qrImage,/^data:image\/png;base64,/);const [_,id,scanSecret]=r.data.qrPayload.split(':');assert.equal(id,r.data.id);return{...r.data,scanSecret,cookie:cookieOf(r)}}
async function approve(c,token){const r=await call(`/admin-auth/requests/${c.id}/approve`,'POST',{scanSecret:c.scanSecret},{Authorization:'Bearer '+token});expectStatus(r,201)}
async function exchange(c){return call(`/admin-auth/challenges/${c.id}/exchange`,'POST',{}, {Origin:origin,Cookie:c.cookie})}
try{
 await client.query(`UPDATE "PriceRule" SET enabled=false WHERE code LIKE 'PC-P-%'`)
 await client.query(`DELETE FROM "UserRole" WHERE "userId" IN ('pc-test-admin','pc-test-member')`)
 await client.query(`INSERT INTO "User" (id,"displayName","openId","primaryRole","updatedAt") VALUES ('pc-test-admin','本地管理员','pc-test-admin-openid','SUPER_ADMIN',now()),('pc-test-member','本地会员','pc-test-member-openid','MEMBER',now()) ON CONFLICT (id) DO UPDATE SET status='ACTIVE', "deletedAt"=NULL, "primaryRole"=EXCLUDED."primaryRole"`)
 const admin=await claims('pc-test-admin'),member=await claims('pc-test-member'),dev=await claims('pc-test-admin','development')
 expectStatus(await call('/admin-auth/challenges','POST',{}),403)
 expectStatus(await call('/admin-auth/challenges','POST',{}, {Origin:'http://wrong.test'}),403)
 const c=await challenge()
 const stored=(await client.query('SELECT * FROM "AdminLoginChallenge" WHERE id=$1',[c.id])).rows[0]
 assert(!JSON.stringify(stored).includes(c.scanSecret));assert(!JSON.stringify(stored).includes(c.cookie.split('=')[1]));assertions+=2
 expectStatus(await call(`/admin-auth/challenges/${c.id}`),401)
 expectStatus(await exchange(c),409)
 expectStatus(await call(`/admin-auth/requests/${c.id}/inspect`,'POST',{scanSecret:c.scanSecret},{Authorization:'Bearer '+member}),403)
 expectStatus(await call(`/admin-auth/requests/${c.id}/approve`,'POST',{scanSecret:c.scanSecret},{Authorization:'Bearer '+dev}),401)
 expectStatus(await call(`/admin-auth/requests/${c.id}/approve`,'POST',{scanSecret:'z'.repeat(43)},{Authorization:'Bearer '+admin}),400)
 const inspect=await call(`/admin-auth/requests/${c.id}/inspect`,'POST',{scanSecret:c.scanSecret},{Authorization:'Bearer '+admin});expectStatus(inspect,201);assert.equal(inspect.data.confirmationCode,c.confirmationCode)
 await approve(c,admin)
 expectStatus(await call(`/admin-auth/challenges/${c.id}/exchange`,'POST',{}, {Origin:origin,Cookie:'yanqing-admin-login='+'z'.repeat(43)}),401)
 const results=await Promise.all([exchange(c),exchange(c)])
 assert.deepEqual(results.map(r=>r.status).sort(),[201,409]);assertions++
 const login=results.find(r=>r.status===201),cookie=cookieOf(login),csrf=login.data.csrfToken
 assert(!JSON.stringify(login.data).includes(cookie.split('=')[1]));assertions++
 const authHeaders={Cookie:cookie,Origin:origin,'X-CSRF-Token':csrf}
 expectStatus(await call('/admin-auth/me','GET',undefined,{Cookie:cookie}),200)
 expectStatus(await call('/governance/users','GET',undefined,{Cookie:cookie}),200)
 expectStatus(await call('/work-items','GET',undefined,{Cookie:cookie}),200)
 expectStatus(await call('/audit-logs','GET',undefined,{Cookie:cookie}),200)
 for(const path of ['/memberships/products/manage','/memberships/recharge-plans/manage','/venues/price-rules/manage','/training/products','/alliance/coupon-templates','/orders'])expectStatus(await call(path,'GET',undefined,{Cookie:cookie}),200)
 const roles={roles:['MEMBER','FINANCE'],primaryRole:'FINANCE',reason:'隔离数据库跨端回归',idempotencyKey:randomUUID()}
 expectStatus(await call('/governance/users/pc-test-member/roles','POST',roles,{Cookie:cookie,Origin:origin}),403)
 expectStatus(await call('/governance/users/pc-test-member/roles','POST',roles,{...authHeaders,Origin:'http://evil.test'}),403)
 expectStatus(await call('/governance/users/pc-test-member/roles','POST',roles,authHeaders),201)
 const updated=await call('/auth/me','GET',undefined,{Authorization:'Bearer '+member});expectStatus(updated,200);assert(updated.data.roles.some(r=>r.role==='FINANCE'));assertions++
 const create=await call('/memberships/products','POST',{code:'PC-'+randomUUID().slice(0,8).toUpperCase(),name:'隔离验收会员卡',level:'REGULAR',priceCents:9900,durationDays:30,benefits:{description:'测试权益'},effectiveFrom:new Date().toISOString(),reason:'跨端配置验证',idempotencyKey:randomUUID()},authHeaders);expectStatus(create,201)
 // Authoritative product is visible through the same API used by the miniapp.
 const productRows=(await call('/memberships/products/manage','GET',undefined,{Authorization:'Bearer '+admin})).data
 assert(productRows.some(r=>r.name==='隔离验收会员卡'));assertions++
 const auditFields={reason:'隔离跨端配置回归',idempotencyKey:randomUUID()};
 const recharge=await call('/memberships/recharge-plans','POST',{code:'PC-R-'+randomUUID().slice(0,8).toUpperCase(),name:'隔离充值方案',principalCents:10000,giftCents:1000,effectiveFrom:new Date().toISOString(),...auditFields},authHeaders);expectStatus(recharge,201)
 expectStatus(await call(`/memberships/recharge-plans/${recharge.data.id}/status`,'POST',{enabled:!recharge.data.enabled,reason:'隔离启停回归',idempotencyKey:randomUUID()},authHeaders),201)
 const price=await call('/venues/price-rules','POST',{code:'PC-P-'+randomUUID().slice(0,8).toUpperCase(),name:'隔离小时价格',priceCents:8800,weekdayMask:127,effectiveFrom:new Date(Date.now()+3600000).toISOString(),reason:'隔离价格回归',idempotencyKey:randomUUID()},authHeaders);expectStatus(price,201)
 expectStatus(await call(`/venues/price-rules/${price.data.id}/status`,'POST',{enabled:!price.data.enabled,reason:'隔离价格启停',idempotencyKey:randomUUID()},authHeaders),201)
 const training=await call('/training/products','POST',{code:'PC-T-'+randomUUID().slice(0,8).toUpperCase(),name:'隔离成人课程',audience:'ADULT',totalSessions:10,validityDays:90,priceCents:120000,refundRule:{mode:'UNCONSUMED_PRO_RATA'},reason:'隔离课程回归',creationIdempotencyKey:randomUUID()},authHeaders);expectStatus(training,201)
 expectStatus(await call(`/training/products/${training.data.id}`,'PATCH',{name:'隔离成人课程已更新',reason:'隔离编辑回归',idempotencyKey:randomUUID()},authHeaders),200)
 const merchant=await call('/alliance/merchants','POST',{code:'PC-M-'+randomUUID().slice(0,8).toUpperCase(),name:'隔离测试商户',category:'测试类目',level:'MEMBER_BENEFIT',settlementRule:{}},authHeaders);expectStatus(merchant,201)
 const coupon=await call('/alliance/coupon-templates','POST',{code:'PC-C-'+randomUUID().slice(0,8).toUpperCase(),merchantId:merchant.data.id,name:'隔离优惠券',activityName:'隔离活动',benefitDescription:'仅供隔离测试',faceValueCents:1000,validFrom:new Date().toISOString(),validTo:new Date(Date.now()+86400000).toISOString(),claimLimitPerUser:1,issueLimit:10,allowVenueBooking:false},authHeaders);expectStatus(coupon,201)
 expectStatus(await call(`/alliance/coupon-templates/${coupon.data.id}/status`,'POST',{enabled:!coupon.data.enabled,allowVenueBooking:false,reason:'隔离券启停回归',idempotencyKey:randomUUID()},authHeaders),201)
 for(const [path,id] of [['/memberships/recharge-plans/manage',recharge.data.id],['/venues/price-rules/manage',price.data.id],['/training/products',training.data.id],['/alliance/coupon-templates',coupon.data.id]]){const result=await call(path,'GET',undefined,{Authorization:'Bearer '+admin});expectStatus(result,200);assert(result.data.some(r=>r.id===id));assertions++}
 const c2=await challenge();await approve(c2,admin);const l2=await exchange(c2);expectStatus(l2,201)
 expectStatus(await call(`/admin-auth/sessions/${l2.data.sessionId}/revoke`,'POST',{},authHeaders),201)
 expectStatus(await call('/admin-auth/me','GET',undefined,{Cookie:cookieOf(l2)}),401)
 const cancelled=await challenge();expectStatus(await call(`/admin-auth/requests/${cancelled.id}/reject`,'POST',{scanSecret:cancelled.scanSecret},{Authorization:'Bearer '+admin}),201);expectStatus(await exchange(cancelled),409)
 const expired=await challenge();await client.query('UPDATE "AdminLoginChallenge" SET "expiresAt"=(now() AT TIME ZONE \'UTC\')-interval \'1 minute\' WHERE id=$1',[expired.id]);expectStatus(await call(`/admin-auth/requests/${expired.id}/inspect`,'POST',{scanSecret:expired.scanSecret},{Authorization:'Bearer '+admin}),400)
 await client.query(`UPDATE "User" SET "primaryRole"='MEMBER' WHERE id='pc-test-admin'`)
 expectStatus(await call('/governance/users','GET',undefined,{Cookie:cookie}),403)
 await client.query(`UPDATE "User" SET "primaryRole"='SUPER_ADMIN',status='DISABLED' WHERE id='pc-test-admin'`)
 expectStatus(await call('/admin-auth/me','GET',undefined,{Cookie:cookie}),401)
 await client.query(`UPDATE "User" SET status='ACTIVE' WHERE id='pc-test-admin'`)
 expectStatus(await call('/admin-auth/logout','POST',{},authHeaders),201)
 expectStatus(await call('/admin-auth/me','GET',undefined,{Cookie:cookie}),401)
 console.log(JSON.stringify({passed:assertions,scope:'isolated real HTTP/PostgreSQL, synthetic WeChat JWT; no real WeChat or production mutations'},null,2))
}finally{await client.end()}
