import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { PrismaService } from '../database/prisma.service.js'
import { Prisma } from '../generated/prisma/client.js'
import { DAY, activitySummary, dayRange, defaultThresholds, detectEvents, utilization, venueDay } from './boss.logic.js'

const paidStates = ['SUCCEEDED','REFUNDED'] as const
const inside = (value: any, start: Date, end: Date) => value && +new Date(value)>=+start && +new Date(value)<+end
@Injectable()
export class BossService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(BossService.name)
  private timer?: ReturnType<typeof setInterval>
  private pending?: Promise<void>
  private scanState: { lastSucceededAt: string | null; error: string | null } = { lastSucceededAt:null,error:null }
  constructor(private readonly prisma: PrismaService, private readonly config: ConfigService) {}
  thresholds() {
    const result = {...defaultThresholds}
    for (const key of Object.keys(result) as Array<keyof typeof result>) {
      const env = 'BOSS_' + key.replace(/[A-Z]/g, c=>'_'+c).toUpperCase(), value=Number(this.config.get(env))
      if (Number.isFinite(value) && value>0) result[key]=value
    }
    return result
  }
  onApplicationBootstrap() {
    if(this.config.get('BOSS_MONITOR_ENABLED','true') === 'false' || this.config.get('NODE_ENV') === 'test') return
    void this.scan()
    this.timer=setInterval(()=>void this.scan(),5*60000); this.timer.unref()
  }
  onModuleDestroy() { if(this.timer) clearInterval(this.timer) }
  async summary(date?: string) {
    const data=await this.read(date)
    const eventWhere = {ruleCode:{startsWith:'BOSS_'},OR:[{createdAt:{gte:data.range.start,lt:data.range.end}},...(data.range.date===venueDay()?[{status:{in:['OPEN','REVIEWING'] as const}}]:[])]}
    const events=await this.prisma.riskEvent.findMany({where:eventWhere as Prisma.RiskEventWhereInput,select:{id:true,ruleCode:true,severity:true,status:true,summary:true,objectType:true,objectId:true,orderId:true,evidence:true,createdAt:true,lastSeenAt:true},orderBy:[{severity:'desc'},{createdAt:'desc'}],take:100})
    const eventCount=await this.prisma.riskEvent.count({where:eventWhere as Prisma.RiskEventWhereInput})
    return {...data.summary, events, eventCount, eventsTruncated:eventCount>events.length, monitor:{...this.scanState,intervalMinutes:5,thresholds:this.thresholds()}, aiConfigured:Boolean(this.config.get('BOSS_LLM_API_KEY'))}
  }
  async read(date?: string, now=new Date()) {
    const range=dayRange(date,now), {start,end}=range
    const data=await this.prisma.$transaction(async tx=> {
      const [courts,slots,bookings,closures,orders,payments,refunds,games,events] = await Promise.all([
        tx.court.findMany({where:{enabled:true},select:{id:true,createdAt:true}}),
        tx.timeSlot.findMany({where:{enabled:true},select:{id:true,label:true,startMinutes:true,endMinutes:true},orderBy:{startMinutes:'asc'}}),
        tx.courtBooking.findMany({where:{startsAt:{lt:new Date(+end+30*DAY)},endsAt:{gt:new Date(+start-7*DAY)},status:{in:['HELD','CONFIRMED','CHECKED_IN','COMPLETED']}},select:{id:true,courtId:true,orderId:true,status:true,startsAt:true,endsAt:true,holdExpiresAt:true}}),
        tx.courtClosure.findMany({where:{status:'ACTIVE',startsAt:{lt:end},endsAt:{gt:new Date(+start-7*DAY)}},select:{courtId:true,startsAt:true,endsAt:true}}),
        tx.order.findMany({where:{OR:[{createdAt:{gte:new Date(+start-DAY),lt:end}},{paidAt:{gte:new Date(+start-DAY),lt:end}},{completedAt:{gte:start,lt:end}},{cancelledAt:{gte:start,lt:end}},{status:'PENDING'}]},select:{id:true,businessType:true,sourceChannel:true,status:true,createdAt:true,paidAt:true,completedAt:true,cancelledAt:true,paidCents:true,payableCents:true,parameterSnapshot:true,refunds:{where:{status:'SUCCEEDED'},select:{amountCents:true,completedAt:true}}}}),
        tx.payment.findMany({where:{OR:[{paidAt:{gte:start,lt:end},status:{in:[...paidStates]}},{createdAt:{gte:new Date(+start-DAY),lt:end},status:'FAILED'},{status:{in:['CREATED','PROCESSING']}}]},select:{id:true,orderId:true,channel:true,status:true,amountCents:true,createdAt:true,paidAt:true}}),
        tx.refund.findMany({where:{OR:[{completedAt:{gte:new Date(+start-DAY),lt:end}},{requestedAt:{gte:start,lt:end}}]},select:{orderId:true,status:true,amountCents:true,completedAt:true,requestedAt:true,order:{select:{businessType:true,completedAt:true}}}}),
        tx.game.findMany({where:{status:{in:['OPEN','FULL','IN_PROGRESS']},endsAt:{gt:now}},select:{id:true,title:true,status:true,startsAt:true,capacity:true,registrations:{select:{status:true,order:{select:{status:true,paidCents:true,refundedCents:true}}}}},orderBy:{startsAt:'asc'}}),
        tx.event.findMany({where:{status:{in:['OPEN','FULL','IN_PROGRESS']},OR:[{startsAt:{gte:now}},{status:'IN_PROGRESS'}]},select:{id:true,name:true,status:true,startsAt:true,registrationEndsAt:true,capacityPeople:true,teams:{select:{status:true,order:{select:{status:true,paidCents:true,refundedCents:true}}}}},orderBy:{startsAt:'asc'}}),
      ])
      return {courts,slots,bookings,closures,orders,payments,refunds,games,events}
    },{isolationLevel:Prisma.TransactionIsolationLevel.RepeatableRead,timeout:30000})
    const {orders,payments,refunds}=data
    const created=orders.filter(o=>inside(o.createdAt,start,end)), paid=payments.filter(p=>paidStates.includes(p.status as any) && inside(p.paidAt,start,end)), refunded=refunds.filter(r=>r.status==='SUCCEEDED' && inside(r.completedAt,start,end))
    const completed=orders.filter(o=>o.businessType==='VENUE' && inside(o.completedAt,start,end))
    const venueRevenueCents=completed.reduce((sum,o)=>sum+o.paidCents-o.refunds.filter(r=>r.completedAt && +r.completedAt<+o.completedAt!).reduce((s,r)=>s+r.amountCents,0),0)-refunded.filter(r=>r.order.businessType==='VENUE' && r.order.completedAt && +r.order.completedAt<=+r.completedAt!).reduce((s,r)=>s+r.amountCents,0)
    const venue=utilization(data.courts,data.slots,data.bookings,data.closures,start)
    const activities=[...data.games.map(g=>activitySummary(g,'GAME')),...data.events.map(e=>activitySummary(e,'EVENT'))].sort((a,b)=>+new Date(a.startsAt)-+new Date(b.startsAt))
    const summary={ date:range.date, timezone:'Asia/Shanghai', capturedAt:now.toISOString(),
      daily:{orderCount:created.length,venueOrderCount:created.filter(o=>o.businessType==='VENUE').length,assistedVenueOrderCount:created.filter(o=>o.businessType==='VENUE' && (o.parameterSnapshot as any)?.operatorAssisted===true).length,pendingOrderCount:created.filter(o=>o.status==='PENDING').length,pendingBacklogCount:orders.filter(o=>o.status==='PENDING' && +o.createdAt<+end).length,cancelledOrderCount:orders.filter(o=>inside(o.cancelledAt,start,end)).length,refundedOrderCount:new Set(refunded.map(r=>r.orderId)).size,refundRequestedOrderCount:new Set(refunds.filter(r=>inside(r.requestedAt,start,end)).map(r=>r.orderId)).size,paidCents:paid.reduce((s,p)=>s+p.amountCents,0),wechatPaidCents:paid.filter(p=>p.channel==='WECHAT').reduce((s,p)=>s+p.amountCents,0),refundedCents:refunded.reduce((s,r)=>s+r.amountCents,0),venueRevenueCents},
      venue,activities,activityCount:activities.length,activitiesAsOf:now.toISOString(),
      definitions:{orders:'订单数按当天创建；取消按取消时间；退款按成功时间，取消与退款分开计数。未支付为当日创建且仍待支付，积压含更早日期。',payments:'已支付金额按付款成功时间统计所有业务及支付渠道，包含充值预收与余额支付；微信实收单独列示，不等同经营收入。',venueRevenue:'场地收入按场地订单履约完成时间确认，已成功退款按确认时点反冲；不含充值、培训和活动收入。',utilization:'使用率=已确认/签到/完成预约占用分钟÷可售分钟，排除封场和待支付临时占位；以当前启用场地、营业时段配置计算。',activities:'活动为查询时当前及未来开放球局/积分赛。双打每队按2人；确认报名、待支付占位、候补分别统计。已收报名费为累计实付减成功退款。'} }
    return {range,summary,data}
  }
  scan(): Promise<void> {
    if(this.pending) return this.pending
    this.pending=this.runScan().catch(()=>{this.scanState.error='事件扫描失败，已记录事件仍可查看；系统将在下一轮重试';this.logger.error('Business event scan failed')}).finally(()=>{this.pending=undefined})
    return this.pending
  }
  private async runScan() {
    const now=new Date(), {data,range,summary}=await this.read(undefined,now)
    const history=Array.from({length:7},(_,i)=>utilization(data.courts,data.slots,data.bookings,data.closures,new Date(+range.start-(i+1)*DAY)))
    const candidates=detectEvents({now,orders:data.orders,payments:data.payments,refunds:data.refunds,bookings:data.bookings.filter(b=>+b.endsAt>+range.start),activities:summary.activities,history,thresholds:this.thresholds()})
    for(const c of candidates) {
      const evidence=JSON.parse(JSON.stringify({...c.evidence,observedAt:now.toISOString()}))
      await this.prisma.riskEvent.upsert({where:{dedupKey:c.key},create:{dedupKey:c.key,ruleCode:c.ruleCode,severity:c.severity,objectType:c.objectType,objectId:c.objectId,orderId:c.orderId,summary:c.summary,evidence,lastSeenAt:now},update:{lastSeenAt:now,evidence}})
    }
    this.scanState={lastSucceededAt:now.toISOString(),error:null}
  }
}
