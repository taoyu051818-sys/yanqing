import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
const root=fileURLToPath(new URL('..',import.meta.url)).replace(/\/$/,'')
const require=createRequire(root+'/package.json')
const {ConfigService}=require('@nestjs/config')
const {PrismaService}=await import(root+'/dist/database/prisma.service.js')
const {BossService}=await import(root+'/dist/boss/boss.service.js')
const {BossBriefingService}=await import(root+'/dist/boss/briefing.service.js')
const database=new URL(process.env.DATABASE_URL || 'http://invalid'); assert(['localhost','127.0.0.1'].includes(database.hostname) && database.pathname==='/boss_acceptance','Use only a disposable local boss_acceptance database')
const config=new ConfigService({...process.env,NODE_ENV:'test',BOSS_MONITOR_ENABLED:'false'})
const db=new PrismaService(config);await db.$connect();
try {
 const boss=new BossService(db,config), user=await db.user.findFirstOrThrow({where:{primaryRole:'SUPER_ADMIN'}})
 const before=await boss.summary(), now=new Date(), key='boss-acceptance-'+Date.now()
 const base={memberId:user.id,createdById:user.id,businessType:'VENUE',subjectAccount:'VENUE',sourceChannel:'MINI_PROGRAM',title:'隔离数据库验收',listAmountCents:3000,payableCents:3000,parameterSnapshot:{operatorAssisted:true},createdAt:now}
 const paid=await db.order.create({data:{...base,orderNo:key+'-paid',status:'COMPLETED',paidCents:3000,paidAt:now,completedAt:now}})
 await db.payment.create({data:{paymentNo:key+'-pay',orderId:paid.id,userId:user.id,operatorId:user.id,channel:'WECHAT',amountCents:3000,status:'SUCCEEDED',idempotencyKey:key,paidAt:now}})
 const pending=await db.order.create({data:{...base,orderNo:key+'-pending',status:'PENDING',createdAt:new Date(+now-31*60000)}})
 const after=await boss.summary()
 assert.equal(after.daily.venueOrderCount,before.daily.venueOrderCount+2)
 assert.equal(after.daily.assistedVenueOrderCount,before.daily.assistedVenueOrderCount+2)
 assert.equal(after.daily.paidCents,before.daily.paidCents+3000)
 assert.equal(after.daily.wechatPaidCents,before.daily.wechatPaidCents+3000)
 assert.equal(after.daily.venueRevenueCents,before.daily.venueRevenueCents+3000)
 await boss.scan();const first=await db.riskEvent.findFirstOrThrow({where:{orderId:pending.id,ruleCode:'BOSS_OVERDUE_PENDING'}})
 await db.riskEvent.update({where:{id:first.id},data:{status:'RESOLVED',resolvedAt:new Date()}})
 await boss.scan();assert.equal(await db.riskEvent.count({where:{dedupKey:first.dedupKey}}),1)
 assert.equal((await db.riskEvent.findUniqueOrThrow({where:{id:first.id}})).status,'RESOLVED')
 const refundBase={orderId:paid.id,requestedById:user.id,amountCents:500,reason:'隔离库退款口径验收',originalOrderStatus:'COMPLETED',status:'SUCCEEDED'}
 await db.refund.create({data:{...refundBase,refundNo:key+'-refund-before',requestedAt:now,completedAt:new Date(+now-1000)}})
 await db.refund.create({data:{...refundBase,refundNo:key+'-refund-after',requestedAt:now,completedAt:new Date(+now+1000)}})
 const net=await boss.summary()
 assert.equal(net.daily.venueRevenueCents,after.daily.venueRevenueCents-1000,'refund before and after fulfillment deducted exactly once')
 assert.equal(net.daily.refundedCents,after.daily.refundedCents+1000)
 assert.equal(net.daily.refundedOrderCount,after.daily.refundedOrderCount+1,'two partial refunds count as one order')
 assert.equal(net.daily.refundRequestedOrderCount,after.daily.refundRequestedOrderCount+1)
 const latest=await boss.summary();assert(latest.monitor.lastSucceededAt)
 const briefing=new BossBriefingService(db,boss,new ConfigService({}));const report=await briefing.generate();assert.equal(report.source,'FACTS');assert(report.text.includes('经营摘要'))
 console.log(JSON.stringify({result:'PASS',checks:['daily counts','assisted counts','actual payments','recognized venue revenue','persistent events','repeat scan deduplication','resolved status preserved','factual briefing cache','refund timing and distinct order count'],metrics:after.daily}))
}finally{await db.$disconnect()}
