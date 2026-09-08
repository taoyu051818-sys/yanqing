import 'reflect-metadata'
import { describe, expect, it, vi, afterEach } from 'vitest'
import { ConfigService } from '@nestjs/config'
import { BossBriefingService, briefingFacts } from './briefing.service.js'
import { BossController } from './boss.controller.js'
import { ROLES_KEY, IS_PUBLIC_KEY } from '../common/auth/auth.decorators.js'
const summary:any={date:'2026-09-07',timezone:'Asia/Shanghai',daily:{venueOrderCount:2,assistedVenueOrderCount:1,paidCents:10000,wechatPaidCents:10000,venueRevenueCents:3000,pendingOrderCount:1,cancelledOrderCount:0,refundedOrderCount:0},venue:{utilizationRate:30,emptiestSlots:[{id:'secret-slot-id',label:'09:00–10:00'}]},activities:[{name:'公开活动',phone:'secret-phone',id:'secret-id'}],activityCount:1,events:[{ruleCode:'BOSS_PAYMENT_EXCEPTION',summary:'支付待核实',evidence:{providerPayload:'secret'}}],eventCount:1,monitor:{lastSucceededAt:null,error:null},definitions:{}}
function setup(config:Record<string,any>={},claim=1,old:any={}){
 const prisma:any={bossBriefing:{upsert:vi.fn().mockResolvedValue({}),findUniqueOrThrow:vi.fn().mockResolvedValue(old),updateMany:vi.fn().mockResolvedValue({count:claim}),update:vi.fn().mockResolvedValue({})}}
 const boss:any={summary:vi.fn().mockResolvedValue(summary),monitorStatus:()=>summary.monitor}
 return {service:new BossBriefingService(prisma,boss,new ConfigService(config)),prisma}
}
afterEach(()=>vi.unstubAllGlobals())
describe('owner AI briefing boundary',()=>{
 it('is role protected and never public',()=>{
  expect(Reflect.getMetadata(ROLES_KEY,BossController)).toEqual(['ADMIN','SUPER_ADMIN','FINANCE'])
  expect(Reflect.getMetadata(IS_PUBLIC_KEY,BossController)).not.toBe(true)
  for(const name of ['summary','briefing','generate'] as const)expect(Reflect.getMetadata(IS_PUBLIC_KEY,BossController.prototype[name])).not.toBe(true)
 })
 it('does not send member/contact/payment metadata to the provider',()=>{
  expect(JSON.stringify(briefingFacts(summary))).not.toContain('secret')
 })
 it('sends the configured model to the configured server and caches a safe text response',async()=>{
  const fetch=vi.fn().mockResolvedValue({ok:true,json:async()=>({choices:[{message:{content:'今日订场2笔，请核对支付异常。'}}]})});vi.stubGlobal('fetch',fetch)
  const {service,prisma}=setup({BOSS_LLM_API_KEY:'test-key',BOSS_LLM_BASE_URL:'https://provider.example/v1',BOSS_LLM_MODEL:'gpt-5.6-sol'})
  expect(await service.generate()).toMatchObject({source:'AI',model:'gpt-5.6-sol'})
  expect(fetch.mock.calls[0][0]).toBe('https://provider.example/v1/chat/completions')
  expect(JSON.parse(fetch.mock.calls[0][1].body).model).toBe('gpt-5.6-sol')
  expect(prisma.bossBriefing.update.mock.calls[0][0].data.leaseUntil).toBeNull()
 })
 it('keeps exact factual data if the provider fails without leaking its error',async()=>{
  vi.stubGlobal('fetch',vi.fn().mockRejectedValue(new Error('secret-key-provider-error')))
  const {service}=setup({BOSS_LLM_API_KEY:'test-key'})
  const result=await service.generate();expect(result.source).toBe('FACTS');expect(result.text).toContain('100.00元');expect(JSON.stringify(result)).not.toContain('secret-key')
 })
 it('does not call a paid provider when another request holds the lease/cooldown',async()=>{
  const fetch=vi.fn();vi.stubGlobal('fetch',fetch)
  expect((await setup({BOSS_LLM_API_KEY:'test-key'},0).service.generate()).source).toBe('FACTS');expect(fetch).not.toHaveBeenCalled()
 })
})
