import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/database/prisma.service.js';
import { EventsService } from './support/events-service-fixture.js';
import { GamesService } from '../src/games/games.service.js';
import { OrdersService } from '../src/orders/orders.service.js';
import { OrderFinalizerService } from '../src/payments/order-finalizer.service.js';
import type { AuthUser } from '../src/common/auth/auth-user.js';
import type { AppRole } from '../src/generated/prisma/enums.js';

const url = process.env.TEST_DATABASE_URL;
const key = () => 'zero-cancel-' + randomUUID();
const day = 86400000;
describe.skipIf(!url)('confirmed zero-order cancellation boundaries', () => {
  let db: PrismaService, events: EventsService, games: GamesService, orders: OrdersService;
  let admin: AuthUser;
  beforeAll(async () => {
    const target = new URL(url!);
    if (!['localhost', '127.0.0.1', 'postgres'].includes(target.hostname) || !target.pathname.endsWith('_test')) throw new Error('Local database ending in _test required');
    db = new PrismaService(new ConfigService({ DATABASE_URL: url }));
    await db.$connect();
    events = new EventsService(db);
    games = new GamesService(db);
    // Real provider mode: zero confirmations must never call WeChat. Positive
    // controls pay from their synthetic local account instead.
    orders = new OrdersService(db, new ConfigService({ PAYMENT_PROVIDER: 'wechat' }), new OrderFinalizerService({} as never), {} as never);
    admin = await person('SUPER_ADMIN');
  });
  afterAll(async () => { await db?.$disconnect(); });
  async function person(role: AppRole = 'MEMBER'): Promise<AuthUser> {
    const user = await db.user.create({ data: { displayName: '隔离取消流程用户', primaryRole: role,
      memberProfile: { create: { tags: [] } }, accounts: { create: { type: 'CASH_PRINCIPAL', balance: role === 'MEMBER' ? 1000 : 0 } },
    } });
    return { sub: user.id, displayName: user.displayName, roles: [role] };
  }
  async function signup(kind: 'EVENT' | 'GAME', feeCents: number, confirm = true) {
    const buyer = await person();
    let activityId: string;
    if (kind === 'EVENT') {
      const event = await db.event.create({ data: { code: key(), name: '隔离积分赛', status: 'OPEN', rules: [],
        startsAt: new Date(Date.now() + 2 * day), registrationEndsAt: new Date(Date.now() + day),
        capacityPeople: 24, minimumPeople: 24, totalRounds: 5, feeCents,
      } });
      activityId = event.id;
      await events.register(event.id, { name: '隔离双打队', category: 'MIXED_DOUBLES', sourceChannel: 'MINI_PROGRAM', registrationMode: 'MANUAL', captainPlays: true, consent: true,
        playerAName: '测试选手甲', playerBName: '测试选手乙', playerAPhone: '13900000001', playerBPhone: '13900000002', creationIdempotencyKey: key(),
      }, buyer);
    } else {
      const host = await person('HOST');
      const game = await db.game.create({ data: { code: key(), title: '隔离球局', hostId: host.sub, level: 'BEGINNER', status: 'OPEN', capacity: 4, feeCents,
        startsAt: new Date(Date.now() + day), endsAt: new Date(Date.now() + day + 3600000),
      } });
      activityId = game.id;
      await games.register(game.id, { sourceChannel: 'MINI_PROGRAM', creationIdempotencyKey: key() }, buyer);
    }
    const order = await db.order.findFirstOrThrow({ where: { memberId: buyer.sub, businessType: kind } });
    if (confirm) await orders.pay(order.id, { channel: feeCents === 0 ? 'WECHAT' : 'CASH_PRINCIPAL', idempotencyKey: key() }, buyer);
    return { buyer, activityId, order };
  }
  it('withdraws a confirmed free event atomically and replays without a second audit', async () => {
    const f = await signup('EVENT', 0);
    const command = { reason: '隔离会员退出', idempotencyKey: key() };
    expect(await events.cancelRegistration(f.activityId, command, f.buyer)).toMatchObject({ outcome: 'CANCELLED', refund: null });
    expect(await events.cancelRegistration(f.activityId, command, f.buyer)).toMatchObject({ outcome: 'CANCELLED', idempotent: true });
    expect((await events.myRegistration(f.activityId, f.buyer))?.registration.status).toBe('CANCELLED');
    expect(await db.order.findUniqueOrThrow({ where: { id: f.order.id } })).toMatchObject({ status: 'CANCELLED', paidCents: 0, cancelledAt: expect.any(Date) });
    expect(await db.auditLog.count({ where: { action: 'ZERO_AMOUNT_ORDER_CANCELLED', objectId: f.order.id } })).toBe(1);
    expect(await db.payment.findFirstOrThrow({ where: { orderId: f.order.id } })).toMatchObject({ status: 'SUCCEEDED', amountCents: 0 });
    expect(await db.refund.count({ where: { orderId: f.order.id } })).toBe(0);
  });
  it('the same free signup can be withdrawn before confirmation (control)', async () => {
    const f = await signup('EVENT', 0, false);
    expect(await events.cancelRegistration(f.activityId, { reason: '隔离会员退出', idempotencyKey: key() }, f.buyer)).toMatchObject({ outcome: 'CANCELLED' });
    expect((await events.myRegistration(f.activityId, f.buyer))?.registration.status).toBe('CANCELLED');
    expect((await db.order.findUniqueOrThrow({ where: { id: f.order.id } })).status).toBe('CANCELLED');
  });
  it('a paid event still requests a positive refund (control)', async () => {
    const f = await signup('EVENT', 100);
    expect(await events.cancelRegistration(f.activityId, { reason: '隔离会员退出', idempotencyKey: key() }, f.buyer)).toMatchObject({ outcome: 'REFUND_REQUESTED', refund: { amountCents: 100 } });
    expect((await db.order.findUniqueOrThrow({ where: { id: f.order.id } })).status).toBe('REFUND_PENDING');
  });
  it.each(['EVENT', 'GAME'] as const)('cancels a whole free %s and its confirmed order without a refund', async kind => {
    const f = await signup(kind, 0);
    const command = { reason: '隔离整场取消', idempotencyKey: key() };
    if (kind === 'EVENT') await events.cancel(f.activityId, command, admin);
    else await games.cancel(f.activityId, command, admin);
    const entry = kind === 'EVENT'
      ? await db.eventTeam.findUniqueOrThrow({ where: { orderId: f.order.id } })
      : await db.gameRegistration.findUniqueOrThrow({ where: { orderId: f.order.id } });
    expect(entry.status).toBe('CANCELLED');
    expect(await db.order.findUniqueOrThrow({ where: { id: f.order.id } })).toMatchObject({ status: 'CANCELLED', paidCents: 0, completedAt: null, cancelledAt: expect.any(Date) });
    expect(await db.refund.count({ where: { orderId: f.order.id } })).toBe(0);
    // Replays preserve a single order cancellation and its confirmation history.
    if (kind === 'EVENT') await events.cancel(f.activityId, command, admin);
    else await games.cancel(f.activityId, command, admin);
    expect((await db.order.findUniqueOrThrow({ where: { id: f.order.id } })).status).toBe('CANCELLED');
    expect(await db.auditLog.count({ where: { action: 'ZERO_AMOUNT_ORDER_CANCELLED', objectId: f.order.id } })).toBe(1);
    expect(await db.payment.findFirstOrThrow({ where: { orderId: f.order.id } })).toMatchObject({ status: 'SUCCEEDED', amountCents: 0 });
  });
  it.each(['EVENT', 'GAME'] as const)('cancelling a paid %s retains finance review (control)', async kind => {
    const f = await signup(kind, 100);
    const command = { reason: '隔离整场取消', idempotencyKey: key() };
    if (kind === 'EVENT') await events.cancel(f.activityId, command, admin);
    else await games.cancel(f.activityId, command, admin);
    expect((await db.order.findUniqueOrThrow({ where: { id: f.order.id } })).status).toBe('REFUND_PENDING');
    expect(await db.refund.findFirstOrThrow({ where: { orderId: f.order.id } })).toMatchObject({ status: 'REQUESTED', amountCents: 100 });
  });
  it('promotes the oldest waitlisted team after a free withdrawal', async () => {
    const f = await signup('EVENT', 0);
    let waitingBuyer: AuthUser | undefined;
    for (let i = 1; i <= 12; i++) {
      const buyer = await person();
      await events.register(f.activityId, { name: `隔离候补队${i}`, category: 'MIXED_DOUBLES', sourceChannel: 'MINI_PROGRAM', registrationMode: 'MANUAL', captainPlays: true, consent: true,
        playerAName: '候补甲', playerBName: '候补乙', playerAPhone: '138' + String(i * 2).padStart(8, '0'), playerBPhone: '138' + String(i * 2 + 1).padStart(8, '0'), creationIdempotencyKey: key(),
      }, buyer);
      waitingBuyer = buyer;
    }
    const waiting = await db.eventTeam.findFirstOrThrow({ where: { eventId: f.activityId, captainId: waitingBuyer!.sub } });
    expect(waiting).toMatchObject({ status: 'WAITLISTED', orderId: null });
    const command = { reason: '释放免费名额', idempotencyKey: key() };
    await events.cancelRegistration(f.activityId, command, f.buyer);
    await events.cancelRegistration(f.activityId, command, f.buyer);
    const promoted = await db.eventTeam.findUniqueOrThrow({ where: { id: waiting.id } });
    expect(promoted).toMatchObject({ status: 'REGISTERED', orderId: expect.any(String), paymentDueAt: expect.any(Date) });
    expect(await db.order.count({ where: { memberId: waitingBuyer!.sub, businessType: 'EVENT' } })).toBe(1);
    expect(await db.eventTeam.count({ where: { eventId: f.activityId, status: { in: ['REGISTERED', 'PAID'] } } })).toBe(12);
  });

  it('reverses pending referral rewards when the free trigger order is cancelled', async () => {
    const f = await signup('EVENT', 0, false);
    const referrer = await person();
    await db.user.update({ where: { id: f.buyer.sub }, data: { referrerId: referrer.sub } });
    await orders.pay(f.order.id, { channel: 'WECHAT', idempotencyKey: key() }, f.buyer);
    expect(await db.referralReward.findFirstOrThrow({ where: { triggerOrderId: f.order.id } })).toMatchObject({ status: 'PENDING_OBSERVATION' });
    await events.cancelRegistration(f.activityId, { reason: '取消免费报名', idempotencyKey: key() }, f.buyer);
    expect(await db.referralReward.findFirstOrThrow({ where: { triggerOrderId: f.order.id } })).toMatchObject({ status: 'REVERSED', reversedAt: expect.any(Date) });
  });

  it.each(['SELF', 'EVENT', 'GAME'] as const)('rolls back %s cancellation if financial evidence contains a positive payment', async kind => {
    const f = await signup(kind === 'GAME' ? 'GAME' : 'EVENT', 0);
    // Simulate inconsistent historical payment evidence; zero order totals
    // alone must not permit closing a real money movement.
    await db.payment.updateMany({ where: { orderId: f.order.id }, data: { amountCents: 100 } });
    const command = { reason: '核对异常付款', idempotencyKey: key() };
    const result = kind === 'SELF' ? events.cancelRegistration(f.activityId, command, f.buyer)
      : kind === 'EVENT' ? events.cancel(f.activityId, command, admin) : games.cancel(f.activityId, command, admin);
    await expect(result).rejects.toThrow('付款证据已变化');
    expect((await db.order.findUniqueOrThrow({ where: { id: f.order.id } })).status).toBe('PAID');
    const entry = kind === 'GAME' ? await db.gameRegistration.findUniqueOrThrow({ where: { orderId: f.order.id } })
      : await db.eventTeam.findUniqueOrThrow({ where: { orderId: f.order.id } });
    expect(entry.status).toBe('PAID');
    expect(await db.auditLog.count({ where: { action: 'ZERO_AMOUNT_ORDER_CANCELLED', objectId: f.order.id } })).toBe(0);
  });

  it('does not classify an exhausted positive payment as a free confirmation', async () => {
    const f = await signup('EVENT', 100);
    await db.order.update({ where: { id: f.order.id }, data: { refundedCents: 100 } });
    await expect(events.cancelRegistration(f.activityId, { reason: '已无剩余金额', idempotencyKey: key() }, f.buyer)).rejects.toThrow('订单已无可退金额');
    expect(await db.auditLog.count({ where: { action: 'ZERO_AMOUNT_ORDER_CANCELLED', objectId: f.order.id } })).toBe(0);
  });

});
