import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { beforeAll, afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { PrismaService } from '../src/database/prisma.service.js';
import { VenuesService } from '../src/venues/venues.service.js';
import { OrdersService } from '../src/orders/orders.service.js';
import { OrderFinalizerService } from '../src/payments/order-finalizer.service.js';
import { AllianceService } from '../src/alliance/alliance.service.js';
import { WechatPayService } from '../src/payments/wechat-pay.service.js';

const url = process.env.TEST_DATABASE_URL;
const key = () => 'review19-' + randomUUID();
const day = 86400000;
describe.skipIf(!url)('coupon reservation and external payment compensation', () => {
  let db: PrismaService, venues: VenuesService, orders: OrdersService, finalizer: OrderFinalizerService;
  const provider = { createJsapiPayment: vi.fn(async () => ({ package: 'prepay_id=isolated' })), closeOrder: vi.fn(async () => ({ closed: true })), createRefund: vi.fn(async () => ({ refundId: key(), status: 'PROCESSING' })) };
  beforeAll(async () => {
    const target = new URL(url!);
    if (!['localhost', '127.0.0.1', 'postgres'].includes(target.hostname) || !target.pathname.endsWith('_test')) throw new Error('Local test database required');
    db = new PrismaService(new ConfigService({ DATABASE_URL: url }));
    await db.$connect();
    finalizer = new OrderFinalizerService({} as never);
    venues = new VenuesService(db);
    orders = new OrdersService(db, new ConfigService({ PAYMENT_PROVIDER: 'wechat' }), finalizer, provider as never);
  });
  afterEach(() => { vi.useRealTimers(); });
  afterAll(async () => { await db?.$disconnect(); });
  async function fixture(validityMs = day) {
    const user = await db.user.create({ data: { displayName: '隔离券订场会员', openId: key(), memberProfile: { create: { tags: [] } }, accounts: { create: { type: 'CASH_PRINCIPAL', balance: 10000 } } } });
    const actor = { sub: user.id, displayName: user.displayName, roles: ['MEMBER'] as any };
    const merchant = await db.merchant.create({ data: { code: key(), name: '隔离券商户', category: 'TEST', level: 'TRAFFIC_PARTNER', settlementRule: {} } });
    const template = await db.couponTemplate.create({ data: { code: key(), name: '抵扣十元', merchantId: merchant.id, activityName: '隔离测试', benefitDescription: '抵扣十元', faceValueCents: 1000, allowVenueBooking: true,
      validFrom: new Date(Date.now() - day), validTo: new Date(Date.now() + validityMs), issueLimit: 1, issuedCount: 1, claimedCount: 1 } });
    const coupon = await db.couponCode.create({ data: { code: key(), templateId: template.id, status: 'CLAIMED', holderId: user.id, claimedAt: new Date(), expiresAt: template.validTo } });
    const slot = await db.timeSlot.create({ data: { code: key(), label: '隔离14时', startMinutes: 840, endMinutes: 900, period: 'DAYTIME', sortOrder: 9000 } });
    await db.priceRule.create({ data: { code: randomUUID().toUpperCase(), version: 1, name: '隔离时价', timeSlotId: slot.id, priceCents: 3000, effectiveFrom: new Date(Date.now() - day), enabled: true,
      creationIdempotencyKey: key(), creationCommandHash: 'a'.repeat(64), createdById: user.id } });
    async function book() {
      const court = await db.court.create({ data: { code: key(), name: '隔离场地', zone: 'EAST', sortOrder: 9000 } });
      return venues.createBooking({ courtId: court.id, slotId: slot.id, date: new Date(Date.now() + 5 * day).toISOString().slice(0, 10), couponCode: coupon.code,
        sourceChannel: 'MINI_PROGRAM', creationIdempotencyKey: key() }, actor);
    }
    const a = await book();
    const b = await book();
    expect(a.payableCents).toBe(2000); expect(b.payableCents).toBe(2000);
    return { actor, a, b, coupon, merchant, book };
  }
  const pay = (order: any, actor: any, channel = 'WECHAT') => orders.pay(order.id, { channel: channel as any, expectedDebitAmount: 2000, idempotencyKey: key() }, actor);
  async function notice(order: any, transactionId = key()) {
    const wechat = new WechatPayService(new ConfigService({ PAYMENT_PROVIDER: 'wechat' }), db, finalizer);
    vi.spyOn(wechat as any, 'verifyWechatSignature').mockImplementation(() => {});
    vi.spyOn(wechat as any, 'decrypt').mockReturnValue({ out_trade_no: order.orderNo, transaction_id: transactionId, trade_state: 'SUCCESS', amount: { total: 2000 } });
    return wechat.handleNotification(Buffer.from(JSON.stringify({ event_type: 'TRANSACTION.SUCCESS', resource: {} })), {
      'wechatpay-timestamp': String(Math.floor(Date.now() / 1000)), 'wechatpay-nonce': 'test', 'wechatpay-signature': 'test', 'wechatpay-serial': 'test',
    });
  }
  async function expectCompensated(order: any) {
    expect(await db.order.findUniqueOrThrow({ where: { id: order.id } })).toMatchObject({ status: 'REFUND_PENDING', paidCents: 2000 });
    expect(await db.payment.findFirstOrThrow({ where: { orderId: order.id } })).toMatchObject({ status: 'SUCCEEDED', providerTradeNo: expect.any(String) });
    expect(await db.courtBooking.findFirstOrThrow({ where: { orderId: order.id } })).toMatchObject({ status: 'CANCELLED', holdExpiresAt: null });
    expect(await db.refund.findFirstOrThrow({ where: { orderId: order.id } })).toMatchObject({ status: 'REQUESTED', amountCents: 2000, compensationOnly: true });
    expect(await db.refund.count({ where: { orderId: order.id } })).toBe(1);
    expect(await db.riskEvent.count({ where: { orderId: order.id, ruleCode: 'BOSS_LATE_PAYMENT' } })).toBe(1);
  }
  async function legacyPrepay(order: any, actor: any) {
    return db.payment.create({ data: { paymentNo: key(), orderId: order.id, userId: actor.sub, operatorId: actor.sub, channel: 'WECHAT', amountCents: 2000, status: 'PROCESSING', idempotencyKey: key() } });
  }
  it('accepts a valid coupon success notice and confirms the booking', async () => {
    const f = await fixture();
    await pay(f.a, f.actor);
    expect(await db.couponCode.findUniqueOrThrow({ where: { id: f.coupon.id } })).toMatchObject({ status: 'CLAIMED', attributionOrderId: f.a.id });
    expect(await notice(f.a)).toMatchObject({ accepted: true });
    expect(await db.order.findUniqueOrThrow({ where: { id: f.a.id as string } })).toMatchObject({ status: 'PAID', paidCents: 2000 });
    expect(await db.courtBooking.findFirstOrThrow({ where: { orderId: f.a.id as string } })).toMatchObject({ status: 'CONFIRMED' });
  });
  it('blocks new payment and quotes after another order consumed the coupon', async () => {
    const f = await fixture();
    await pay(f.a, f.actor, 'CASH_PRINCIPAL');
    const calls = provider.createJsapiPayment.mock.calls.length;
    const quote: any = await orders.paymentOptions(f.b.id as string, f.actor);
    expect(quote.options.every((row: any) => !row.enabled)).toBe(true);
    await expect(pay(f.b, f.actor)).rejects.toThrow('优惠券已被使用');
    expect(provider.createJsapiPayment).toHaveBeenCalledTimes(calls);
    expect(await db.payment.count({ where: { orderId: f.b.id as string } })).toBe(0);
  });
  it('reserves one prepayment and blocks other bookings, payments and merchant redemption', async () => {
    const f = await fixture();
    const payment = await pay(f.a, f.actor);
    await expect(pay(f.b, f.actor)).rejects.toThrow('锁定到其他订单');
    await expect(f.book()).rejects.toThrow('待支付订场');
    const alliance = new AllianceService(db);
    await expect(alliance.redeem({ code: f.coupon.code, merchantId: f.merchant.id, attributedAmountCents: 1000, idempotencyKey: key() }, { ...f.actor, roles: ['SUPER_ADMIN'] })).rejects.toThrow('待支付订场');
    const coupons = await alliance.listMyCoupons(f.actor);
    expect(coupons.find(row => row.id === f.coupon.id)?.bookingUsage.eligible).toBe(false);
    // Original prepay can be replayed, without generating a second provider request.
    const persisted = await db.payment.findFirstOrThrow({ where: { orderId: f.a.id as string } });
    const calls = provider.createJsapiPayment.mock.calls.length;
    expect(await orders.pay(f.a.id as string, { channel: 'WECHAT', idempotencyKey: persisted.idempotencyKey }, f.actor)).toMatchObject({ status: payment.status });
    expect(provider.createJsapiPayment).toHaveBeenCalledTimes(calls);
  });
  it('compensates the second legacy prepayment and replays the same notice exactly once', async () => {
    const f = await fixture();
    await legacyPrepay(f.a, f.actor); await legacyPrepay(f.b, f.actor);
    await notice(f.a);
    const transactionId = key();
    expect(await notice(f.b, transactionId)).toMatchObject({ accepted: true, refundReviewRequired: true });
    expect(await notice(f.b, transactionId)).toMatchObject({ accepted: true, idempotent: true });
    await expectCompensated(f.b);
    expect(await db.couponCode.findUniqueOrThrow({ where: { id: f.coupon.id } })).toMatchObject({ status: 'REDEEMED', attributionOrderId: f.a.id });
  });
  it('compensates success after expiry and releases only its own reservation', async () => {
    const f = await fixture(60000);
    await pay(f.a, f.actor);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(f.coupon.expiresAt.getTime() + 1000));
    expect(await notice(f.a)).toMatchObject({ accepted: true, refundReviewRequired: true });
    await expectCompensated(f.a);
    expect(await db.couponCode.findUniqueOrThrow({ where: { id: f.coupon.id } })).toMatchObject({ status: 'CLAIMED', attributionOrderId: null });
  });
  it('keeps the coupon reserved if provider close fails and releases it after a confirmed cancellation', async () => {
    const f = await fixture();
    await pay(f.a, f.actor);
    provider.closeOrder.mockRejectedValueOnce(new Error('provider close failed'));
    const command = { reason: '取消优惠订场', idempotencyKey: key() };
    await expect(orders.cancelPending(f.a.id as string, command, f.actor)).rejects.toThrow('provider close failed');
    expect(await db.couponCode.findUniqueOrThrow({ where: { id: f.coupon.id } })).toMatchObject({ attributionOrderId: f.a.id });
    await orders.cancelPending(f.a.id as string, command, f.actor);
    expect(await db.couponCode.findUniqueOrThrow({ where: { id: f.coupon.id } })).toMatchObject({ attributionOrderId: null, status: 'CLAIMED' });
    await pay(f.b, f.actor);
    expect(await db.couponCode.findUniqueOrThrow({ where: { id: f.coupon.id } })).toMatchObject({ attributionOrderId: f.b.id });
    await orders.cancelPending(f.a.id as string, command, f.actor);
    expect(await db.couponCode.findUniqueOrThrow({ where: { id: f.coupon.id } })).toMatchObject({ attributionOrderId: f.b.id });
  });
  it('rolls back coupon reservation if creating prepay fails', async () => {
    const f = await fixture();
    provider.createJsapiPayment.mockRejectedValueOnce(new Error('prepay offline'));
    await expect(pay(f.a, f.actor)).rejects.toThrow('prepay offline');
    expect(await db.couponCode.findUniqueOrThrow({ where: { id: f.coupon.id } })).toMatchObject({ status: 'CLAIMED', attributionOrderId: null });
    expect(await db.payment.count({ where: { orderId: f.a.id as string } })).toBe(0);
  });
  it('does not return a legacy prepay whose coupon was consumed meanwhile', async () => {
    const f = await fixture();
    const legacy = await legacyPrepay(f.b, f.actor);
    await pay(f.a, f.actor, 'CASH_PRINCIPAL');
    await expect(orders.pay(f.b.id as string, { channel: 'WECHAT', idempotencyKey: legacy.idempotencyKey }, f.actor)).rejects.toThrow('优惠券已被使用');
  });
  it('serializes competing prepayments before calling the provider twice', async () => {
    const f = await fixture();
    const before = provider.createJsapiPayment.mock.calls.length;
    const results = await Promise.allSettled([pay(f.a, f.actor), pay(f.b, f.actor)]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(provider.createJsapiPayment).toHaveBeenCalledTimes(before + 1);
    expect(await db.payment.count({ where: { orderId: { in: [f.a.id as string, f.b.id as string] } } })).toBe(1);
  });
  it.each(['expired', 'disabled-template', 'disabled-merchant', 'wrong-holder', 'missing-code'])('blocks %s before creating an external payment', async mode => {
    const f = await fixture();
    if (mode === 'expired') await db.couponCode.update({ where: { id: f.coupon.id }, data: { expiresAt: new Date(Date.now() - 1) } });
    if (mode === 'disabled-template') await db.couponTemplate.update({ where: { id: f.coupon.templateId }, data: { enabled: false } });
    if (mode === 'disabled-merchant') await db.merchant.update({ where: { id: f.merchant.id }, data: { status: 'DISABLED' } });
    if (mode === 'missing-code') await db.order.update({ where: { id: f.a.id as string }, data: { consumedCouponCode: null } });
    if (mode === 'wrong-holder') await db.couponCode.update({ where: { id: f.coupon.id }, data: { holderId: null } });
    const before = provider.createJsapiPayment.mock.calls.length;
    await expect(pay(f.a, f.actor)).rejects.toThrow('优惠券');
    expect(provider.createJsapiPayment).toHaveBeenCalledTimes(before);
    expect(await db.payment.count({ where: { orderId: f.a.id as string } })).toBe(0);
  });
  it('finishes compensation through finance approval and duplicate refund success without changing the first booking', async () => {
    const f = await fixture();
    await legacyPrepay(f.a, f.actor); await legacyPrepay(f.b, f.actor);
    await notice(f.a); await notice(f.b);
    const refund = await db.refund.findFirstOrThrow({ where: { orderId: f.b.id as string } });
    const reviewer = await db.user.create({ data: { displayName: '隔离退款审批', primaryRole: 'FINANCE' } });
    await orders.approveRefund(refund.id, { reason: '无法履约，原路退回' }, { sub: reviewer.id, displayName: reviewer.displayName, roles: ['FINANCE'] });
    const wechat = new WechatPayService(new ConfigService({ PAYMENT_PROVIDER: 'wechat' }), db, finalizer);
    vi.spyOn(wechat as any, 'verifyWechatSignature').mockImplementation(() => {});
    vi.spyOn(wechat as any, 'decrypt').mockReturnValue({ out_refund_no: refund.refundNo, refund_id: key(), refund_status: 'SUCCESS', amount: { refund: 2000, total: 2000 } });
    const body = Buffer.from(JSON.stringify({ event_type: 'REFUND.SUCCESS', resource: {} }));
    const headers = { 'wechatpay-timestamp': String(Math.floor(Date.now() / 1000)), 'wechatpay-nonce': 'test', 'wechatpay-signature': 'test', 'wechatpay-serial': 'test' };
    await wechat.handleNotification(body, headers); await wechat.handleNotification(body, headers);
    expect(await db.order.findUniqueOrThrow({ where: { id: f.b.id as string } })).toMatchObject({ status: 'REFUNDED', refundedCents: 2000 });
    expect(await db.order.findUniqueOrThrow({ where: { id: f.a.id as string } })).toMatchObject({ status: 'PAID', refundedCents: 0 });
    expect(await db.couponCode.findUniqueOrThrow({ where: { id: f.coupon.id } })).toMatchObject({ status: 'REDEEMED', attributionOrderId: f.a.id });
    expect(await db.couponTemplate.findUniqueOrThrow({ where: { id: f.coupon.templateId } })).toMatchObject({ redeemedCount: 1 });
  });

});
