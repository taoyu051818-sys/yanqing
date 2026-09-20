import { beforeEach, expect, it, vi } from 'vitest'
import { mockRequest } from './router'
import { getOrders, saveOrders } from './venue'
import { getVenueBookings, saveVenueBookings } from './state'
const storage = new Map<string,unknown>()
vi.stubGlobal('uni',{getStorageSync:(key:string)=>storage.get(key)||'',setStorageSync:(key:string,value:unknown)=>storage.set(key,value),removeStorageSync:(key:string)=>storage.delete(key)})
const command={amountCents:5000,reason:'会员取消预约',idempotencyKey:'direct-refund-retry-key'}
beforeEach(()=>{
  storage.clear()
  saveOrders([{id:'direct-order',memberId:'user-member',businessType:'VENUE',status:'PAID',paidCents:5000,payableCents:5000,refundedCents:0,items:[]}])
  saveVenueBookings([{id:'direct-booking',orderId:'direct-order',courtId:'court-1',status:'CONFIRMED'}] as any)
})
it.each(['ADMIN','SUPER_ADMIN'])('%s finishes refund and resource release with one command; retry returns the same refund',async role=>{
  await mockRequest('POST','/auth/dev-login',{role})
  const first:any=await mockRequest('POST','/orders/direct-order/refunds/direct',command)
  expect(first.status).toBe('SUCCEEDED')
  const second:any=await mockRequest('POST','/orders/direct-order/refunds/direct',command)
  expect(second.id).toBe(first.id)
  expect(getOrders()[0]).toMatchObject({status:'REFUNDED',refundedCents:5000})
  expect(getOrders()[0].refunds).toHaveLength(1)
  expect(getVenueBookings()[0].status).toBe('CANCELLED')
})
it.each(['MEMBER','FRONT_DESK','FINANCE'])('%s cannot use the direct endpoint',async role=>{
  await mockRequest('POST','/auth/dev-login',{role})
  await expect(mockRequest('POST','/orders/direct-order/refunds/direct',command)).rejects.toThrow('仅管理员')
  expect(getOrders()[0].status).toBe('PAID')
})
it('member refund remains an application awaiting approval',async()=>{
  await mockRequest('POST','/auth/dev-login',{role:'MEMBER'})
  expect(await mockRequest('POST','/orders/direct-order/refunds',command)).toMatchObject({status:'REQUESTED'})
  expect(getOrders()[0].refundedCents).toBe(0)
})

it('partial refunds retain the booking and completed attendance is preserved after a full refund',async()=>{
  await mockRequest('POST','/auth/dev-login',{role:'SUPER_ADMIN'})
  await mockRequest('POST','/orders/direct-order/refunds/direct',{...command,amountCents:1000})
  expect(getVenueBookings()[0].status).toBe('CONFIRMED')
  saveVenueBookings([{...getVenueBookings()[0],status:'COMPLETED'}] as any)
  await mockRequest('POST','/orders/direct-order/refunds/direct',{...command,amountCents:4000,idempotencyKey:'direct-refund-remainder'})
  expect(getOrders()[0].refundedCents).toBe(5000)
  expect(getVenueBookings()[0].status).toBe('COMPLETED')
})
