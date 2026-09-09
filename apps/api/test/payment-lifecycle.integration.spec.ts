import { finalizeRefund } from '../src/payments/wechat/refund-notification.js';
import { createOrderFinalizerService } from './support/domain-consumer-fixtures.js';
import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PrismaService } from '../src/database/prisma.service.js';
import { OrdersService } from './support/orders-fixture.js';

import { WechatPayService } from '../src/payments/wechat-pay.service.js';

// Explicitly opt in to an isolated PostgreSQL database; never use DATABASE_URL.
const url = process.env.TEST_DATABASE_URL;
describe.skipIf(!url)('payment lifecycle on PostgreSQL', () => {
  let db: PrismaService;
  const config = new ConfigService({ PAYMENT_PROVIDER: 'wechat' });
  const provider = {
    createJsapiPayment: vi
      .fn()
      .mockResolvedValue({ package: 'prepay_id=test' }),
    closeOrder: vi.fn().mockResolvedValue({ closed: true }),
    createRefund: vi
      .fn()
      .mockResolvedValue({ refundId: 'TEST-REFUND', status: 'PROCESSING' }),
  };
  const finalizer = createOrderFinalizerService({} as never);
  const unique = () => 'integration-' + randomUUID();
  beforeAll(async () => {
    const target = new URL(url!);
    if (
      !['localhost', '127.0.0.1', 'postgres'].includes(target.hostname) ||
      !target.pathname.endsWith('_test')
    )
      throw new Error(
        'TEST_DATABASE_URL must point to a local database ending in _test',
      );
    db = new PrismaService(new ConfigService({ DATABASE_URL: url }));
    await db.$connect();
  });
  afterAll(async () => {
    if (db) await db.$disconnect();
  });
  async function fixture(kind: 'VENUE' | 'RECHARGE' = 'VENUE') {
    const member = await db.user.create({
      data: { displayName: '隔离支付测试会员', openId: unique() },
    });
    const finance = await db.user.create({
      data: { displayName: '隔离支付测试财务', primaryRole: 'FINANCE' },
    });
    const court = await db.court.create({
      data: {
        code: unique(),
        name: '隔离测试场地',
        zone: 'EAST',
        sortOrder: 999,
      },
    });
    const order = await db.order.create({
      data: {
        orderNo: unique(),
        memberId: member.id,
        businessType: kind,
        subjectAccount: 'VENUE',
        sourceChannel: 'MINI_PROGRAM',
        title: '隔离支付测试',
        listAmountCents: 8800,
        payableCents: 8800,
        parameterSnapshot: {},
        ...(kind === 'VENUE'
          ? {
              bookings: {
                create: {
                  courtId: court.id,
                  memberId: member.id,
                  startsAt: new Date(Date.now() + 3600000),
                  endsAt: new Date(Date.now() + 7200000),
                  holdExpiresAt: new Date(Date.now() + 600000),
                },
              },
            }
          : {}),
      },
    });
    const actor = {
      sub: member.id,
      displayName: member.displayName,
      roles: ['MEMBER'],
    } as const;
    const service = new OrdersService(db, config, finalizer, provider as never);
    return { member, finance, order, actor: actor as never, service };
  }
  it('rejects cancellation when prepay commits between its two reads, then safely retries', async () => {
    const f = await fixture();
    let signalRead!: () => void, resume!: () => void;
    const read = new Promise<void>((resolve) => {
        signalRead = resolve;
      }),
      gate = new Promise<void>((resolve) => {
        resume = resolve;
      });
    const cancellationDb = {
      order: {
        findUnique: async (args: any) => {
          const snapshot = await db.order.findUnique(args);
          signalRead();
          await gate;
          return snapshot;
        },
      },
      $transaction: db.$transaction.bind(db),
    };
    const cancelling = new OrdersService(
      cancellationDb as never,
      config,
      finalizer,
      provider as never,
    );
    const request = cancelling.cancelPending(
      f.order.id,
      { idempotencyKey: unique() },
      f.actor,
    );
    await read;
    try {
      await f.service.pay(
        f.order.id,
        { channel: 'WECHAT', idempotencyKey: unique() } as never,
        f.actor,
      );
    } finally {
      resume();
    }
    await expect(request).rejects.toThrow('微信支付请求已变化');
    expect(
      (await db.order.findUniqueOrThrow({ where: { id: f.order.id } })).status,
    ).toBe('PENDING');
    expect(
      (
        await db.courtBooking.findUniqueOrThrow({
          where: { orderId: f.order.id },
        })
      ).status,
    ).toBe('HELD');
    await f.service.cancelPending(
      f.order.id,
      { idempotencyKey: unique() },
      f.actor,
    );
    expect(provider.closeOrder).toHaveBeenCalledWith(f.order.orderNo);
    expect(
      (
        await db.courtBooking.findUniqueOrThrow({
          where: { orderId: f.order.id },
        })
      ).status,
    ).toBe('CANCELLED');
    const externalCalls = provider.createJsapiPayment.mock.calls.length;
    await expect(
      f.service.pay(
        f.order.id,
        { channel: 'WECHAT', idempotencyKey: unique() } as never,
        f.actor,
      ),
    ).rejects.toThrow('不可支付');
    expect(provider.createJsapiPayment).toHaveBeenCalledTimes(externalCalls);
  });
  it('persists late recharge payment and its refund without touching the previous balance', async () => {
    const f = await fixture('RECHARGE');
    const account = await db.account.create({
      data: { userId: f.member.id, type: 'CASH_PRINCIPAL', balance: 5000 },
    });
    await f.service.pay(
      f.order.id,
      { channel: 'WECHAT', idempotencyKey: unique() } as never,
      f.actor,
    );
    await f.service.cancelPending(
      f.order.id,
      { idempotencyKey: unique() },
      f.actor,
    );
    const wechat = new WechatPayService(config, db, finalizer);
    vi.spyOn(wechat as any, 'verifyWechatSignature').mockImplementation(
      () => {},
    );
    vi.spyOn(wechat as any, 'decrypt').mockReturnValue({
      out_trade_no: f.order.orderNo,
      transaction_id: unique(),
      trade_state: 'SUCCESS',
      amount: { total: 8800 },
    });
    const notice = Buffer.from(
      JSON.stringify({ event_type: 'TRANSACTION.SUCCESS', resource: {} }),
    );
    const headers = {
      'wechatpay-timestamp': String(Math.floor(Date.now() / 1000)),
      'wechatpay-nonce': 'test',
      'wechatpay-signature': 'test',
      'wechatpay-serial': 'test',
    };
    await wechat.handleNotification(notice, headers);
    await wechat.handleNotification(notice, headers);
    const refunds = await db.refund.findMany({
      where: { orderId: f.order.id },
    });
    expect(refunds).toHaveLength(1);
    expect(refunds[0].compensationOnly).toBe(true);
    expect(
      await db.order.findUniqueOrThrow({ where: { id: f.order.id } }),
    ).toMatchObject({ status: 'REFUND_PENDING', paidCents: 8800 });
    expect(await db.riskEvent.count({ where: { orderId: f.order.id } })).toBe(
      1,
    );
    const finance = {
      sub: f.finance.id,
      displayName: f.finance.displayName,
      roles: ['FINANCE'],
    } as never;
    await expect(
      f.service.rejectRefund(refunds[0].id, { reason: '不应允许' }, finance),
    ).rejects.toThrow('强制退款不可驳回');
    await f.service.approveRefund(
      refunds[0].id,
      { reason: '核对迟到付款' },
      finance,
    );
    const completion = {
      out_refund_no: refunds[0].refundNo,
      refund_id: unique(),
      refund_status: 'SUCCESS',
      amount: { refund: 8800, total: 8800 },
    };
    await finalizeRefund(db, finalizer, completion);
    await finalizeRefund(db, finalizer, completion);
    expect(
      await db.order.findUniqueOrThrow({ where: { id: f.order.id } }),
    ).toMatchObject({ status: 'REFUNDED', refundedCents: 8800 });
    expect(
      (await db.account.findUniqueOrThrow({ where: { id: account.id } }))
        .balance,
    ).toBe(5000);
    expect(
      await db.accountTransaction.count({ where: { accountId: account.id } }),
    ).toBe(0);
  });
});
