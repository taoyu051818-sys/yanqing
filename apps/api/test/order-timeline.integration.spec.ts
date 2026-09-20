import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/database/prisma.service.js';
import { OrderTimelineService } from '../src/orders/timeline/timeline.service.js';
import {
  TimelineQuery,
  RefundTimelineQuery,
  period,
  decodeCursor,
} from '../src/orders/timeline/query.js';
import { OrderQueryDto } from '../src/orders/orders.dto.js';
import { list } from '../src/orders/queries/orders-queries.commands.js';
import type { AuthUser } from '../src/common/auth/auth-user.js';

const url = process.env.TEST_DATABASE_URL;
describe('timeline input boundaries', () => {
  it('uses a half-open Beijing calendar day and rejects invalid/inverted dates', () => {
    expect(period({ dateFrom: '2026-09-20', dateTo: '2026-09-20' })).toEqual({
      gte: new Date('2026-09-19T16:00:00Z'),
      lt: new Date('2026-09-20T16:00:00Z'),
    });
    expect(() => period({ dateFrom: '2026-02-30' })).toThrow();
    expect(() =>
      period({ dateFrom: '2026-09-21', dateTo: '2026-09-20' }),
    ).toThrow();
    expect(() => decodeCursor('not-a-cursor')).toThrow();
  });
});
describe.skipIf(!url)(
  'order timeline, actual money and private scope (PostgreSQL)',
  () => {
    let db: PrismaService,
      service: OrderTimelineService,
      member: AuthUser,
      other: AuthUser,
      staff: AuthUser;
    const tag = 'timeline-' + randomUUID(),
      at = new Date('2012-05-02T04:00:00Z');
    let externalId: string;
    const query = (values: Partial<TimelineQuery> = {}) =>
      Object.assign(new TimelineQuery(), { keyword: tag }, values);
    beforeAll(async () => {
      const target = new URL(url!);
      if (
        !['localhost', '127.0.0.1'].includes(target.hostname) ||
        !target.pathname.endsWith('_test')
      )
        throw Error('Requires local *_test database');
      db = new PrismaService(new ConfigService({ DATABASE_URL: url }));
      await db.$connect();
      service = new OrderTimelineService(db);
      const a = await db.user.create({
          data: { displayName: tag, phone: 't-' + randomUUID() },
        }),
        b = await db.user.create({ data: { displayName: tag + '-other' } });
      member = { sub: a.id, roles: ['MEMBER'] } as AuthUser;
      other = { sub: b.id, roles: ['MEMBER'] } as AuthUser;
      staff = { sub: b.id, roles: ['ADMIN'] } as AuthUser;
      for (const channel of ['WECHAT', 'CASH_PRINCIPAL'] as const) {
        const o = await db.order.create({
          data: {
            orderNo: randomUUID(),
            memberId: a.id,
            title: tag,
            businessType: 'VENUE',
            subjectAccount: 'VENUE',
            sourceChannel: 'MINI_PROGRAM',
            listAmountCents: 6000,
            payableCents: 6000,
            paidCents: 6000,
            refundedCents: 2000,
            paymentChannel: channel,
            status: 'PARTIALLY_REFUNDED',
            parameterSnapshot: {},
            createdAt: new Date('2012-04-01T00:00:00Z'),
          },
        });
        if (channel === 'WECHAT') externalId = o.id;
        
        await db.payment.create({
          data: {
            paymentNo: randomUUID(),
            orderId: o.id,
            userId: a.id,
            operatorId: b.id,
            channel,
            amountCents: 6000,
            status: 'REFUNDED',
            paidAt: at,
            idempotencyKey: randomUUID(),
          },
        });
        await db.refund.create({
          data: {
            refundNo: randomUUID(),
            orderId: o.id,
            requestedById: a.id,
            approvedById: b.id,
            amountCents: 2000,
            reason: 'partial',
            originalOrderStatus: 'PAID',
            status: 'SUCCEEDED',
            requestedAt: new Date('2012-05-03T02:00:00Z'),
            completedAt: new Date('2012-05-03T04:00:00Z'),
          },
        });
      }
      await db.refund.create({
        data: {
          refundNo: randomUUID(),
          orderId: externalId,
          requestedById: a.id,
          amountCents: 500,
          reason: 'retry',
          originalOrderStatus: 'PARTIALLY_REFUNDED',
          status: 'FAILED',
          requestedAt: new Date('2012-05-04T04:00:00Z'),
        },
      });
      await db.payment.create({
        data: {
          paymentNo: randomUUID(),
          orderId: externalId,
          userId: a.id,
          operatorId: b.id,
          channel: 'WECHAT',
          amountCents: 9900,
          status: 'PROCESSING',
          idempotencyKey: randomUUID(),
        },
      });
      for (const userId of [a.id, b.id])
        for (const type of ['CASH_PRINCIPAL', 'BADMINTON_COIN'] as const) {
          const account = await db.account.create({ data: { userId, type } });
          for (const [kind, amount] of [
            ['CREDIT', 1000],
            ['DEBIT', -200],
            ['FREEZE', 100],
          ] as const) {
            await db.accountTransaction.create({
              data: {
                accountId: account.id,
                kind,
                amount,
                balanceBefore: 0,
                balanceAfter: 0,
                reasonCode: 'TEST',
                reason: 'isolated',
                idempotencyKey: randomUUID(),
                createdAt: at,
              },
            });
          }
        }
    });
    afterAll(async () => {
      await db?.$disconnect();
    });
    it('retains the original receipt after refund and books outgoing money on completion day', async () => {
      const receipt = await service.ledger(
        staff,
        query({ dateFrom: '2012-05-02', dateTo: '2012-05-02' }),
      );
      expect(receipt.items).toHaveLength(1);
      expect(receipt.summary).toMatchObject([
        { channel: 'WECHAT', incoming: 6000, outgoing: 0 },
      ]);
      const refund = await service.ledger(
        staff,
        query({ dateFrom: '2012-05-03', dateTo: '2012-05-03' }),
      );
      expect(refund.items).toHaveLength(1);
      expect(refund.items[0].amount).toBe(-2000);
      const all = await service.ledger(staff, query());
      expect(all.items).toHaveLength(2);
      expect(all.summary[0]).toMatchObject({ incoming: 6000, outgoing: 2000 });
    });
    it('paginates equal timestamps without duplicates and keeps whole-filter totals', async () => {
      const first = await service.ledger(
        staff,
        query({ scope: 'ACCOUNTS', pageSize: 2 }),
      );
      let page = first;
      const ids = page.items.map((x) => x.id);
      while (page.nextCursor) {
        page = await service.ledger(
          staff,
          query({ scope: 'ACCOUNTS', pageSize: 2, cursor: page.nextCursor }),
        );
        ids.push(...page.items.map((x) => x.id));
        expect(page.summary).toEqual(first.summary);
      }
      expect(ids).toHaveLength(12);
      expect(new Set(ids).size).toBe(12);
      expect(
        first.summary.find((x) => x.channel === 'CASH_PRINCIPAL'),
      ).toMatchObject({ incoming: 2000, outgoing: 400, unit: 'CNY' });
      expect(
        first.summary.find((x) => x.channel === 'BADMINTON_COIN'),
      ).toMatchObject({ incoming: 2000, outgoing: 400, unit: 'COIN' });
    });
    it('keeps member ledger private and rejects all-account access for front desk', async () => {
      const result = await service.ledger(
        member,
        query({ scope: 'ACCOUNTS' }),
        true,
      );
      expect(result.items).toHaveLength(6);
      expect(result.items.every((x) => x.memberId === member.sub)).toBe(true);
      await expect(
        service.ledger(
          { ...other, roles: ['FRONT_DESK'] },
          query({ scope: 'ACCOUNTS' }),
        ),
      ).rejects.toThrow('不能查看');
      const literal = await service.ledger(
        staff,
        query({ keyword: tag + '%' }),
      );
      expect(literal.items).toHaveLength(0);
    });
    it('finds new refund requests against old orders and separates active/history', async () => {
      const active = await service.refunds(
        Object.assign(new RefundTimelineQuery(), {
          keyword: tag,
          dateFrom: '2012-05-04',
          dateTo: '2012-05-04',
        }),
      );
      expect(active.total).toBe(1);
      expect(active.items[0].status).toBe('FAILED');
      const history = await service.refunds(
        Object.assign(new RefundTimelineQuery(), {
          keyword: tag,
          status: 'SUCCEEDED',
          pageSize: 1,
        }),
      );
      expect(history.total).toBe(2);
      expect(history.nextCursor).toBeTruthy();
      const next = await service.refunds(
        Object.assign(new RefundTimelineQuery(), {
          keyword: tag,
          status: 'SUCCEEDED',
          pageSize: 1,
          cursor: history.nextCursor,
        }),
      );
      expect(next.items[0].id).not.toBe(history.items[0].id);
      expect(next.nextCursor).toBeNull();
    });
    it('chooses future bookings by use time, and usage-date filtering differs from order date', async () => {
      const ids: string[] = [];
      const start = new Date(Date.now() + 86400000 * 3);
      start.setUTCHours(4, 0, 0, 0);
      const court = await db.court.create({
        data: {
          code: randomUUID(),
          name: 'Timeline court',
          zone: 'NORTH',
          sortOrder: 999,
        },
      });
      for (let n = 0; n < 2; n++) {
        const o = await db.order.create({
          data: {
            orderNo: randomUUID(),
            memberId: member.sub,
            title: tag,
            businessType: 'VENUE',
            subjectAccount: 'VENUE',
            sourceChannel: 'MINI_PROGRAM',
            status: 'PAID',
            listAmountCents: 100,
            payableCents: 100,
            paidCents: 100,
            parameterSnapshot: {},
            createdAt: new Date('2012-01-01T00:00:00Z'),
          },
        });
        ids.push(o.id);
        const use = new Date(+start + (1 - n) * 86400000);
        await db.courtBooking.create({
          data: {
            courtId: court.id,
            memberId: member.sub,
            orderId: o.id,
            status: 'CONFIRMED',
            startsAt: use,
            endsAt: new Date(+use + 3600000),
          },
        });
      }
      expect((await service.next(member))?.id).toBe(ids[1]);
      const day = new Date(+start + 8 * 3600000).toISOString().slice(0, 10);
      const dateQuery = Object.assign(new OrderQueryDto(), {
        dateFrom: day,
        dateTo: day,
        keyword: tag,
      });
      expect((await list(db, member, dateQuery)).total).toBe(0);
      expect(
        (
          await list(db, member, { ...dateQuery, dateBasis: 'usage' })
        ).items.map((x) => x.id),
      ).toEqual([ids[1]]);
    });
  },
);
