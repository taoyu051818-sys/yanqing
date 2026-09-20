import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { GameCancellationService } from '../src/games/cancellation/games-cancellation.service.js';
import { EventCancellationService } from '../src/events/catalog/event-cancellation.service.js';
import { ActivityRefundExecutionService } from '../src/orders/refund-review/activity-refund-execution.service.js';
import { OrderRefundReviewService } from '../src/orders/refund-review/orders-refund-review.service.js';
import { requestRefund } from '../src/orders/refund-requests/orders-refund-requests.commands.js';
import type { AuthUser } from '../src/common/auth/auth-user.js';
import {
  actor,
  connection,
  database,
  failAudit,
  key,
  paidActivity,
  refundService,
} from './support/admin-hardening-db.js';

const prisma = database(),
  contender = database();
const created: string[] = [];
afterEach(async () => {
  if (connection && created.length)
    await prisma.activityRefundJob.deleteMany({
      where: { activityId: { in: created.splice(0) } },
    });
});
afterAll(async () => {
  await Promise.all([prisma.$disconnect(), contender.$disconnect()]);
});
const worker = (db = prisma, refunds = refundService(db)) =>
  new ActivityRefundExecutionService(db, refunds);
const cancel = (
  type: 'GAME' | 'EVENT',
  id: string,
  user: AuthUser,
  db = prisma,
) =>
  type === 'GAME'
    ? new GameCancellationService(db).cancel(
        id,
        { reason: '测试场馆停用', idempotencyKey: key('cancel') },
        user,
      )
    : new EventCancellationService(db).cancel(
        id,
        { reason: '测试场馆停用', idempotencyKey: key('cancel') },
        user,
      );
const job = (kind: 'GAME' | 'EVENT', activityId: string) =>
  prisma.activityRefundJob.findUniqueOrThrow({
    where: { kind_activityId: { kind, activityId } },
  });
async function setup(
  type: 'GAME' | 'EVENT',
  role: 'ADMIN' | 'SUPER_ADMIN' | 'HOST' | 'EVENT_MANAGER' = 'ADMIN',
) {
  const manager = await actor(prisma, role),
    activity = await paidActivity(prisma, type, manager);
  created.push(activity.id);
  return { manager, ...activity };
}

describe.skipIf(!connection)(
  'Durable activity refunds with real cancellation and refund commands',
  () => {
    for (const type of ['GAME', 'EVENT'] as const) {
      it.each(['ADMIN', 'SUPER_ADMIN'] as const)(
        `${type}: %s cancellation survives request completion and a new worker finishes all refunds exactly once`,
        async (role) => {
          const activity = await setup(type, role);
          // Includes a member's pre-existing partial request; both obligations must be covered.
          await requestRefund(
            prisma,
            activity.order.id,
            {
              amountCents: 1000,
              reason: '会员部分退款',
              idempotencyKey: key('partial'),
            },
            activity.member,
          );
          await cancel(type, activity.id, activity.manager);
          expect(await job(type, activity.id)).toMatchObject({
            status: 'QUEUED',
            actorId: activity.manager.sub,
            actorRoles: [role],
          });
          const requested = await prisma.refund.findMany({
            where: { orderId: activity.order.id },
          });
          expect(requested).toHaveLength(2);
          expect(
            requested.every(
              (refund) =>
                refund.status === 'REQUESTED' && refund.cancellationRequired,
            ),
          ).toBe(true);
          const first = worker();
          expect(await first.sweep()).toBe(1);
          await first.onModuleDestroy();
          expect(await job(type, activity.id)).toMatchObject({
            status: 'COMPLETED',
            leaseToken: null,
          });
          expect(
            await prisma.order.findUniqueOrThrow({
              where: { id: activity.order.id },
            }),
          ).toMatchObject({ status: 'REFUNDED', refundedCents: 6800 });
          const restarted = worker(contender);
          expect(await restarted.sweep()).toBe(0);
          await restarted.onModuleDestroy();
          expect(
            await prisma.auditLog.count({
              where: {
                objectType: 'Refund',
                objectId: { in: requested.map((refund) => refund.id) },
                action: 'REFUND_APPROVED',
              },
            }),
          ).toBe(2);
        },
      );

      it(`${type}: cancellation audit failure rolls back the activity, refund requests and job together`, async () => {
        const activity = await setup(type);
        await expect(
          cancel(
            type,
            activity.id,
            activity.manager,
            failAudit(prisma, `${type}_CANCELLED`),
          ),
        ).rejects.toThrow('Injected final audit failure');
        expect(
          await prisma.activityRefundJob.count({
            where: { activityId: activity.id },
          }),
        ).toBe(0);
        expect(
          await prisma.refund.count({ where: { orderId: activity.order.id } }),
        ).toBe(0);
        expect(
          await prisma.order.findUniqueOrThrow({
            where: { id: activity.order.id },
          }),
        ).toMatchObject({ status: 'PAID', refundedCents: 0 });
        const current =
          type === 'GAME'
            ? await prisma.game.findUniqueOrThrow({
                where: { id: activity.id },
              })
            : await prisma.event.findUniqueOrThrow({
                where: { id: activity.id },
              });
        expect(current.status).not.toBe('CANCELLED');
      });

      it(`${type}: ordinary managers still create refund applications without automatic execution`, async () => {
        const activity = await setup(
          type,
          type === 'GAME' ? 'HOST' : 'EVENT_MANAGER',
        );
        await cancel(type, activity.id, activity.manager);
        expect(
          await prisma.activityRefundJob.count({
            where: { activityId: activity.id },
          }),
        ).toBe(0);
        expect(
          await prisma.refund.findFirstOrThrow({
            where: { orderId: activity.order.id },
          }),
        ).toMatchObject({ status: 'REQUESTED', cancellationRequired: true });
      });
    }

    it('a committed partial batch survives loss of the worker; retry uses pending rows only and ignores unrelated orders', async () => {
      const activity = await setup('GAME'),
        unrelated = await setup('EVENT');
      await requestRefund(
        prisma,
        activity.order.id,
        {
          amountCents: 1000,
          reason: '部分退费',
          idempotencyKey: key('partial'),
        },
        activity.member,
      );
      await cancel('GAME', activity.id, activity.manager);
      const real = refundService(prisma);
      let attempts = 0;
      const interrupted = {
        approveRefund: (
          ...args: Parameters<OrderRefundReviewService['approveRefund']>
        ) => {
          if (++attempts === 2)
            return Promise.reject(new Error('Simulated process interruption'));
          return real.approveRefund(...args);
        },
      } as OrderRefundReviewService;
      const first = worker(prisma, interrupted);
      await first.sweep();
      await first.onModuleDestroy();
      const pending = await job('GAME', activity.id);
      expect(pending.status).toBe('QUEUED');
      expect(pending.lastError).toContain('1笔退款');
      expect(pending.nextAttemptAt.getTime()).toBeGreaterThan(Date.now());
      expect(
        await prisma.refund.count({
          where: { orderId: activity.order.id, status: 'SUCCEEDED' },
        }),
      ).toBe(1);
      await prisma.activityRefundJob.update({
        where: { id: pending.id },
        data: { nextAttemptAt: new Date(0) },
      });
      const restarted = worker(contender);
      await restarted.sweep();
      await restarted.onModuleDestroy();
      expect(await job('GAME', activity.id)).toMatchObject({
        status: 'COMPLETED',
        attempts: 2,
      });
      expect(
        await prisma.order.findUniqueOrThrow({
          where: { id: activity.order.id },
        }),
      ).toMatchObject({ refundedCents: 6800, status: 'REFUNDED' });
      expect(
        await prisma.order.findUniqueOrThrow({
          where: { id: unrelated.order.id },
        }),
      ).toMatchObject({ refundedCents: 0, status: 'PAID' });
    });

    it('expired leases are recovered while an unexpired lease excludes other workers', async () => {
      const activity = await setup('GAME');
      await cancel('GAME', activity.id, activity.manager);
      const pending = await job('GAME', activity.id);
      await prisma.activityRefundJob.update({
        where: { id: pending.id },
        data: {
          status: 'RUNNING',
          leaseToken: 'terminated-process',
          leaseExpiresAt: new Date(Date.now() + 60000),
        },
      });
      const restarted = worker(contender);
      expect(await restarted.sweep()).toBe(0);
      await prisma.activityRefundJob.update({
        where: { id: pending.id },
        data: { leaseExpiresAt: new Date(0) },
      });
      expect(await restarted.sweep()).toBe(1);
      expect(await job('GAME', activity.id)).toMatchObject({
        status: 'COMPLETED',
      });
      await restarted.onModuleDestroy();
    });

    it('two independent worker connections cannot double-dispatch a job', async () => {
      const activity = await setup('EVENT');
      await cancel('EVENT', activity.id, activity.manager);
      const first = worker(),
        second = worker(contender);
      const claimed = await Promise.all([first.sweep(), second.sweep()]);
      expect(claimed.reduce((sum, count) => sum + count, 0)).toBe(1);
      expect(await job('EVENT', activity.id)).toMatchObject({
        status: 'COMPLETED',
        attempts: 1,
      });
      const refund = await prisma.refund.findFirstOrThrow({
        where: { orderId: activity.order.id },
      });
      expect(
        await prisma.auditLog.count({
          where: { objectId: refund.id, action: 'REFUND_APPROVED' },
        }),
      ).toBe(1);
      await Promise.all([first.onModuleDestroy(), second.onModuleDestroy()]);
    });
  },
);
