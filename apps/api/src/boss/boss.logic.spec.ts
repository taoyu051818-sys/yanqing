import { describe, expect, it } from 'vitest'
import { activitySummary, dayRange, defaultThresholds, detectEvents, utilization } from './boss.logic.js'
const now=new Date('2026-09-07T12:00:00+08:00'), start=dayRange('2026-09-07',now).start
const at=(time:string)=>new Date('2026-09-07T'+time+':00+08:00')
const slot={id:'slot',label:'09:00–10:00',startMinutes:540,endMinutes:600}
const base=()=>({now,orders:[],payments:[],refunds:[],bookings:[],activities:[],history:[],thresholds:defaultThresholds})
describe('owner summary business definitions',()=>{
 it('uses Beijing calendar dates and rejects invalid dates and future queries',()=>{
  expect(dayRange('2026-09-07',now).start.toISOString()).toBe('2026-09-06T16:00:00.000Z')
  for(const date of ['2026-02-30','2026-09-08','2025-01-01','bad'])expect(()=>dayRange(date,now)).toThrow()
 })
 it('unions duplicate overlaps, removes closures, and excludes unpaid holds',()=>{
  const booking={courtId:'court',status:'CONFIRMED',startsAt:at('09:00'),endsAt:at('10:00')}
  const closure={courtId:'court',startsAt:at('09:00'),endsAt:at('09:30')}
  const r=utilization([{id:'court'},{id:'empty'}],[slot],[booking,booking,{...booking,courtId:'empty',status:'HELD'}],[closure,closure],start)
  expect(r.availableMinutes).toBe(90);expect(r.occupiedMinutes).toBe(30);expect(r.utilizationRate).toBe(33.33)
  expect(r.emptiestSlots[0].emptyMinutes).toBe(60)
 })
 it('does not call a fully closed venue zero percent or count days before court creation',()=>{
  const close={courtId:'court',startsAt:at('09:00'),endsAt:at('10:00')}
  expect(utilization([{id:'court'}],[slot],[],[close],start).utilizationRate).toBeNull()
  expect(utilization([{id:'court',createdAt:at('11:00')}],[slot],[],[],start).availableMinutes).toBe(0)
 })
 it('counts doubles teams as people and separates paid, held, cancelled and waitlist',()=>{
  const a=activitySummary({id:'e',name:'event',capacityPeople:8,teams:[{status:'PAID',order:{status:'PAID',paidCents:9900,refundedCents:0}},{status:'REGISTERED',order:{status:'PENDING',paidCents:0}},{status:'WAITLISTED'},{status:'CANCELLED',order:{status:'REFUNDED',paidCents:9900,refundedCents:9900}}]},'EVENT')
  expect(a).toMatchObject({confirmedPeople:2,unpaidPeople:2,reservedPeople:4,remainingPeople:4,waitlistPeople:2,collectedCents:9900})
 })
})
describe('structured business event rules',()=>{
 it('detects large settled payments, stalled payment and old unpaid order at thresholds',()=>{
  const input:any=base();input.orders=[{id:'large',businessType:'RECHARGE',paidCents:200000,paidAt:now,status:'PAID'},{id:'old',createdAt:at('11:30'),status:'PENDING',payableCents:3000},{id:'not-paid',businessType:'RECHARGE',paidCents:0,status:'PENDING',createdAt:now}];input.payments=[{id:'p',orderId:'old',status:'PROCESSING',createdAt:at('11:50'),amountCents:3000}]
  const r=detectEvents(input);expect(r.map(e=>e.ruleCode)).toEqual(['BOSS_LARGE_RECHARGE','BOSS_OVERDUE_PENDING','BOSS_PAYMENT_EXCEPTION']);expect(r.find(e=>e.ruleCode==='BOSS_PAYMENT_EXCEPTION')?.evidence).toMatchObject({thresholdMinutes:10})
 })
 it('ignores adjacent bookings and expired holds, but detects overlapping active orders',()=>{
  const input:any=base();input.bookings=[{id:'a',courtId:'c',status:'CONFIRMED',startsAt:at('13:00'),endsAt:at('14:00')},{id:'b',courtId:'c',status:'CONFIRMED',startsAt:at('14:00'),endsAt:at('15:00')},{id:'expired',courtId:'c',status:'HELD',holdExpiresAt:at('11:00'),startsAt:at('13:00'),endsAt:at('14:00')}]
  expect(detectEvents(input)).toHaveLength(0)
  input.bookings.push({id:'c',courtId:'c',status:'CONFIRMED',startsAt:at('13:30'),endsAt:at('14:00')})
  const r=detectEvents(input);expect(r).toHaveLength(1);expect(r[0]).toMatchObject({ruleCode:'BOSS_COURT_CONFLICT',severity:'CRITICAL',key:'conflict:a:c'})
 })
 it('does not alert about filled or low-signup historical activities',()=>{
  const input:any=base();input.activities=[{id:'a',kind:'GAME',status:'OPEN',startsAt:at('20:00'),registrationEndsAt:at('19:00'),capacityPeople:10,reservedPeople:9,confirmedPeople:9},{id:'b',kind:'EVENT',status:'OPEN',startsAt:at('20:00'),registrationEndsAt:at('19:00'),capacityPeople:48,reservedPeople:4,confirmedPeople:2},{id:'old',kind:'GAME',status:'COMPLETED',startsAt:at('09:00'),registrationEndsAt:at('08:00'),capacityPeople:10,reservedPeople:10,confirmedPeople:10}]
  expect(detectEvents(input).map(e=>e.ruleCode)).toEqual(['BOSS_ACTIVITY_NEAR_FULL','BOSS_ACTIVITY_LOW_SIGNUP'])
 })
 it('requires multiple successful refunds within 24h and at least three sellable days for persistent emptiness',()=>{
  const input:any=base();input.refunds=Array.from({length:3},()=>({status:'SUCCEEDED',completedAt:now,amountCents:100}));input.history=Array.from({length:3},()=>utilization([{id:'c'}],[slot],[],[],start));expect(detectEvents(input).map(e=>e.ruleCode)).toEqual(['BOSS_FREQUENT_REFUNDS','BOSS_PERSISTENT_EMPTY_SLOT']);input.refunds[0].status='PROCESSING';input.history.pop();expect(detectEvents(input)).toHaveLength(0)
 })
})
