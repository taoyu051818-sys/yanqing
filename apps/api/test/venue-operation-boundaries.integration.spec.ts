import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { PrismaService } from '../src/database/prisma.service.js';
import { VenuesService } from '../src/venues/venues.service.js';
import { OrdersService } from '../src/orders/orders.service.js';
import { OrderFinalizerService } from '../src/payments/order-finalizer.service.js';
import { ConsignmentSettlementService } from '../src/inventory/consignment-settlement.service.js';
import { GovernanceService } from '../src/governance/governance.service.js';
import { WorkItemsService } from '../src/work-items/work-items.service.js';
import { TrainingService } from './support/training-service-fixture.js';
import { GamesService } from '../src/games/games.service.js';
import { YouthTrainingRulesService } from '../src/training/youth-training-rules.service.js';
import type { AuthUser } from '../src/common/auth/auth-user.js';
import type { AppRole } from '../src/generated/prisma/client.js';
const url = process.env.TEST_DATABASE_URL,
  key = () => randomUUID(),
  day = 86400000;
const capture = <T>(p: Promise<T>) =>
  p.then(
    (value) => ({ value, error: undefined }),
    (error) => ({ value: undefined, error }),
  );
const latch = () => {
  let signal!: () => void;
  const promise = new Promise<void>((r) => (signal = r));
  return { promise, signal };
};
describe.skipIf(!url)(
  'venue and operation boundaries on real PostgreSQL',
  () => {
    let db: PrismaService,
      venues: VenuesService,
      orders: OrdersService,
      youth: YouthTrainingRulesService,
      admin: AuthUser,
      superAdmin: AuthUser;
    beforeAll(async () => {
      const u = new URL(url!);
      if (
        !['localhost', '127.0.0.1'].includes(u.hostname) ||
        !u.pathname.endsWith('_test')
      )
        throw new Error('Local test database required');
      db = new PrismaService(new ConfigService({ DATABASE_URL: url }));
      await db.$connect();
      venues = new VenuesService(db);
      youth = new YouthTrainingRulesService(db);
      orders = new OrdersService(
        db,
        new ConfigService({ PAYMENT_PROVIDER: 'wechat' }),
        new OrderFinalizerService(new ConsignmentSettlementService(db)),
        {} as never,
      );
      admin = await person('ADMIN');
      superAdmin = await person('SUPER_ADMIN');
    });
    afterAll(async () => {
      if (db) await db.$disconnect();
    });
    async function person(role: AppRole = 'MEMBER'): Promise<AuthUser> {
      const u = await db.user.create({
        data: {
          displayName: '第九轮隔离用户',
          primaryRole: role,
          memberProfile: { create: { tags: [] } },
          accounts: { create: { type: 'CASH_PRINCIPAL', balance: 100000 } },
        },
      });
      return { sub: u.id, displayName: u.displayName, roles: [role] };
    }
    async function fixture() {
      const buyer = await person();
      const court = await db.court.create({
        data: {
          code: key(),
          name: '第九轮隔离球场',
          zone: 'EAST',
          usage: 'RETAIL',
          sortOrder: 99,
        },
      });
      const slot = await db.timeSlot.create({
        data: {
          code: key(),
          label: '18:00-19:00',
          startMinutes: 1080,
          endMinutes: 1140,
          period: 'PRIME',
          sortOrder: 99,
        },
      });
      const date = new Date(Date.now() + 8 * 3600000 + day)
        .toISOString()
        .slice(0, 10);
      const dto = {
        date,
        courtId: court.id,
        slotId: slot.id,
        sourceChannel: 'MINI_PROGRAM' as const,
        creationIdempotencyKey: key(),
      };
      return { buyer, court, slot, date, dto };
    }
    async function price(
      slotId: string,
      from: string,
      to?: string,
      amount = 5000,
    ) {
      const r = await venues.createPriceRule(
        {
          code: 'R' + key().replaceAll('-', '').toUpperCase(),
          name: '隔离价格规则',
          timeSlotId: slotId,
          weekdayMask: 127,
          priceCents: amount,
          effectiveFrom: from,
          effectiveTo: to,
          reason: '验证有效窗口',
          idempotencyKey: key(),
        },
        admin,
      );
      await venues.setPriceRuleStatus(
        r.id,
        { enabled: true, reason: '核定价格启用', idempotencyKey: key() },
        admin,
      );
      return r;
    }
    for (const change of [
      { enabled: false },
      { usage: 'MAINTENANCE' as const },
      { usage: 'TRAINING' as const },
    ]) {
      it(`sequential court change blocks booking ${JSON.stringify(change)}`, async () => {
        const f = await fixture();
        await price(f.slot.id, '2026-01-01T00:00:00+08:00');
        await venues.updateCourt(f.court.id, change, admin);
        expect(
          (await capture(venues.createBooking(f.dto, f.buyer))).error,
        ).toBeDefined();
        expect(
          await db.courtBooking.count({ where: { courtId: f.court.id } }),
        ).toBe(0);
      });
      it(`stale court read rejects booking after committed change ${JSON.stringify(change)}`, async () => {
        const f = await fixture();
        await price(f.slot.id, '2026-01-01T00:00:00+08:00');
        const read = latch(),
          resume = latch();
        const gated = db.$extends({
          query: {
            court: {
              findUnique: async ({ args, query }) => {
                const row = await query(args);
                if (args.where.id === f.court.id) {
                  read.signal();
                  await resume.promise;
                }
                return row;
              },
            },
          },
        });
        const pending = capture(
          new VenuesService(gated as never).createBooking(f.dto, f.buyer),
        );
        await read.promise;
        try {
          await venues.updateCourt(f.court.id, change, admin);
        } finally {
          resume.signal();
        }
        const result = await pending;
        expect(result.error).toMatchObject({ status: 409 });
        expect(
          await db.courtBooking.count({ where: { courtId: f.court.id } }),
        ).toBe(0);
        expect(
          await db.court.findUniqueOrThrow({ where: { id: f.court.id } }),
        ).toMatchObject(change);
      });
    }
    it('midnight rule rollover selects the new version', async () => {
      const f = await fixture();
      await price(
        f.slot.id,
        '2026-01-01T00:00:00+08:00',
        f.date + 'T00:00:00+08:00',
        5000,
      );
      const current = await price(
        f.slot.id,
        f.date + 'T00:00:00+08:00',
        undefined,
        8000,
      );
      const o = await venues.createBooking(f.dto, f.buyer);
      expect(o.payableCents).toBe(8000);
      expect(
        (await db.order.findUniqueOrThrow({ where: { id: o.id } }))
          .parameterSnapshot,
      ).toMatchObject({ priceRuleId: current.id });
    });
    it('noon price rollover charges the new price for an evening slot', async () => {
      const f = await fixture();
      const old = await price(
        f.slot.id,
        '2026-01-01T00:00:00+08:00',
        f.date + 'T12:00:00+08:00',
        5000,
      );
      const current = await price(
        f.slot.id,
        f.date + 'T12:00:00+08:00',
        undefined,
        8000,
      );
      const availability = await venues.availability(f.date);
      expect(
        availability.slots.find((s) => s.id === f.slot.id)?.price?.priceCents,
      ).toBe(8000);
      const o = await venues.createBooking(f.dto, f.buyer);
      expect(o.payableCents).toBe(8000);
      await orders.pay(
        o.id,
        { channel: 'CASH_PRINCIPAL', idempotencyKey: key() },
        f.buyer,
      );
      const stored = await db.order.findUniqueOrThrow({ where: { id: o.id } }),
        booking = await db.courtBooking.findFirstOrThrow({
          where: { orderId: o.id },
        });
      expect(stored.status).toBe('PAID');
      expect(stored.parameterSnapshot).toMatchObject({
        priceRuleId: current.id,
      });
      expect(+booking.startsAt).toBeGreaterThan(
        +new Date(current.effectiveFrom),
      );
      expect(+booking.startsAt).toBeGreaterThan(+new Date(old.effectiveTo!));
    });
    it('noon-only new rule is available for its first evening', async () => {
      const f = await fixture();
      await price(f.slot.id, f.date + 'T12:00:00+08:00', undefined, 8000);
      expect(
        (await venues.availability(f.date)).slots.find(
          (s) => s.id === f.slot.id,
        )?.price,
      ).toMatchObject({ priceCents: 8000 });
      await expect(venues.createBooking(f.dto, f.buyer)).resolves.toMatchObject(
        { payableCents: 8000 },
      );
    });
    it('court closure blocks a booking even after the court preflight read', async () => {
      const f = await fixture();
      await price(f.slot.id, '2026-01-01T00:00:00+08:00');
      const read = latch(),
        resume = latch();
      const gated = db.$extends({
        query: {
          court: {
            findUnique: async ({ args, query }) => {
              const row = await query(args);
              if (args.where.id === f.court.id) {
                read.signal();
                await resume.promise;
              }
              return row;
            },
          },
        },
      });
      const pending = capture(
        new VenuesService(gated as never).createBooking(f.dto, f.buyer),
      );
      await read.promise;
      try {
        await venues.createClosure(
          {
            courtId: f.court.id,
            startsAt: f.date + 'T18:00:00+08:00',
            endsAt: f.date + 'T19:00:00+08:00',
            reason: '临时维修封场',
            creationIdempotencyKey: key(),
          },
          admin,
        );
      } finally {
        resume.signal();
      }
      expect((await pending).error).toMatchObject({ status: 409 });
      expect(
        await db.courtBooking.count({ where: { courtId: f.court.id } }),
      ).toBe(0);
    });
    it('youth rule publishing requires a different reviewer and enforces hard limits', async () => {
      const both = { ...admin, roles: ['ADMIN', 'SUPER_ADMIN'] as AppRole[] };
      const rule = await youth.create(
        {
          maxTotalSessions: 10,
          maxValidityDays: 90,
          maxContractAmountCents: 100000,
          warningThresholdDays: 10,
          hardBlock: true,
          effectiveFrom: new Date(Date.now() + day).toISOString(),
          reason: '配置课程范围',
          idempotencyKey: key(),
        },
        admin,
      );
      await expect(
        youth.publish(
          rule.id,
          { reason: '尝试自审', idempotencyKey: key() },
          both,
        ),
      ).rejects.toMatchObject({ status: 403 });
      const decision = { reason: '异人复核通过', idempotencyKey: key() };
      await youth.publish(rule.id, decision, superAdmin);
      expect((await youth.publish(rule.id, decision, superAdmin)).id).toBe(
        rule.id,
      );
      await expect(
        youth.validateProduct(
          { totalSessions: 11, validityDays: 90, priceCents: 100000 },
          new Date(Date.now() + day + 60000),
        ),
      ).rejects.toMatchObject({ status: 400 });
    });

    async function trainingFixture(assistantId?: string) {
      const coach = await person('COACH');
      const product = await db.trainingProduct.create({
        data: {
          code: key(),
          name: '隔离成人课程',
          audience: 'ADULT',
          totalSessions: 10,
          validityDays: 90,
          priceCents: 100000,
          unitRevenueCents: 10000,
          refundRule: {},
        },
      });
      const cls = await db.trainingClass.create({
        data: {
          code: key(),
          name: '隔离培训班',
          productId: product.id,
          coachId: coach.sub,
          assistantId,
          schedule: {},
          capacity: 10,
        },
      });
      const session = await db.trainingSession.create({
        data: {
          classId: cls.id,
          startsAt: new Date(Date.now() - 600000),
          endsAt: new Date(Date.now() + 3000000),
          courtCount: 1,
          occupiedCourtHours: 1,
        },
      });
      return { session, coach };
    }
    it('front desk is not assigned an inaccessible game task', async () => {
      const desk = await person('FRONT_DESK'),
        host = await person('HOST');
      const game = await db.game.create({
        data: {
          code: key(),
          title: '前台待办隔离球局',
          hostId: host.sub,
          level: 'BEGINNER',
          status: 'OPEN',
          capacity: 4,
          feeCents: 1000,
          startsAt: new Date(Date.now() - 600000),
          endsAt: new Date(Date.now() + 3000000),
        },
      });
      const item = (await new WorkItemsService(db).list(desk, 100)).find(
        (i) => i.objectId === game.id,
      );
      expect(item).toBeUndefined();
      await expect(new GamesService(db).managed(desk)).rejects.toMatchObject({
        status: 403,
      });
    });
    it('adding COACH to FRONT_DESK retains its visible session tasks', async () => {
      const desk = await person('FRONT_DESK'),
        f = await trainingFixture(),
        queue = new WorkItemsService(db);
      expect(
        (await queue.list(desk, 100)).some((i) => i.objectId === f.session.id),
      ).toBe(true);
      await new GovernanceService(db).setUserRoles(
        desk.sub,
        {
          roles: ['FRONT_DESK', 'COACH'],
          primaryRole: 'FRONT_DESK',
          reason: '前台兼任教练',
          idempotencyKey: key(),
        },
        superAdmin,
      );
      const hybrid = { ...desk, roles: ['FRONT_DESK', 'COACH'] as AppRole[] };
      expect(
        (await new TrainingService(db).listSessions(hybrid)).some(
          (s) => s.id === f.session.id,
        ),
      ).toBe(true);
      expect(
        (await queue.list(hybrid, 100)).some(
          (i) => i.objectId === f.session.id,
        ),
      ).toBe(true);
    });
    it('an assigned assistant receives its due session task', async () => {
      const assistant = await person('COACH'),
        f = await trainingFixture(assistant.sub),
        queue = new WorkItemsService(db);
      expect(
        (await queue.list(f.coach, 100)).some(
          (i) => i.objectId === f.session.id,
        ),
      ).toBe(true);
      expect(
        (await new TrainingService(db).listSessions(assistant)).some(
          (s) => s.id === f.session.id,
        ),
      ).toBe(true);
      expect(
        (await queue.list(assistant, 100)).some(
          (i) => i.objectId === f.session.id,
        ),
      ).toBe(true);
    });
    it('member receives no operations queue', async () => {
      expect(await new WorkItemsService(db).list(await person(), 100)).toEqual(
        [],
      );
    });
    async function assistedFixture(role: AppRole, past = false) {
      const f = await fixture(),
        actor = await person(role);
      if (role === 'FRONT_DESK') {
        const today = new Date(Date.now() + 8 * 3600000)
          .toISOString()
          .slice(0, 10);
        await db.frontDeskShift.create({
          data: {
            operatorId: actor.sub,
            openedById: actor.sub,
            businessDate: new Date(today + 'T00:00:00+08:00'),
            openingCashCents: 0,
          },
        });
      }
      if (past)
        f.dto.date = new Date(Date.now() + 8 * 3600000 - day)
          .toISOString()
          .slice(0, 10);
      await price(f.slot.id, '2020-01-01T00:00:00+08:00');
      return {
        ...f,
        actor,
        command: {
          ...f.dto,
          memberId: f.buyer.sub,
          sourceChannel: 'STORE_VISIT' as const,
          overrideReason: '已协调同场或补录实际使用',
        },
      };
    }
    for (const role of ['ADMIN', 'SUPER_ADMIN', 'FRONT_DESK'] as AppRole[]) {
      for (const past of [false, true]) {
        it(`${role} can assist a member on an occupied ${past ? 'past' : 'future'} slot without changing the original order`, async () => {
          const f = await assistedFixture(role, past);
          const original = await venues.createBooking(
            { ...f.command, creationIdempotencyKey: key() },
            f.actor,
          );
          await orders.pay(
            original.id,
            { channel: 'CASH_PRINCIPAL', idempotencyKey: key() },
            f.buyer,
          );
          const created = await venues.createBooking(f.command, f.actor);
          expect(created).toMatchObject({
            status: 'PENDING',
            bookings: [{ operatorOverride: true }],
          });
          expect(
            new Date(created.paymentExpiresAt!).getTime() - Date.now(),
          ).toBeGreaterThan(9 * 60_000);
          const stored = await db.order.findUniqueOrThrow({
            where: { id: created.id },
            include: { bookings: true },
          });
          expect(stored).toMatchObject({
            memberId: f.buyer.sub,
            createdById: f.actor.sub,
            parameterSnapshot: {
              assistedBookingOverride: {
                reason: f.command.overrideReason,
                actorId: f.actor.sub,
                past,
              },
            },
          });
          expect(
            (await orders.list(f.buyer, { page: 1, pageSize: 20 })).items.some(
              (o) => o.id === created.id,
            ),
          ).toBe(true);
          await expect(
            venues.createBooking(f.command, f.actor),
          ).resolves.toMatchObject({ id: created.id });
          await expect(
            venues.createBooking(
              { ...f.command, overrideReason: '另一种原因' },
              f.actor,
            ),
          ).rejects.toMatchObject({ status: 409 });
          await orders.pay(
            created.id,
            { channel: 'CASH_PRINCIPAL', idempotencyKey: key() },
            f.buyer,
          );
          expect(
            await db.courtBooking.count({
              where: { courtId: f.court.id, status: 'CONFIRMED' },
            }),
          ).toBe(2);
          expect(
            await db.auditLog.count({
              where: {
                objectId: created.id,
                action: 'VENUE_ORDER_CREATED',
                actorId: f.actor.sub,
                reason: f.command.overrideReason,
              },
            }),
          ).toBe(1);
          await expect(
            venues.createBooking(
              { ...f.dto, creationIdempotencyKey: key() },
              f.buyer,
            ),
          ).rejects.toBeDefined();
          const third = await venues.createBooking(
            { ...f.command, creationIdempotencyKey: key() },
            f.actor,
          );
          await orders.cancelPending(
            third.id,
            { reason: '取消多余代订单', idempotencyKey: key() },
            f.buyer,
          );
          expect(
            await db.courtBooking.count({
              where: { courtId: f.court.id, status: 'CONFIRMED' },
            }),
          ).toBe(2);
          expect(
            (await db.order.findUniqueOrThrow({ where: { id: original.id } }))
              .status,
          ).toBe('PAID');
        });
      }
    }
    it('normal reservation remains protected when a special reservation is cancelled', async () => {
      const f = await assistedFixture('FRONT_DESK');
      const original = await venues.createBooking(
        { ...f.dto, creationIdempotencyKey: key() },
        f.buyer,
      );
      const special = await venues.createBooking(f.command, f.actor);
      await orders.cancelPending(
        special.id,
        { reason: '取消特殊代订', idempotencyKey: key() },
        f.buyer,
      );
      await expect(
        venues.createBooking(
          { ...f.dto, creationIdempotencyKey: key() },
          await person(),
        ),
      ).rejects.toMatchObject({ status: 409 });
      expect(
        (await db.order.findUniqueOrThrow({ where: { id: original.id } }))
          .status,
      ).toBe('PENDING');
    });
    it('front desk still needs an open shift and members cannot claim an exception', async () => {
      const f = await assistedFixture('ADMIN', true),
        desk = await person('FRONT_DESK');
      await expect(venues.createBooking(f.command, desk)).rejects.toMatchObject(
        { status: 409 },
      );
      await expect(
        venues.createBooking(f.command, f.buyer),
      ).rejects.toMatchObject({ status: 403 });
      await expect(
        venues.createBooking(
          { ...f.command, memberId: undefined, sourceChannel: 'MINI_PROGRAM' },
          f.actor,
        ),
      ).rejects.toMatchObject({ status: 403 });
      await expect(
        venues.createBooking({ ...f.command, overrideReason: ' ' }, f.actor),
      ).rejects.toMatchObject({ status: 400 });
      expect(
        await db.courtBooking.count({ where: { courtId: f.court.id } }),
      ).toBe(0);
    });
    it('assisted availability includes disabled resources and exceptions retain closures', async () => {
      const f = await assistedFixture('FRONT_DESK');
      await db.court.update({
        where: { id: f.court.id },
        data: { enabled: false, usage: 'MAINTENANCE' },
      });
      await db.timeSlot.update({
        where: { id: f.slot.id },
        data: { enabled: false },
      });
      const closure = await venues.createClosure(
        {
          courtId: f.court.id,
          startsAt: f.date + 'T18:00:00+08:00',
          endsAt: f.date + 'T19:00:00+08:00',
          reason: '维修安排',
          creationIdempotencyKey: key(),
        },
        admin,
      );
      expect(
        (await venues.availability(f.date)).courts.some(
          (c) => c.id === f.court.id,
        ),
      ).toBe(false);
      expect(
        (await venues.availability(f.date, true)).courts.some(
          (c) => c.id === f.court.id,
        ),
      ).toBe(true);
      expect(
        (await venues.availability(f.date, true)).slots.some(
          (s) => s.id === f.slot.id,
        ),
      ).toBe(true);
      const order = await venues.createBooking(f.command, f.actor);
      expect(
        (await db.order.findUniqueOrThrow({ where: { id: order.id } }))
          .parameterSnapshot,
      ).toMatchObject({
        assistedBookingOverride: {
          courtEnabled: false,
          slotEnabled: false,
          courtUsage: 'MAINTENANCE',
          closureId: closure.id,
        },
      });
      expect(
        (await db.courtClosure.findUniqueOrThrow({ where: { id: closure.id } }))
          .status,
      ).toBe('ACTIVE');
    });
    it('an unpaid past exception expires by its payment deadline', async () => {
      const f = await assistedFixture('ADMIN', true);
      const order = await venues.createBooking(f.command, f.actor);
      await db.courtBooking.updateMany({
        where: { orderId: order.id },
        data: { holdExpiresAt: new Date(Date.now() - 1000) },
      });
      await venues.releaseExpiredHolds();
      expect(
        (await db.order.findUniqueOrThrow({ where: { id: order.id } })).status,
      ).toBe('CANCELLED');
      expect(
        (
          await db.courtBooking.findFirstOrThrow({
            where: { orderId: order.id },
          })
        ).status,
      ).toBe('CANCELLED');
    });

    it('database requires exception evidence and retains the normal unique slot guard', async () => {
      const f = await assistedFixture('ADMIN');
      const original = await venues.createBooking(
        { ...f.dto, creationIdempotencyKey: key() },
        f.buyer,
      );
      const booking = await db.courtBooking.findFirstOrThrow({
        where: { orderId: original.id },
      });
      await expect(
        db.courtBooking.create({
          data: {
            courtId: f.court.id,
            startsAt: booking.startsAt,
            endsAt: booking.endsAt,
            status: 'HELD',
          },
        }),
      ).rejects.toMatchObject({ code: 'P2002' });
      await expect(
        db.courtBooking.update({
          where: { id: booking.id },
          data: { operatorOverride: true, overrideReason: null },
        }),
      ).rejects.toBeDefined();
      await expect(
        db.courtBooking.update({
          where: { id: booking.id },
          data: { operatorOverride: true, overrideReason: ' ' },
        }),
      ).rejects.toBeDefined();
      expect(
        (await db.courtBooking.findUniqueOrThrow({ where: { id: booking.id } }))
          .operatorOverride,
      ).toBe(false);
      await expect(
        venues.createBooking(
          { ...f.command, overrideReason: null as never },
          f.actor,
        ),
      ).rejects.toMatchObject({ status: 400 });
    });
  },
);
