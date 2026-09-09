import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest';
import { PrismaService } from '../src/database/prisma.service.js';
import { VenuesService } from '../src/venues/venues.service.js';
import { OrdersService } from '../src/orders/orders.service.js';
import { OrderFinalizerService } from '../src/payments/order-finalizer.service.js';
import type { AuthUser } from '../src/common/auth/auth-user.js';
import type { AppRole } from '../src/generated/prisma/enums.js';

const key = () => 'free-venue-' + randomUUID();
const url = process.env.TEST_DATABASE_URL;
const day = 86400000;
describe.skipIf(!url)('confirmed free venue cancellation', () => {
  let db: PrismaService, venues: VenuesService, orders: OrdersService;
  const provider = { createJsapiPayment: vi.fn(), closeOrder: vi.fn() };
  beforeAll(async () => {
    const target = new URL(url!);
    if (!['localhost', '127.0.0.1', 'postgres'].includes(target.hostname) || !target.pathname.endsWith('_test')) throw new Error('Local database ending in _test required');
    db = new PrismaService(new ConfigService({ DATABASE_URL: url }));
    await db.$connect();
    venues = new VenuesService(db);
    orders = new OrdersService(db, new ConfigService({ PAYMENT_PROVIDER: 'wechat' }), new OrderFinalizerService({} as never), provider as never);
  });
  afterAll(async () => { await db?.$disconnect(); });
  async function person(role: AppRole = 'MEMBER'): Promise<AuthUser> {
    const user = await db.user.create({ data: { displayName: '隔离免费订场用户', primaryRole: role, memberProfile: { create: { tags: [] } }, accounts: { create: { type: 'CASH_PRINCIPAL', balance: 1000 } } } });
    return { sub: user.id, displayName: user.displayName, roles: [role] };
  }
  async function book(confirm = true, withCoupon = false, fee = withCoupon ? 100 : 0) {
    const actor = await person();
    const court = await db.court.create({ data: { code: key(), name: '隔离场地', zone: 'EAST', sortOrder: 9000 } });
    const slot = await db.timeSlot.create({ data: { code: key(), label: '隔离14时', startMinutes: 840, endMinutes: 900, period: 'DAYTIME', sortOrder: 9000 } });
    await db.priceRule.create({ data: { code: randomUUID().toUpperCase(), version: 1, name: '隔离免费时段', timeSlotId: slot.id, priceCents: fee,
      effectiveFrom: new Date(Date.now() - day), enabled: true, creationIdempotencyKey: key(), creationCommandHash: 'a'.repeat(64), createdById: actor.sub } });
    let couponCode: string | undefined;
    if (withCoupon) {
      const merchant = await db.merchant.create({ data: { code: key(), name: '隔离商户', category: 'TEST', level: 'TRAFFIC_PARTNER', settlementRule: {} } });
      const template = await db.couponTemplate.create({ data: { code: key(), name: '订场抵用券', merchantId: merchant.id, activityName: '隔离测试', benefitDescription: '全额抵扣', faceValueCents: 100, allowVenueBooking: true,
        validFrom: new Date(Date.now() - day), validTo: new Date(Date.now() + 10 * day), issueLimit: 1, issuedCount: 1, claimedCount: 1 } });
      const coupon = await db.couponCode.create({ data: { code: key(), templateId: template.id, holderId: actor.sub, status: 'CLAIMED', claimedAt: new Date(), expiresAt: template.validTo } });
      couponCode = coupon.code;
    }
    const command = { date: new Date(Date.now() + 5 * day).toISOString().slice(0, 10), courtId: court.id, slotId: slot.id, couponCode, sourceChannel: 'MINI_PROGRAM' as const, creationIdempotencyKey: key() };
    const order = await venues.createBooking(command, actor);
    expect(order.payableCents).toBe(withCoupon ? 0 : fee);
    if (confirm) await orders.pay(order.id as string, { channel: order.payableCents === 0 ? 'WECHAT' : 'CASH_PRINCIPAL', idempotencyKey: key(), expectedDebitAmount: Number(order.payableCents) }, actor);
    const id = order.id as string;
    return { actor, id, command, couponCode };
  }
  const cancel = (id: string, actor: AuthUser) => orders.cancelPending(id, { reason: '取消未来免费预约', idempotencyKey: key() }, actor);
  async function expectHeld(id: string) {
    expect(await db.order.findUniqueOrThrow({ where: { id } })).toMatchObject({ status: 'PAID', cancelledAt: null });
    expect(await db.auditLog.count({ where: { objectId: id, action: 'ZERO_AMOUNT_VENUE_CANCELLED' } })).toBe(0);
  }
  it('cancels a confirmed free booking, preserves payment evidence and permits rebooking', async () => {
    const f = await book();
    await expect(venues.createBooking({ ...f.command, creationIdempotencyKey: key() }, f.actor)).rejects.toThrow();
    expect(await cancel(f.id, f.actor)).toMatchObject({ status: 'CANCELLED' });
    expect(await db.courtBooking.findFirstOrThrow({ where: { orderId: f.id } })).toMatchObject({ status: 'CANCELLED', holdExpiresAt: null });
    expect(await db.payment.findFirstOrThrow({ where: { orderId: f.id } })).toMatchObject({ status: 'SUCCEEDED', amountCents: 0 });
    expect(await db.refund.count({ where: { orderId: f.id } })).toBe(0);
    expect(await venues.createBooking({ ...f.command, creationIdempotencyKey: key() }, f.actor)).toMatchObject({ status: 'PENDING' });
    expect(provider.createJsapiPayment).not.toHaveBeenCalled();
  });
  it('serializes duplicate cancellation into one audit', async () => {
    const f = await book();
    const results = await Promise.all([cancel(f.id, f.actor), cancel(f.id, f.actor), cancel(f.id, f.actor)]);
    expect(results.every(row => row?.status === 'CANCELLED')).toBe(true);
    expect(await db.auditLog.count({ where: { objectId: f.id, action: 'ZERO_AMOUNT_VENUE_CANCELLED' } })).toBe(1);
  });
  it.each(['FRONT_DESK', 'ADMIN', 'SUPER_ADMIN'] as const)('allows %s to cancel for a member', async role => {
    const f = await book();
    expect(await cancel(f.id, await person(role))).toMatchObject({ status: 'CANCELLED' });
  });
  it.each(['MEMBER', 'FINANCE'] as const)('rejects unrelated %s', async role => {
    const f = await book();
    await expect(cancel(f.id, await person(role))).rejects.toThrow('仅会员本人');
    await expectHeld(f.id);
  });
  it.each(['started', 'checked-in', 'completed'] as const)('rejects a %s booking without releasing the court', async mode => {
    const f = await book();
    if (mode === 'started') await db.courtBooking.updateMany({ where: { orderId: f.id }, data: { startsAt: new Date(Date.now() - 60000) } });
    if (mode === 'checked-in') await db.courtBooking.updateMany({ where: { orderId: f.id }, data: { status: 'CHECKED_IN' } });
    if (mode === 'completed') await db.order.update({ where: { id: f.id }, data: { completedAt: new Date() } });
    await expect(cancel(f.id, f.actor)).rejects.toThrow('仅未开始');
    await expectHeld(f.id);
    expect(await db.courtBooking.count({ where: { orderId: f.id, status: 'CANCELLED' } })).toBe(0);
  });
  it('keeps positive payment orders on the refund path', async () => {
    const f = await book(true, false, 100);
    await expect(cancel(f.id, f.actor)).rejects.toThrow('不能直接取消');
    await expectHeld(f.id);
  });
  it('rolls back when positive payment evidence contradicts a zero order', async () => {
    const f = await book();
    await db.payment.create({ data: { paymentNo: key(), idempotencyKey: key(), orderId: f.id, userId: f.actor.sub, operatorId: f.actor.sub, channel: 'WECHAT', amountCents: 100, status: 'PROCESSING' } });
    await expect(cancel(f.id, f.actor)).rejects.toThrow('付款记录');
    await expectHeld(f.id);
    expect(await db.courtBooking.findFirstOrThrow({ where: { orderId: f.id } })).toMatchObject({ status: 'CONFIRMED' });
  });
  it.each([false, true])('restores the redeemed coupon once (expired=%s)', async expired => {
    const f = await book(true, true);
    const original = await db.couponCode.findUniqueOrThrow({ where: { code: f.couponCode } });
    expect(original).toMatchObject({ status: 'REDEEMED', attributionOrderId: f.id });
    if (expired) await db.couponCode.update({ where: { id: original.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await cancel(f.id, f.actor);
    await cancel(f.id, f.actor);
    expect(await db.couponCode.findUniqueOrThrow({ where: { id: original.id } })).toMatchObject({ status: expired ? 'EXPIRED' : 'CLAIMED', attributionOrderId: null, redeemedAt: null, redeemedById: null, redeemedMerchantId: null });
    expect(await db.couponTemplate.findUniqueOrThrow({ where: { id: original.templateId } })).toMatchObject({ redeemedCount: 0, claimedCount: 1 });
    if (!expired) expect(await venues.createBooking({ ...f.command, creationIdempotencyKey: key() }, f.actor)).toMatchObject({ payableCents: 0 });
  });
  it('rolls back cancellation if the coupon is no longer attributed to this order', async () => {
    const f = await book(true, true);
    await db.couponCode.update({ where: { code: f.couponCode }, data: { attributionOrderId: null } });
    await expect(cancel(f.id, f.actor)).rejects.toThrow('优惠券记录不一致');
    await expectHeld(f.id);
    expect(await db.courtBooking.findFirstOrThrow({ where: { orderId: f.id } })).toMatchObject({ status: 'CONFIRMED' });
  });
  it('reverses an unclaimed referral reward with the cancellation', async () => {
    const f = await book();
    const referrer = await person();
    const reward = await db.referralReward.create({ data: { referrerId: referrer.sub, newUserId: f.actor.sub, triggerOrderId: f.id, triggerType: 'VENUE', rewardType: 'POINTS', rewardValue: 100, observationEndsAt: new Date(Date.now() + day) } });
    await cancel(f.id, f.actor);
    expect(await db.referralReward.findUniqueOrThrow({ where: { id: reward.id } })).toMatchObject({ status: 'REVERSED', reversedAt: expect.any(Date) });
  });
  it('cannot both cancel and check in the same reservation concurrently', async () => {
    const f = await book();
    const admin = await person('SUPER_ADMIN');
    const outcomes = await Promise.allSettled([cancel(f.id, f.actor), venues.checkIn(f.id, admin, { overrideReason: '隔离测试提前签到' })]);
    expect(outcomes.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    const order = await db.order.findUniqueOrThrow({ where: { id: f.id } });
    const booking = await db.courtBooking.findFirstOrThrow({ where: { orderId: f.id } });
    expect(['CANCELLED', 'CHECKED_IN']).toContain(order.status);
    expect(booking.status).toBe(order.status);
  });
  it('still cancels an unconfirmed zero order', async () => {
    const f = await book(false);
    expect(await cancel(f.id, f.actor)).toMatchObject({ status: 'CANCELLED' });
    expect(await db.courtBooking.findFirstOrThrow({ where: { orderId: f.id } })).toMatchObject({ status: 'CANCELLED' });
  });
});
