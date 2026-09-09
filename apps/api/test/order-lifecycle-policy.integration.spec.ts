import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PrismaService } from '../src/database/prisma.service.js';
import {
  requireOrderTransition,
  type OrderTransition,
} from '../src/orders/order-transition.js';
import { OrdersService } from '../src/orders/orders.service.js';
import { OrderFinalizerService } from '../src/payments/order-finalizer.service.js';
import { WechatPayService } from '../src/payments/wechat-pay.service.js';
import type { AuthUser } from '../src/common/auth/auth-user.js';
import type { OrderStatus } from '../src/generated/prisma/client.js';

const url = process.env.TEST_DATABASE_URL;
const key = () => `lifecycle-${randomUUID()}`;
describe.skipIf(!url)('central order lifecycle on PostgreSQL', () => {
  let db: PrismaService;
  let member: AuthUser, finance: AuthUser;
  let orders: OrdersService, wechat: WechatPayService;
  beforeAll(async () => {
    const target = new URL(url!);
    if (
      !['127.0.0.1', 'localhost', 'postgres'].includes(target.hostname) ||
      !target.pathname.endsWith('_test')
    )
      throw new Error('Local isolated test database required');
    db = new PrismaService(new ConfigService({ DATABASE_URL: url }));
    await db.$connect();
    const buyer = await db.user.create({
      data: {
        displayName: '架构验收会员',
        accounts: { create: { type: 'CASH_PRINCIPAL', balance: 0 } },
      },
    });
    const approver = await db.user.create({
      data: { displayName: '架构验收财务', primaryRole: 'FINANCE' },
    });
    member = {
      sub: buyer.id,
      displayName: buyer.displayName,
      roles: ['MEMBER'],
    };
    finance = {
      sub: approver.id,
      displayName: approver.displayName,
      roles: ['FINANCE'],
    };
    const config = new ConfigService({ PAYMENT_PROVIDER: 'wechat' });
    const finalizer = new OrderFinalizerService({} as never);
    orders = new OrdersService(db, config, finalizer, {
      createRefund: vi
        .fn()
        .mockResolvedValue({ refundId: key(), status: 'PROCESSING' }),
    } as never);
    wechat = new WechatPayService(config, db, finalizer);
    vi.spyOn(wechat as any, 'verifyWechatSignature').mockImplementation(
      () => {},
    );
  });
  afterAll(async () => {
    await db?.$disconnect();
  });
  const newOrder = (status: OrderStatus = 'PENDING') =>
    db.order.create({
      data: {
        orderNo: key(),
        memberId: member.sub,
        businessType: 'VENUE',
        subjectAccount: 'VENUE',
        sourceChannel: 'MINI_PROGRAM',
        status,
        title: '架构隔离验收',
        listAmountCents: 1000,
        payableCents: 1000,
        parameterSnapshot: {},
      },
    });

  it.each([
    ['CANCELLED', 'PAY', 'PAID'],
    ['REFUNDED', 'PAY', 'PAID'],
    ['REFUND_PENDING', 'CHECK_IN', 'CHECKED_IN'],
    ['PAID', 'CANCEL_UNPAID', 'CANCELLED'],
    ['PENDING', 'REFUND_SUCCEEDED', 'REFUNDED'],
  ] as [OrderStatus, OrderTransition, OrderStatus][])(
    'rejects %s / %s without changing order or audit',
    async (from, event, to) => {
      const order = await newOrder(from);
      await expect(
        db.$transaction(async (tx) => {
          await tx.auditLog.create({
            data: {
              action: 'SHOULD_ROLL_BACK',
              objectType: 'Order',
              objectId: order.id,
            },
          });
          await requireOrderTransition(tx, event, {
            where: { id: order.id, status: from },
            data: { status: to },
          });
        }),
      ).rejects.toThrow('订单状态转换');
      expect(
        (await db.order.findUniqueOrThrow({ where: { id: order.id } })).status,
      ).toBe(from);
      expect(await db.auditLog.count({ where: { objectId: order.id } })).toBe(
        0,
      );
    },
  );
  it('one concurrent payment/cancellation wins and the losing transaction rolls back', async () => {
    const order = await newOrder();
    const commands = [
      ['PAY', 'PAID'],
      ['CANCEL_UNPAID', 'CANCELLED'],
    ] as const;
    const result = await Promise.allSettled(
      commands.map(([event, status]) =>
        db.$transaction(async (tx) => {
          await tx.auditLog.create({
            data: { action: event, objectType: 'Order', objectId: order.id },
          });
          await requireOrderTransition(tx, event, {
            where: { id: order.id, status: 'PENDING' },
            data: { status },
          });
        }),
      ),
    );
    expect(result.filter((row) => row.status === 'fulfilled')).toHaveLength(1);
    expect(result.filter((row) => row.status === 'rejected')).toHaveLength(1);
    const stored = await db.order.findUniqueOrThrow({
      where: { id: order.id },
    });
    const audit = await db.auditLog.findMany({ where: { objectId: order.id } });
    expect(audit).toHaveLength(1);
    expect(audit[0].action).toBe(
      stored.status === 'PAID' ? 'PAY' : 'CANCEL_UNPAID',
    );
  });

  for (const channel of ['WECHAT', 'CASH_PRINCIPAL', 'OFFLINE_CASH'] as const) {
    it.each(['CONFIRMED', 'COMPLETED', 'NO_SHOW'] as const)(
      `${channel} partial/full refund preserves %s evidence and replays once`,
      async (bookingStatus) => {
        const terminal = bookingStatus !== 'CONFIRMED';
        const completedAt = terminal ? new Date(Date.now() - 3600000) : null;
        const court = await db.court.create({
          data: {
            code: key(),
            name: '隔离验收场地',
            zone: 'EAST',
            sortOrder: 999,
          },
        });
        const order = await db.order.create({
          data: {
            orderNo: key(),
            memberId: member.sub,
            businessType: 'VENUE',
            subjectAccount: 'VENUE',
            sourceChannel: 'MINI_PROGRAM',
            status: terminal ? 'COMPLETED' : 'PAID',
            title: '跨渠道退款',
            listAmountCents: 1000,
            payableCents: 1000,
            paidCents: 1000,
            paidAt: new Date(),
            completedAt,
            parameterSnapshot: {},
            paymentChannel: channel,
            bookings: {
              create: {
                courtId: court.id,
                memberId: member.sub,
                status: bookingStatus,
                startsAt: new Date(
                  Date.now() + (terminal ? -10800000 : 86400000),
                ),
                endsAt: new Date(Date.now() + (terminal ? -7200000 : 90000000)),
                ...(terminal
                  ? {
                      fulfilledAt: completedAt,
                      fulfillmentReason: '历史履约记录',
                      fulfillmentEvidence: { legacy: true },
                    }
                  : {}),
              },
            },
            payments: {
              create: {
                paymentNo: key(),
                userId: member.sub,
                operatorId: member.sub,
                idempotencyKey: key(),
                channel,
                amountCents: 1000,
                status: 'SUCCEEDED',
                paidAt: new Date(),
              },
            },
          },
        });
        const balanceBefore = (
          await db.account.findUniqueOrThrow({
            where: {
              userId_type: { userId: member.sub, type: 'CASH_PRINCIPAL' },
            },
          })
        ).balance;
        for (const [amountCents, expectedStatus] of [
          [400, 'PARTIALLY_REFUNDED'],
          [600, 'REFUNDED'],
        ] as const) {
          const refund = await orders.requestRefund(
            order.id,
            { amountCents, reason: '跨渠道一致性验收', idempotencyKey: key() },
            member,
          );
          await orders.approveRefund(
            refund.id,
            { reason: '财务核对通过' },
            finance,
          );
          if (channel === 'WECHAT') {
            expect(
              (
                await db.courtBooking.findUniqueOrThrow({
                  where: { orderId: order.id },
                })
              ).status,
            ).toBe(bookingStatus);
            const row = await db.refund.findUniqueOrThrow({
              where: { id: refund.id },
            });
            vi.spyOn(wechat as any, 'decrypt').mockReturnValue({
              out_refund_no: row.refundNo,
              refund_id: key(),
              refund_status: 'SUCCESS',
              amount: { total: 1000, refund: amountCents },
            });
            const notice = () =>
              wechat.handleNotification(
                Buffer.from(
                  JSON.stringify({
                    event_type: 'REFUND.SUCCESS',
                    resource: {},
                  }),
                ),
                {
                  'wechatpay-timestamp': String(Math.floor(Date.now() / 1000)),
                  'wechatpay-nonce': 'local',
                  'wechatpay-signature': 'local',
                  'wechatpay-serial': 'local',
                },
              );
            await notice();
            await notice();
          } else {
            await orders.approveRefund(
              refund.id,
              { reason: '财务核对通过' },
              finance,
            );
          }
          expect(
            await db.order.findUniqueOrThrow({ where: { id: order.id } }),
          ).toMatchObject({
            status: expectedStatus,
            refundedCents: amountCents === 400 ? 400 : 1000,
            completedAt,
          });
          expect(
            (
              await db.courtBooking.findUniqueOrThrow({
                where: { orderId: order.id },
              })
            ).status,
          ).toBe(
            amountCents === 600 && !terminal ? 'CANCELLED' : bookingStatus,
          );
        }
        expect(
          (
            await db.account.findUniqueOrThrow({
              where: {
                userId_type: { userId: member.sub, type: 'CASH_PRINCIPAL' },
              },
            })
          ).balance,
        ).toBe(balanceBefore + (channel === 'CASH_PRINCIPAL' ? 1000 : 0));
        expect(
          await db.accountTransaction.count({
            where: { orderId: order.id, reasonCode: 'ORDER_REFUND' },
          }),
        ).toBe(channel === 'CASH_PRINCIPAL' ? 2 : 0);
      },
    );
  }
});
