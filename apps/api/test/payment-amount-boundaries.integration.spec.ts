import { randomUUID } from 'node:crypto';
import { BadGatewayException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaService } from '../src/database/prisma.service.js';
import { GamesService } from '../src/games/games.service.js';
import { OrdersService } from '../src/orders/orders.service.js';
import { OrderFinalizerService } from '../src/payments/order-finalizer.service.js';
import type { AuthUser } from '../src/common/auth/auth-user.js';
import type { AppRole } from '../src/generated/prisma/enums.js';

const url = process.env.TEST_DATABASE_URL;
const key = () => 'payment-amount-' + randomUUID();
describe.skipIf(!url)('zero payment and cumulative coin refund boundaries', () => {
  let db: PrismaService;
  let games: GamesService;
  let orders: OrdersService;
  let finance: AuthUser;
  const provider = {
    // Model the documented JSAPI requirement total > 0; never contact WeChat.
    createJsapiPayment: vi.fn(async ({ amountCents }: { amountCents: number }) => {
      if (amountCents <= 0) throw new BadGatewayException('微信下单：total 必须大于0');
      return { package: 'prepay_id=isolated-test' };
    }),
    closeOrder: vi.fn().mockResolvedValue({ closed: true }),
  };
  beforeAll(async () => {
    const target = new URL(url!);
    if (target.hostname !== '127.0.0.1' || (target.pathname !== '/yanqing_payment_amount_test' && !/^\/yanqing_core_amounts_[0-9a-f]{12}_test$/.test(target.pathname))) throw new Error('Dedicated local test database required');
    db = new PrismaService(new ConfigService({ DATABASE_URL: url }));
    await db.$connect();
    games = new GamesService(db);
    orders = new OrdersService(db, new ConfigService({ PAYMENT_PROVIDER: 'wechat' }), new OrderFinalizerService({} as never), provider as never);
    finance = await person('FINANCE');
    await db.systemParameter.deleteMany({ where: { key: 'badminton_coin.cent_value' } });
    await db.systemParameter.create({ data: {
      key: 'badminton_coin.cent_value', value: 100, type: 'INTEGER',
      description: '隔离退款测试：1币=100分', effectiveFrom: new Date(Date.now() - 60000),
    } });
  });
  beforeEach(async () => {
    provider.createJsapiPayment.mockClear();
    await db.systemParameter.updateMany({ where: { key: 'badminton_coin.cent_value' }, data: { value: 100 } });
  });
  afterAll(async () => { await db?.$disconnect(); });

  async function person(role: AppRole = 'MEMBER'): Promise<AuthUser> {
    const user = await db.user.create({ data: {
      displayName: '隔离支付边界用户', openId: key(), primaryRole: role,
      memberProfile: { create: { tags: [] } },
      accounts: { create: [{ type: 'CASH_PRINCIPAL', balance: 10000 }, { type: 'BADMINTON_COIN', balance: 100 }] },
    } });
    return { sub: user.id, displayName: user.displayName, roles: [role] };
  }
  async function signup(feeCents: number) {
    const host = await person('HOST');
    const buyer = await person();
    const game = await db.game.create({ data: {
      code: key(), title: '隔离测试球局', hostId: host.sub, level: 'BEGINNER', status: 'OPEN', capacity: 4,
      feeCents, startsAt: new Date(Date.now() + 86400000), endsAt: new Date(Date.now() + 90000000),
    } });
    await games.register(game.id, { sourceChannel: 'MINI_PROGRAM', creationIdempotencyKey: key() }, buyer);
    const order = await db.order.findFirstOrThrow({ where: { memberId: buyer.sub, businessType: 'GAME' } });
    return { buyer, game, order };
  }

  it('confirms a free game without a provider call and replays the same payment once', async () => {
    const { buyer, game, order } = await signup(0);
    await db.user.update({ where: { id: buyer.sub }, data: { openId: null } });
    await db.account.deleteMany({ where: { userId: buyer.sub } });
    const options = await orders.paymentOptions(order.id, buyer);
    expect(options.options).toEqual([expect.objectContaining({ channel: 'WECHAT', enabled: true, debitAmount: 0 })]);
    const command = { channel: 'WECHAT' as const, idempotencyKey: key() };
    const payment = await orders.pay(order.id, command, buyer);
    expect(await orders.pay(order.id, command, buyer)).toEqual(payment);
    expect(provider.createJsapiPayment).not.toHaveBeenCalled();
    expect(await db.order.findUniqueOrThrow({ where: { id: order.id } })).toMatchObject({ status: 'PAID', paidCents: 0 });
    expect(await db.gameRegistration.findUniqueOrThrow({ where: { gameId_userId: { gameId: game.id, userId: buyer.sub } } })).toMatchObject({ status: 'PAID' });
    expect(await db.payment.findFirstOrThrow({ where: { orderId: order.id } })).toMatchObject({ status: 'SUCCEEDED', amountCents: 0, providerTradeNo: null, providerPayload: expect.objectContaining({ provider: 'zero-amount' }) });
    expect(await db.payment.count({ where: { orderId: order.id } })).toBe(1);
    expect(await db.accountTransaction.count({ where: { orderId: order.id } })).toBe(0);
  });

  it.each(['CASH_PRINCIPAL', 'GIFT_BALANCE', 'BADMINTON_COIN'] as const)('supports old zero-order clients choosing %s without a wallet debit', async channel => {
    const { buyer, order } = await signup(0);
    await db.account.deleteMany({ where: { userId: buyer.sub } });
    await orders.pay(order.id, { channel, idempotencyKey: key(), expectedDebitAmount: 0 }, buyer);
    expect(await db.accountTransaction.count({ where: { orderId: order.id } })).toBe(0);
    expect(await db.order.findUniqueOrThrow({ where: { id: order.id } })).toMatchObject({ status: 'PAID' });
  });

  it('still rejects another member, expired reservations and stale quotes on free orders', async () => {
    const { buyer, order } = await signup(0);
    const stranger = await person();
    await expect(orders.pay(order.id, { channel: 'WECHAT', idempotencyKey: key() }, stranger)).rejects.toThrow();
    await expect(orders.pay(order.id, { channel: 'WECHAT', idempotencyKey: key(), expectedDebitAmount: 10 }, buyer)).rejects.toThrow('报价已变化');
    await db.order.update({ where: { id: order.id }, data: { createdAt: new Date(Date.now() - 86400000) } });
    expect((await orders.paymentOptions(order.id, buyer)).options[0].enabled).toBe(false);
    await expect(orders.pay(order.id, { channel: 'WECHAT', idempotencyKey: key() }, buyer)).rejects.toThrow();
    expect(await db.payment.count({ where: { orderId: order.id } })).toBe(0);
    expect(provider.createJsapiPayment).not.toHaveBeenCalled();
  });

  it('keeps positive-amount orders on real WeChat prepay', async () => {
    const { buyer, order } = await signup(100);
    await orders.pay(order.id, { channel: 'WECHAT', idempotencyKey: key() }, buyer);
    expect(await db.payment.findFirstOrThrow({ where: { orderId: order.id } })).toMatchObject({ status: 'PROCESSING', amountCents: 100 });
  });

  it('confirms free orders consistently in mock mode', async () => {
    const { buyer, game, order } = await signup(0);
    const mock = new OrdersService(db, new ConfigService({ PAYMENT_PROVIDER: 'mock' }), new OrderFinalizerService({} as never), provider as never);
    const calls = provider.createJsapiPayment.mock.calls.length;
    await mock.pay(order.id, { channel: 'WECHAT', idempotencyKey: key() }, buyer);
    expect(await db.gameRegistration.findUniqueOrThrow({ where: { gameId_userId: { gameId: game.id, userId: buyer.sub } } })).toMatchObject({ status: 'PAID' });
    expect(provider.createJsapiPayment.mock.calls).toHaveLength(calls);
  });

  it.each([
    { price: 300, parts: [50, 50, 200], originalCoins: 3, returnedCoins: 3 },
    { price: 100, parts: [33, 33, 34], originalCoins: 1, returnedCoins: 1 },
    { price: 300, parts: [300], originalCoins: 3, returnedCoins: 3 },
  ])('refunds $parts cents against $price cents conserve the original $originalCoins coins', async ({ price, parts, originalCoins, returnedCoins }) => {
    const { buyer, order } = await signup(price);
    await orders.pay(order.id, { channel: 'BADMINTON_COIN', idempotencyKey: key() }, buyer);
    const debit = await db.accountTransaction.findFirstOrThrow({ where: { orderId: order.id, reasonCode: 'ORDER_PAYMENT' } });
    expect(debit.amount).toBe(-originalCoins);
    for (const amountCents of parts) {
      const refund = await orders.requestRefund(order.id, { amountCents, reason: '隔离分次退款', idempotencyKey: key() }, buyer);
      await orders.approveRefund(refund.id, { reason: '隔离财务确认' }, finance);
      await orders.approveRefund(refund.id, { reason: '重复确认' }, finance);
    }
    const ledger = await db.accountTransaction.aggregate({ where: { orderId: order.id, reasonCode: 'ORDER_REFUND' }, _sum: { amount: true } });
    expect(ledger._sum.amount).toBe(returnedCoins);
    expect(await db.account.findUniqueOrThrow({ where: { userId_type: { userId: buyer.sub, type: 'BADMINTON_COIN' } } })).toMatchObject({ balance: 100 - originalCoins + returnedCoins });
    expect(await db.order.findUniqueOrThrow({ where: { id: order.id } })).toMatchObject({ status: 'REFUNDED', refundedCents: price });
  });

  it('conserves coins with the shipped 10-cent-per-coin configuration', async () => {
    await db.systemParameter.updateMany({ where: { key: 'badminton_coin.cent_value' }, data: { value: 10 } });
    const { buyer, order } = await signup(1050);
    await db.account.update({ where: { userId_type: { userId: buyer.sub, type: 'BADMINTON_COIN' } }, data: { balance: 200 } });
    await orders.pay(order.id, { channel: 'BADMINTON_COIN', idempotencyKey: key() }, buyer);
    for (let i = 0; i < 2; i++) {
      const refund = await orders.requestRefund(order.id, { amountCents: 525, reason: '隔离分次退款', idempotencyKey: key() }, buyer);
      await orders.approveRefund(refund.id, { reason: '隔离财务确认' }, finance);
      await orders.approveRefund(refund.id, { reason: '重复确认' }, finance);
    }
    expect((await db.accountTransaction.aggregate({ where: { orderId: order.id, reasonCode: 'ORDER_PAYMENT' }, _sum: { amount: true } }))._sum.amount).toBe(-105);
    expect((await db.accountTransaction.aggregate({ where: { orderId: order.id, reasonCode: 'ORDER_REFUND' }, _sum: { amount: true } }))._sum.amount).toBe(105);
  });
  it('uses actual earlier refunds when completing a legacy under-rounded refund', async () => {
    const { buyer, order } = await signup(100);
    await orders.pay(order.id, { channel: 'BADMINTON_COIN', idempotencyKey: key() }, buyer);
    const first = await orders.requestRefund(order.id, { amountCents: 66, reason: '旧规则部分退款', idempotencyKey: key() }, buyer);
    await orders.approveRefund(first.id, { reason: '财务确认' }, finance);
    // Model two old 33-cent installments that returned zero coins in total.
    await db.accountTransaction.updateMany({ where: { orderId: order.id, reasonCode: 'ORDER_REFUND' }, data: { amount: 0, balanceAfter: 99 } });
    await db.account.update({ where: { userId_type: { userId: buyer.sub, type: 'BADMINTON_COIN' } }, data: { balance: 99 } });
    const last = await orders.requestRefund(order.id, { amountCents: 34, reason: '完成退款', idempotencyKey: key() }, buyer);
    await orders.approveRefund(last.id, { reason: '财务确认' }, finance);
    expect((await db.account.findUniqueOrThrow({ where: { userId_type: { userId: buyer.sub, type: 'BADMINTON_COIN' } } })).balance).toBe(100);
    expect((await db.accountTransaction.aggregate({ where: { orderId: order.id, reasonCode: 'ORDER_REFUND' }, _sum: { amount: true } }))._sum.amount).toBe(1);
  });

  it('fails closed when the original coin debit is missing', async () => {
    const { buyer, order } = await signup(100);
    await orders.pay(order.id, { channel: 'BADMINTON_COIN', idempotencyKey: key() }, buyer);
    await db.accountTransaction.deleteMany({ where: { orderId: order.id, reasonCode: 'ORDER_PAYMENT' } });
    const refund = await orders.requestRefund(order.id, { amountCents: 100, reason: '核对扣币', idempotencyKey: key() }, buyer);
    await expect(orders.approveRefund(refund.id, { reason: '财务确认' }, finance)).rejects.toThrow('原支付扣币流水');
    expect((await db.refund.findUniqueOrThrow({ where: { id: refund.id } })).status).toBe('REQUESTED');
    expect((await db.account.findUniqueOrThrow({ where: { userId_type: { userId: buyer.sub, type: 'BADMINTON_COIN' } } })).balance).toBe(99);
  });

  it('returns cash-balance installments in exact cents', async () => {
    const { buyer, order } = await signup(101);
    await orders.pay(order.id, { channel: 'CASH_PRINCIPAL', idempotencyKey: key() }, buyer);
    for (const amountCents of [33, 33, 35]) {
      const refund = await orders.requestRefund(order.id, { amountCents, reason: '余额分次退款', idempotencyKey: key() }, buyer);
      await orders.approveRefund(refund.id, { reason: '财务确认' }, finance);
    }
    expect((await db.account.findUniqueOrThrow({ where: { userId_type: { userId: buyer.sub, type: 'CASH_PRINCIPAL' } } })).balance).toBe(10000);
  });

});
