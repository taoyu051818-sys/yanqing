import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PrismaService } from '../src/database/prisma.service.js';
import type { AuthUser } from '../src/common/auth/auth-user.js';
import {
  approveRefund,
  rejectRefund,
} from '../src/orders/refund-review/orders-refund-review.commands.js';
import { requestRefund } from '../src/orders/refund-requests/orders-refund-requests.commands.js';
import { finalizeRefund } from '../src/payments/wechat/refund-notification.js';
import { dispatchWechatRefund } from '../src/payments/wechat/refund-dispatch.js';
import { createOrderFinalizerService } from './support/domain-consumer-fixtures.js';

const url = process.env.TEST_DATABASE_URL;
describe.skipIf(!url)(
  'durable refund decisions and cumulative recharge recovery (PostgreSQL)',
  () => {
    let db: PrismaService;
    const config = new ConfigService({ PAYMENT_PROVIDER: 'wechat' });
    const finalizer = createOrderFinalizerService({} as never);
    const key = () => `refund-fix-${randomUUID()}`;
    beforeAll(async () => {
      const target = new URL(url!);
      if (
        !['localhost', '127.0.0.1', 'postgres'].includes(target.hostname) ||
        !target.pathname.endsWith('_test')
      )
        throw new Error('Only an explicit local *_test database is allowed');
      db = new PrismaService(new ConfigService({ DATABASE_URL: url }));
      await db.$connect();
    });
    afterAll(async () => {
      await db?.$disconnect();
    });
    async function fixture(
      kind: 'VENUE' | 'RECHARGE' = 'VENUE',
      channel: 'WECHAT' | 'OFFLINE_CASH' = 'WECHAT',
    ) {
      const member = await db.user.create({
        data: { displayName: '退款回归会员', openId: key() },
      });
      const people = await Promise.all(
        [0, 1].map(() =>
          db.user.create({
            data: { displayName: '退款回归财务', primaryRole: 'FINANCE' },
          }),
        ),
      );
      const actors = people.map(
        (p) => ({ sub: p.id, roles: ['FINANCE'] }) as AuthUser,
      );
      const amount = kind === 'RECHARGE' ? 100 : 1000;
      const court =
        kind === 'VENUE'
          ? await db.court.create({
              data: {
                code: key(),
                name: '退款回归场地',
                zone: 'EAST',
                sortOrder: 999,
              },
            })
          : null;
      const order = await db.order.create({
        data: {
          orderNo: key(),
          memberId: member.id,
          businessType: kind,
          subjectAccount: 'VENUE',
          sourceChannel: 'MINI_PROGRAM',
          status: 'PAID',
          paymentChannel: channel,
          title: '隔离退款测试',
          listAmountCents: amount,
          payableCents: amount,
          paidCents: amount,
          paidAt: new Date(),
          parameterSnapshot:
            kind === 'RECHARGE' ? { principalCents: 100, giftCents: 1 } : {},
          ...(court
            ? {
                bookings: {
                  create: {
                    courtId: court.id,
                    memberId: member.id,
                    status: 'CONFIRMED',
                    startsAt: new Date(Date.now() + 3600000),
                    endsAt: new Date(Date.now() + 7200000),
                  },
                },
              }
            : {}),
        },
      });
      await db.payment.create({
        data: {
          paymentNo: key(),
          orderId: order.id,
          userId: member.id,
          operatorId: member.id,
          channel,
          status: 'SUCCEEDED',
          amountCents: amount,
          paidAt: new Date(),
          idempotencyKey: key(),
        },
      });
      if (kind === 'RECHARGE')
        await db.account.createMany({
          data: [
            { userId: member.id, type: 'CASH_PRINCIPAL', balance: 100 },
            { userId: member.id, type: 'GIFT_BALANCE', balance: 10 }, // 9 cents belong to other purchases.
          ],
        });
      const makeRefund = (amountCents = 500) =>
        requestRefund(
          db,
          order.id,
          { amountCents, reason: '隔离退款回归', idempotencyKey: key() },
          { sub: member.id, roles: ['MEMBER'] } as AuthUser,
        );
      return { member, order, actors, makeRefund };
    }
    const deferred = () => {
      let resolve!: () => void;
      const promise = new Promise<void>((done) => {
        resolve = done;
      });
      return { promise, resolve };
    };
    const notice = (
      refund: { refundNo: string; amountCents: number },
      id: string,
      total = 1000,
    ) => ({
      out_refund_no: refund.refundNo,
      refund_id: id,
      refund_status: 'SUCCESS',
      amount: { refund: refund.amountCents, total },
    });
    it('commits approval before contacting the provider and rejects the competing rejection', async () => {
      const f = await fixture(),
        refund = await f.makeRefund();
      const entered = deferred(),
        release = deferred(),
        providerId = key();
      const provider = {
        createRefund: vi.fn(async () => {
          entered.resolve();
          await release.promise;
          return { refundId: providerId, status: 'PROCESSING' };
        }),
      };
      const approving = approveRefund(
        db,
        config,
        finalizer,
        provider as never,
        refund.id,
        { reason: '核对退款' },
        f.actors[0],
      );
      try {
        await entered.promise;
        expect(
          await db.refund.findUnique({ where: { id: refund.id } }),
        ).toMatchObject({ status: 'APPROVED', approvedById: f.actors[0].sub });
        await expect(
          rejectRefund(db, refund.id, { reason: '并发驳回' }, f.actors[1]),
        ).rejects.toThrow('已处理');
      } finally {
        release.resolve();
      }
      expect(await approving).toMatchObject({ status: 'PROCESSING' });
      const persisted = await db.refund.findUniqueOrThrow({
        where: { id: refund.id },
      });
      await finalizeRefund(db, finalizer, notice(persisted, providerId));
      expect(
        await db.refund.findUnique({ where: { id: refund.id } }),
      ).toMatchObject({ status: 'SUCCEEDED', approvedById: f.actors[0].sub });
      expect(provider.createRefund).toHaveBeenCalledOnce();
    });
    it('does not contact the provider when rejection won first', async () => {
      const f = await fixture(),
        refund = await f.makeRefund();
      await rejectRefund(db, refund.id, { reason: '先驳回' }, f.actors[1]);
      const provider = { createRefund: vi.fn() };
      await expect(
        approveRefund(
          db,
          config,
          finalizer,
          provider as never,
          refund.id,
          { reason: '后批准' },
          f.actors[0],
        ),
      ).rejects.toThrow('已处理');
      expect(provider.createRefund).not.toHaveBeenCalled();
    });
    it('only one of two concurrent reviewers can establish the approved decision', async () => {
      const f = await fixture(),
        refund = await f.makeRefund();
      const provider = {
        createRefund: vi.fn(async () => ({
          refundId: key(),
          status: 'PROCESSING',
        })),
      };
      const results = await Promise.allSettled(
        f.actors.map((actor) =>
          approveRefund(
            db,
            config,
            finalizer,
            provider as never,
            refund.id,
            { reason: '并发审批' },
            actor,
          ),
        ),
      );
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(provider.createRefund).toHaveBeenCalledOnce();
    });
    it('a rolled-back approval never emits an external refund', async () => {
      const f = await fixture(),
        refund = await f.makeRefund();
      const failing = {
        $transaction: (work: (tx: never) => Promise<unknown>) =>
          db.$transaction(async (tx) => {
            await work(tx as never);
            throw new Error('simulated commit failure');
          }),
      };
      const provider = { createRefund: vi.fn() };
      await expect(
        approveRefund(
          failing as never,
          config,
          finalizer,
          provider as never,
          refund.id,
          { reason: '事务回滚' },
          f.actors[0],
        ),
      ).rejects.toThrow('simulated commit failure');
      expect(provider.createRefund).not.toHaveBeenCalled();
      expect(
        await db.refund.findUnique({ where: { id: refund.id } }),
      ).toMatchObject({ status: 'REQUESTED', approvedById: null });
    });
    it('retries an uncertain accepted request with the same identity after a fresh dispatcher starts', async () => {
      const f = await fixture(),
        refund = await f.makeRefund();
      const providerId = key();
      const provider = {
        createRefund: vi
          .fn()
          .mockRejectedValueOnce(new Error('accepted but response lost'))
          .mockResolvedValue({ refundId: providerId, status: 'SUCCESS' }),
      };
      expect(
        await approveRefund(
          db,
          config,
          finalizer,
          provider as never,
          refund.id,
          { reason: '网络中断' },
          f.actors[0],
        ),
      ).toMatchObject({ status: 'APPROVED' });
      await expect(
        rejectRefund(
          db,
          refund.id,
          { reason: '不能撤销已批决定' },
          f.actors[1],
        ),
      ).rejects.toThrow('已处理');
      expect(
        await dispatchWechatRefund(db, provider as never, finalizer, refund.id),
      ).toMatchObject({ status: 'SUCCEEDED', approvedById: f.actors[0].sub });
      expect(provider.createRefund).toHaveBeenCalledTimes(2);
      expect(provider.createRefund.mock.calls[0]).toEqual(
        provider.createRefund.mock.calls[1],
      );
      expect(
        await db.order.findUnique({ where: { id: f.order.id } }),
      ).toMatchObject({ refundedCents: 500 });
    });
    it('a late failed provider response cannot leave an OPEN risk after a successful callback', async () => {
      const f = await fixture(),
        refund = await f.makeRefund(),
        providerId = key();
      const provider = {
        createRefund: vi.fn(async () => {
          const row = await db.refund.findUniqueOrThrow({
            where: { id: refund.id },
          });
          await finalizeRefund(db, finalizer, notice(row, providerId));
          throw new Error('response failed after callback success');
        }),
      };
      expect(
        await approveRefund(
          db,
          config,
          finalizer,
          provider as never,
          refund.id,
          { reason: '迟到失败' },
          f.actors[0],
        ),
      ).toMatchObject({ status: 'SUCCEEDED' });
      expect(
        await db.riskEvent.count({
          where: { objectId: refund.id, status: 'OPEN' },
        }),
      ).toBe(0);
    });
    it('resolves deferred risks on both query success and callback replay while preserving evidence', async () => {
      const f = await fixture(),
        refund = await f.makeRefund(),
        providerId = key();
      const provider = {
        createRefund: vi
          .fn()
          .mockRejectedValueOnce(new Error('response lost'))
          .mockResolvedValue({ refundId: providerId, status: 'PROCESSING' }),
        queryRefund: vi
          .fn()
          .mockResolvedValue({ refundId: providerId, status: 'SUCCESS' }),
      };
      await approveRefund(
        db,
        config,
        finalizer,
        provider as never,
        refund.id,
        { reason: '延期恢复' },
        f.actors[0],
      );
      const risk = await db.riskEvent.findFirstOrThrow({
        where: { objectId: refund.id },
      });
      expect(risk.status).toBe('OPEN');
      await dispatchWechatRefund(db, provider as never, finalizer, refund.id);
      await dispatchWechatRefund(db, provider as never, finalizer, refund.id);
      expect(
        await db.riskEvent.findUnique({ where: { id: risk.id } }),
      ).toMatchObject({
        status: 'RESOLVED',
        evidence: risk.evidence,
        resolvedAt: expect.any(Date),
      });
      // Repair a stale legacy observation when a success callback is replayed.
      await db.riskEvent.update({
        where: { id: risk.id },
        data: { status: 'REVIEWING', resolvedAt: null },
      });
      const row = await db.refund.findUniqueOrThrow({
        where: { id: refund.id },
      });
      await finalizeRefund(db, finalizer, notice(row, providerId));
      expect(
        await db.riskEvent.findUnique({ where: { id: risk.id } }),
      ).toMatchObject({ status: 'RESOLVED' });
      expect(
        await db.order.findUnique({ where: { id: f.order.id } }),
      ).toMatchObject({ refundedCents: 500 });
    });
    it('a success callback before the request response cannot be overwritten as PROCESSING', async () => {
      const f = await fixture(),
        refund = await f.makeRefund(),
        providerId = key();
      const provider = {
        createRefund: vi.fn(async () => {
          const row = await db.refund.findUniqueOrThrow({
            where: { id: refund.id },
          });
          await finalizeRefund(db, finalizer, notice(row, providerId));
          return { refundId: providerId, status: 'PROCESSING' };
        }),
      };
      expect(
        await approveRefund(
          db,
          config,
          finalizer,
          provider as never,
          refund.id,
          { reason: '回调先到' },
          f.actors[0],
        ),
      ).toMatchObject({ status: 'SUCCEEDED' });
    });
    it('queries an accepted refund to recover a missing success callback', async () => {
      const f = await fixture(),
        refund = await f.makeRefund(),
        providerId = key();
      const provider = {
        createRefund: vi.fn(async () => ({
          refundId: providerId,
          status: 'PROCESSING',
        })),
        queryRefund: vi.fn(async () => ({
          refundId: providerId,
          status: 'SUCCESS',
        })),
      };
      await approveRefund(
        db,
        config,
        finalizer,
        provider as never,
        refund.id,
        { reason: '查询补偿' },
        f.actors[0],
      );
      await dispatchWechatRefund(db, provider as never, finalizer, refund.id);
      await dispatchWechatRefund(db, provider as never, finalizer, refund.id);
      expect(provider.createRefund).toHaveBeenCalledOnce();
      expect(provider.queryRefund).toHaveBeenCalledOnce();
      expect(
        await db.order.findUnique({ where: { id: f.order.id } }),
      ).toMatchObject({ refundedCents: 500 });
    });
    it.each(['WECHAT', 'OFFLINE_CASH'] as const)(
      'cumulatively recovers exact gift value for %s installments',
      async (channel) => {
        for (const installments of [
          [25, 25, 25, 25],
          [50, 50],
        ]) {
          const f = await fixture('RECHARGE', channel);
          const provider = {
            createRefund: vi.fn(async () => ({
              refundId: key(),
              status: 'SUCCESS',
            })),
          };
          for (const amount of installments) {
            const refund = await f.makeRefund(amount);
            expect(
              await approveRefund(
                db,
                config,
                finalizer,
                provider as never,
                refund.id,
                { reason: '分次退款' },
                f.actors[0],
              ),
            ).toMatchObject({ status: 'SUCCEEDED' });
          }
          const accounts = await db.account.findMany({
            where: { userId: f.member.id },
          });
          expect(
            accounts.find((a) => a.type === 'CASH_PRINCIPAL')?.balance,
          ).toBe(0);
          expect(accounts.find((a) => a.type === 'GIFT_BALANCE')?.balance).toBe(
            9,
          );
          expect(
            await db.order.findUnique({ where: { id: f.order.id } }),
          ).toMatchObject({ status: 'REFUNDED', refundedCents: 100 });
        }
      },
    );
    it('keeps prior unpaid gift recovery as one debt instead of charging another recharge twice', async () => {
      const f = await fixture('RECHARGE');
      await db.account.update({
        where: { userId_type: { userId: f.member.id, type: 'GIFT_BALANCE' } },
        data: { balance: 0 },
      });
      const provider = {
        createRefund: vi.fn(async () => ({
          refundId: key(),
          status: 'SUCCESS',
        })),
      };
      const first = await f.makeRefund(50);
      await approveRefund(
        db,
        config,
        finalizer,
        provider as never,
        first.id,
        { reason: '余额不足原路退' },
        f.actors[0],
      );
      await db.account.update({
        where: { userId_type: { userId: f.member.id, type: 'GIFT_BALANCE' } },
        data: { balance: 9 },
      });
      const second = await f.makeRefund(50);
      await approveRefund(
        db,
        config,
        finalizer,
        provider as never,
        second.id,
        { reason: '剩余本金退款' },
        f.actors[0],
      );
      expect(
        (
          await db.account.findUniqueOrThrow({
            where: {
              userId_type: { userId: f.member.id, type: 'GIFT_BALANCE' },
            },
          })
        ).balance,
      ).toBe(9);
      const debts = await db.riskEvent.findMany({
        where: {
          orderId: f.order.id,
          ruleCode: 'RECHARGE_REFUND_BALANCE_SHORTFALL',
        },
      });
      expect(debts).toHaveLength(1);
      expect(debts[0].evidence).toMatchObject({ outstandingRecoveryCents: 1 });
    });
  },
);
