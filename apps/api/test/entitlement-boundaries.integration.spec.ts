import { createOrderFinalizerService } from './support/domain-consumer-fixtures.js';
import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PrismaService } from '../src/database/prisma.service.js';
import { TrainingService } from './support/training-service-fixture.js';
import { MembershipsService } from './support/memberships-fixture.js';
import { membershipEligibility } from '../src/memberships/membership-eligibility.js';
import { OrdersService } from './support/orders-fixture.js';
import { WechatPayService } from '../src/payments/wechat-pay.service.js';

import type { AuthUser } from '../src/common/auth/auth-user.js';
import type { AppRole, MemberLevel } from '../src/generated/prisma/enums.js';

// Business invariants tested against a real, isolated PostgreSQL database.
const url = process.env.TEST_DATABASE_URL;
const key = () => 'r5-' + randomUUID();
const hour = 3_600_000;
const day = 24 * hour;
describe.skipIf(!url)(
  'membership and training entitlement boundaries on PostgreSQL',
  () => {
    let db: PrismaService,
      training: TrainingService,
      memberships: MembershipsService,
      orders: OrdersService;
    let admin: AuthUser, coach: AuthUser, finance: AuthUser;
    let fixtureDay = 0;
    beforeAll(async () => {
      const target = new URL(url!);
      if (
        !['localhost', '127.0.0.1'].includes(target.hostname) ||
        !target.pathname.endsWith('_test')
      )
        throw new Error('Only a local isolated test database is allowed');
      db = new PrismaService(new ConfigService({ DATABASE_URL: url }));
      await db.$connect();
      training = new TrainingService(db);
      memberships = new MembershipsService(db);
      orders = new OrdersService(
        db,
        new ConfigService({ PAYMENT_PROVIDER: 'wechat' }),
        createOrderFinalizerService({} as never),
        {} as never,
      );
      admin = await person('ADMIN');
      coach = await person('COACH');
      finance = await person('FINANCE');
    });
    afterAll(async () => {
      vi.useRealTimers();
      if (db) await db.$disconnect();
    });
    async function person(role: AppRole = 'MEMBER'): Promise<AuthUser> {
      const u = await db.user.create({
        data: {
          displayName: '第五轮隔离审查',
          primaryRole: role,
          memberProfile: { create: { tags: [] } },
          accounts: { create: { type: 'CASH_PRINCIPAL', balance: 1_000_000 } },
        },
      });
      return { sub: u.id, displayName: u.displayName, roles: [role] };
    }
    async function course(
      coachCostCents = 0,
      assistantCostCents = 0,
      materialCostCents = 0,
    ) {
      const baseTime = Date.now() + ++fixtureDay * day;
      const product = await training.createProduct(
        {
          code: key(),
          name: '隔离成人课包',
          audience: 'ADULT',
          totalSessions: 10,
          validityDays: 90,
          priceCents: 10000,
          refundRule: {},
        },
        admin,
      );
      const trainingClass = await training.createClass(
        {
          code: key(),
          productId: product.id,
          name: '隔离班级',
          coachId: coach.sub,
          schedule: {},
          capacity: 10,
          coachCostCents,
          assistantCostCents,
          materialCostCents,
        },
        admin,
      );
      const court = await db.court.create({
        data: { code: key(), name: '隔离场地', zone: 'EAST', sortOrder: 1 },
      });
      const buyer = await person();
      const order = await training.purchase(
        {
          productId: product.id,
          classId: trainingClass.id,
          sourceChannel: 'MINI_PROGRAM',
          creationIdempotencyKey: key(),
        },
        buyer,
      );
      await orders.pay(
        order.id,
        { channel: 'CASH_PRINCIPAL', idempotencyKey: key() },
        buyer,
      );
      const enrollment = await db.trainingEnrollment.findUniqueOrThrow({
        where: { orderId: order.id },
      });
      return { product, trainingClass, court, buyer, enrollment, baseTime };
    }
    async function session(c: Awaited<ReturnType<typeof course>>, offset = 0) {
      return training.createSession(
        {
          classId: c.trainingClass.id,
          courtIds: [c.court.id],
          startsAt: new Date(c.baseTime + 2 * hour + offset).toISOString(),
          endsAt: new Date(c.baseTime + 3 * hour + offset).toISOString(),
          reason: '隔离排课',
          creationIdempotencyKey: key(),
        },
        coach,
      );
    }
    async function consume(sessionId: string, enrollmentId: string) {
      const s = await db.trainingSession.findUniqueOrThrow({
        where: { id: sessionId },
      });
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(s.endsAt.getTime() + 1);
      try {
        await training.markAttendance(
          sessionId,
          { enrollmentId, status: 'ATTENDED' },
          coach,
        );
        await training.proposeConsume(sessionId, { enrollmentId }, coach);
        await training.confirmConsume(
          sessionId,
          { enrollmentId, reason: '核对实际出勤', idempotencyKey: key() },
          admin,
        );
        return await db.trainingRevenueRecognition.findFirstOrThrow({
          where: { attendance: { sessionId, enrollmentId }, type: 'CONSUME' },
        });
      } finally {
        vi.useRealTimers();
      }
    }
    async function recognized() {
      const c = await course();
      const s = await session(c);
      const recognition = await consume(s.id, c.enrollment.id);
      // Prisma supplies createdAt from JS Date. Each fixture runs on a separate
      // simulated day inside the paid course validity period; rows are not rewritten.
      const periodStart = new Date(recognition.createdAt.getTime() - 1);
      const dto = {
        periodStart: periodStart.toISOString(),
        periodEnd: new Date(recognition.createdAt.getTime() + 1).toISOString(),
        acquisitionCostCents: 0,
        marketingCostCents: 0,
      };
      return { ...c, s, recognition, periodStart, dto };
    }
    async function settle(id: string) {
      await training.submitSettlement(id, {}, finance);
      await training.confirmSettlement(id, {}, admin);
      return training.settleSettlement(id, {}, admin);
    }
    async function correction(recognitionId: string) {
      const request = await training.requestConsumeCorrection(
        { recognitionId, reason: '核实重复消课', idempotencyKey: key() },
        coach,
      );
      return training.approveConsumeCorrection(
        request.id,
        { reason: '复核同意冲正', idempotencyKey: key() },
        admin,
      );
    }
    async function captured<T>(p: Promise<T>) {
      try {
        return { ok: true as const, value: await p };
      } catch (e) {
        return {
          ok: false as const,
          message: (e as Error).message,
          status: (e as { getStatus?: () => number }).getStatus?.(),
        };
      }
    }
    async function membershipProduct(
      durationDays: number,
      level: MemberLevel = 'GOLD',
    ) {
      const p = await memberships.createProduct(
        {
          code: 'R5_' + randomUUID().replaceAll('-', '').toUpperCase(),
          name: '隔离会员产品',
          level,
          priceCents: 10000,
          durationDays,
          benefits: {},
          effectiveFrom: new Date(Date.now() - hour).toISOString(),
          reason: '隔离产品创建',
          idempotencyKey: key(),
        },
        admin,
      );
      await memberships.setProductStatus(
        p.id,
        { enabled: true, reason: '隔离上架', idempotencyKey: key() },
        admin,
      );
      return p;
    }
    async function buyMembership(productId: string, buyer: AuthUser) {
      const order = await memberships.purchase(
        { productId, creationIdempotencyKey: key() },
        buyer,
      );
      await orders.pay(
        order.id,
        { channel: 'CASH_PRINCIPAL', idempotencyKey: key() },
        buyer,
      );
      return db.memberProfile.findUniqueOrThrow({
        where: { userId: buyer.sub },
      });
    }

    async function membershipOrder(productId: string, buyer: AuthUser) {
      return memberships.purchase(
        { productId, creationIdempotencyKey: key() },
        buyer,
      );
    }
    async function paidMembership(productId: string, buyer: AuthUser) {
      const order = await membershipOrder(productId, buyer);
      await orders.pay(
        order.id,
        { channel: 'CASH_PRINCIPAL', idempotencyKey: key() },
        buyer,
      );
      return order;
    }
    async function refundMembership(orderId: string, buyer: AuthUser) {
      const request = await orders.requestRefund(
        orderId,
        {
          amountCents: 10000,
          reason: '退还该次会员购买',
          idempotencyKey: key(),
        },
        buyer,
      );
      return orders.approveRefund(
        request.id,
        { reason: '复核同意退款' },
        admin,
      );
    }
    async function profile(buyer: AuthUser) {
      return db.memberProfile.findUniqueOrThrow({
        where: { userId: buyer.sub },
      });
    }
    async function leave(sessionId: string, enrollmentId: string) {
      const row = await db.trainingSession.findUniqueOrThrow({
        where: { id: sessionId },
      });
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(row.startsAt);
      try {
        return await training.markAttendance(
          sessionId,
          { enrollmentId, status: 'LEAVE', reason: '正常请假申请' },
          coach,
        );
      } finally {
        vi.useRealTimers();
      }
    }
    async function makeupFixture() {
      const c = await course(),
        a = await session(c),
        b = await session(c, 2 * hour),
        target = await session(c, 4 * hour);
      await leave(a.id, c.enrollment.id);
      await leave(b.id, c.enrollment.id);
      return { ...c, a, b, target };
    }

    it('control: a fresh training settlement agrees with its sources and can settle', async () => {
      const c = await recognized();
      const draft = await training.createSettlement(c.dto, finance);
      const sources = await db.trainingRevenueRecognition.findMany({
        where: { settlementId: draft.id },
      });
      expect(draft.effectiveRevenueCents).toBe(1000);
      expect(sources).toHaveLength(1);
      expect(draft.effectiveRevenueCents).toBe(
        sources.reduce((n, r) => n + r.effectiveRevenueCents, 0),
      );
      expect((await settle(draft.id)).status).toBe('SETTLED');
    });

    it('overlapping training periods cannot settle the same revenue twice', async () => {
      const c = await recognized();
      const first = await training.createSettlement(c.dto, finance);
      await settle(first.id);
      await expect(
        training.createSettlement(
          {
            ...c.dto,
            periodStart: new Date(c.periodStart.getTime() + 1).toISOString(),
            periodEnd: new Date(
              new Date(c.dto.periodEnd).getTime() + 1,
            ).toISOString(),
          },
          finance,
        ),
      ).rejects.toMatchObject({ status: 409 });
      expect(
        await db.trainingSettlement.count({
          where: {
            periodStart: { lt: new Date(c.dto.periodEnd) },
            periodEnd: { gt: c.periodStart },
            status: { not: 'VOID' },
          },
        }),
      ).toBe(1);
    });

    it('control: an unsettled consumed lesson can be corrected', async () => {
      const c = await recognized();
      const result = await captured(correction(c.recognition.id));
      expect(result.ok).toBe(true);
      const enrollment = await db.trainingEnrollment.findUniqueOrThrow({
        where: { id: c.enrollment.id },
      });
      expect(enrollment.consumedSessions).toBe(0);
      expect(enrollment.prepaidBalanceCents).toBe(10000);
    });

    it('voiding a training draft must release its sources and permit re-creation', async () => {
      const c = await recognized();
      const draft = await training.createSettlement(c.dto, finance);
      await training.voidSettlement(
        draft.id,
        { reason: '制单范围有误', idempotencyKey: key() },
        finance,
      );
      const source = await db.trainingRevenueRecognition.findUniqueOrThrow({
        where: { id: c.recognition.id },
      });
      const corrected = await captured(correction(source.id));
      const recreated = await training.createSettlement(c.dto, finance);
      expect(source.settlementId).toBeNull();
      expect(corrected.ok).toBe(true);
      expect(recreated.status).toBe('DRAFT');
      expect(recreated.id).not.toBe(draft.id);
    });

    it('control: first membership purchase grants the advertised period', async () => {
      const buyer = await person(),
        p = await membershipProduct(365);
      const profile = await buyMembership(p.id, buyer);
      expect(profile.level).toBe('GOLD');
      expect(
        profile.membershipExpiresAt!.getTime() - Date.now(),
      ).toBeGreaterThan(364 * day);
    });

    it('a paid short membership must not truncate an active annual membership', async () => {
      const buyer = await person(),
        annual = await membershipProduct(365),
        monthly = await membershipProduct(30);
      const before = await buyMembership(annual.id, buyer);
      const after = await buyMembership(monthly.id, buyer);
      const subscriptions = await db.memberSubscription.findMany({
        where: { memberId: after.id },
        include: { order: true },
      });
      const at31Days = new Date(Date.now() + 31 * day);
      expect(membershipEligibility(after, at31Days).eligible).toBe(true);
      expect(
        after.membershipExpiresAt!.getTime() -
          before.membershipExpiresAt!.getTime(),
      ).toBe(30 * day);
      expect(subscriptions).toHaveLength(2);
      expect(after.membershipExpiresAt!.getTime()).toBeGreaterThanOrEqual(
        before.membershipExpiresAt!.getTime(),
      );
    });

    it('cross-tier purchase is rejected before creating another payable order', async () => {
      const buyer = await person(),
        black = await membershipProduct(365, 'BLACK'),
        gold = await membershipProduct(365, 'GOLD');
      await buyMembership(black.id, buyer);
      await expect(
        memberships.purchase(
          { productId: gold.id, creationIdempotencyKey: key() },
          buyer,
        ),
      ).rejects.toMatchObject({ status: 409 });
      const after = await db.memberProfile.findUniqueOrThrow({
        where: { userId: buyer.sub },
      });
      expect(after.level).toBe('BLACK');
      expect(await db.order.count({ where: { memberId: buyer.sub } })).toBe(1);
    });

    it('two leave records must not share one makeup attendance', async () => {
      const c = await course(),
        a = await session(c),
        b = await session(c, 2 * hour),
        target = await session(c, 4 * hour);
      for (const s of [a, b]) {
        const row = await db.trainingSession.findUniqueOrThrow({
          where: { id: s.id },
        });
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(row.startsAt);
        try {
          await training.markAttendance(
            s.id,
            {
              enrollmentId: c.enrollment.id,
              status: 'LEAVE',
              reason: '学员请假',
            },
            coach,
          );
        } finally {
          vi.useRealTimers();
        }
      }
      await training.scheduleMakeup(
        a.id,
        {
          enrollmentId: c.enrollment.id,
          makeupSessionId: target.id,
          reason: '第一次补课',
        },
        coach,
      );
      const first = await db.trainingAttendance.findUniqueOrThrow({
        where: {
          sessionId_enrollmentId: {
            sessionId: a.id,
            enrollmentId: c.enrollment.id,
          },
        },
      });
      expect(first.status).toBe('MADE_UP'); // Single-assignment control.
      const second = await captured(
        training.scheduleMakeup(
          b.id,
          {
            enrollmentId: c.enrollment.id,
            makeupSessionId: target.id,
            reason: '第二次补课',
          },
          coach,
        ),
      );
      const aRow = await db.trainingSession.findUniqueOrThrow({
        where: { id: a.id },
      });
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(aRow.endsAt.getTime() + 1);
      try {
        await training.completeSession(a.id, admin, {
          reason: '核实补课安排并结课',
        });
        await expect(
          training.completeSession(b.id, admin, { reason: '仍有请假未处理' }),
        ).rejects.toMatchObject({ status: 409 });
      } finally {
        vi.useRealTimers();
      }
      await consume(target.id, c.enrollment.id);
      const originals = await db.trainingAttendance.findMany({
        where: {
          sessionId: { in: [a.id, b.id] },
          enrollmentId: c.enrollment.id,
        },
      });
      expect(originals.filter((a) => a.status === 'MADE_UP')).toHaveLength(1);
      const targetRows = await db.trainingAttendance.findMany({
        where: { sessionId: target.id, enrollmentId: c.enrollment.id },
      });
      expect(second).toMatchObject({ ok: false, status: 409 });
      expect(targetRows).toHaveLength(1);
      expect(targetRows[0].consumedSessions).toBe(1);
    });

    it('creation and concurrent consumption cannot commit an inconsistent snapshot', async () => {
      const c = await recognized();
      c.court = await db.court.create({
        data: { code: key(), name: '并发课次场地', zone: 'EAST', sortOrder: 1 },
      });
      const next = await session(c, 100);
      let pause!: () => void,
        resume!: () => void,
        armed = true;
      const reached = new Promise<void>((resolve) => {
        pause = resolve;
      });
      const gate = new Promise<void>((resolve) => {
        resume = resolve;
      });
      const extended = db.$extends({
        query: {
          trainingRevenueRecognition: {
            async findMany({ args, query }) {
              const rows = await query(args);
              if (armed) {
                armed = false;
                pause();
                await gate;
              }
              return rows;
            },
          },
        },
      });
      const gated = new TrainingService(extended as unknown as PrismaService);
      const nextRow = await db.trainingSession.findUniqueOrThrow({
        where: { id: next.id },
      });
      const dto = {
        ...c.dto,
        periodEnd: new Date(nextRow.endsAt.getTime() + 10).toISOString(),
      };
      const pending = captured(gated.createSettlement(dto, finance));
      let posted: Awaited<ReturnType<typeof captured>> | undefined;
      try {
        await reached;
        posted = await captured(consume(next.id, c.enrollment.id));
      } finally {
        resume();
      }
      const result = await pending;
      expect(posted?.ok).toBe(true);
      expect(result).toMatchObject({ ok: false, status: 409 });
      const draft = await training.createSettlement(dto, finance);
      const sources = await db.trainingRevenueRecognition.findMany({
        where: { settlementId: draft.id },
      });
      expect(sources).toHaveLength(2);
      expect(draft.effectiveRevenueCents).toBe(2000);
      expect(draft.effectiveRevenueCents).toBe(
        sources.reduce((n, r) => n + r.effectiveRevenueCents, 0),
      );
    }, 20000);
    it('same-level renewal follows payment order and an exact payment replay does not add time', async () => {
      const buyer = await person(),
        annual = await membershipProduct(365),
        monthly = await membershipProduct(30);
      const a = await membershipOrder(annual.id, buyer),
        b = await membershipOrder(monthly.id, buyer);
      const paymentKey = key();
      await orders.pay(
        b.id,
        { channel: 'CASH_PRINCIPAL', idempotencyKey: key() },
        buyer,
      );
      await orders.pay(
        a.id,
        { channel: 'CASH_PRINCIPAL', idempotencyKey: paymentKey },
        buyer,
      );
      const before = await profile(buyer);
      await orders.pay(
        a.id,
        { channel: 'CASH_PRINCIPAL', idempotencyKey: paymentKey },
        buyer,
      );
      expect((await profile(buyer)).membershipExpiresAt).toEqual(
        before.membershipExpiresAt,
      );
      const subs = await db.memberSubscription.findMany({
        where: { memberId: before.id },
        orderBy: { startsAt: 'asc' },
      });
      expect(subs[1].startsAt).toEqual(subs[0].endsAt);
      expect(+subs[1].endsAt - +subs[0].startsAt).toBe(395 * day);
    });

    it('concurrent renewal payments retry without lost time or duplicate debits', async () => {
      const buyer = await person(),
        p = await membershipProduct(30);
      await paidMembership(p.id, buyer);
      const a = await membershipOrder(p.id, buyer),
        b = await membershipOrder(p.id, buyer);
      const commands = [a, b].map((o) => ({
        id: o.id,
        dto: { channel: 'CASH_PRINCIPAL' as const, idempotencyKey: key() },
      }));
      const results = await Promise.all(
        commands.map((c) => captured(orders.pay(c.id, c.dto, buyer))),
      );
      for (let i = 0; i < results.length; i++) {
        if (!results[i].ok) {
          expect(results[i]).toMatchObject({ status: 409 });
          await orders.pay(commands[i].id, commands[i].dto, buyer);
        }
      }
      const subs = await db.memberSubscription.findMany({
        where: { memberId: (await profile(buyer)).id },
        orderBy: { startsAt: 'asc' },
      });
      expect(subs).toHaveLength(3);
      expect(+subs[2].endsAt - +subs[0].startsAt).toBe(90 * day);
      expect(
        await db.payment.count({
          where: { userId: buyer.sub, status: 'SUCCEEDED' },
        }),
      ).toBe(3);
      expect(
        (
          await db.account.findUniqueOrThrow({
            where: {
              userId_type: { userId: buyer.sub, type: 'CASH_PRINCIPAL' },
            },
          })
        ).balance,
      ).toBe(970000);
    });

    it('a pending different tier must be cancelled before buying another tier', async () => {
      const buyer = await person(),
        a = await membershipProduct(365, 'BLACK'),
        b = await membershipProduct(365, 'GOLD');
      const pending = await membershipOrder(a.id, buyer);
      await expect(membershipOrder(b.id, buyer)).rejects.toMatchObject({
        status: 409,
      });
      await orders.cancelPending(
        pending.id,
        { idempotencyKey: key(), reason: '更换未支付方案' },
        buyer,
      );
      await paidMembership(b.id, buyer);
      expect((await profile(buyer)).level).toBe('GOLD');
    });

    it('concurrent different-tier creation leaves only one payable order', async () => {
      const buyer = await person(),
        a = await membershipProduct(30, 'BLACK'),
        b = await membershipProduct(30, 'GOLD');
      const results = await Promise.all(
        [a, b].map((p) => captured(membershipOrder(p.id, buyer))),
      );
      expect(results.filter((r) => r.ok)).toHaveLength(1);
      expect(results.find((r) => !r.ok)).toMatchObject({ status: 409 });
      expect(
        await db.order.count({
          where: { memberId: buyer.sub, status: 'PENDING' },
        }),
      ).toBe(1);
    });

    it('refunding a queued renewal preserves the existing paid annual interval', async () => {
      const buyer = await person(),
        annual = await membershipProduct(365),
        monthly = await membershipProduct(30);
      await paidMembership(annual.id, buyer);
      const before = await profile(buyer),
        renewal = await paidMembership(monthly.id, buyer);
      await refundMembership(renewal.id, buyer);
      expect((await profile(buyer)).membershipExpiresAt).toEqual(
        before.membershipExpiresAt,
      );
    });

    it('refunding the current interval brings its paid queued renewal forward', async () => {
      const buyer = await person(),
        annual = await membershipProduct(365),
        monthly = await membershipProduct(30);
      const current = await paidMembership(annual.id, buyer);
      await paidMembership(monthly.id, buyer);
      await refundMembership(current.id, buyer);
      const after = await profile(buyer);
      expect(after.level).toBe('GOLD');
      expect(after.membershipExpiresAt!.getTime() - Date.now()).toBeGreaterThan(
        29 * day,
      );
      expect(
        after.membershipExpiresAt!.getTime() - Date.now(),
      ).toBeLessThanOrEqual(30 * day);
    });

    it('refunding the final paid subscription clears the cached expiry', async () => {
      const buyer = await person(),
        p = await membershipProduct(30);
      const order = await paidMembership(p.id, buyer);
      await refundMembership(order.id, buyer);
      expect(await profile(buyer)).toMatchObject({
        level: 'EXPERIENCE',
        membershipExpiresAt: null,
      });
    });

    async function legacyConflictingMembership() {
      const buyer = await person(),
        black = await membershipProduct(365, 'BLACK'),
        gold = await membershipProduct(30, 'GOLD');
      await paidMembership(black.id, buyer);
      const member = await profile(buyer);
      // Seed an old payable order from before the cross-tier rule, then exercise
      // current payment endpoints and callback processing without external money.
      const order = await db.order.create({
        data: {
          orderNo: key(),
          memberId: buyer.sub,
          createdById: buyer.sub,
          businessType: 'MEMBERSHIP',
          subjectAccount: 'VENUE',
          sourceChannel: 'MINI_PROGRAM',
          title: '旧版跨等级待付款单',
          listAmountCents: 10000,
          payableCents: 10000,
          parameterSnapshot: { durationDays: 30 },
          membership: {
            create: {
              memberId: member.id,
              productId: gold.id,
              startsAt: new Date(),
              endsAt: new Date(Date.now() + 30 * day),
              status: 'FROZEN',
            },
          },
        },
      });
      return { buyer, order, member };
    }

    it('an old conflicting order cannot charge a balance or request WeChat prepay', async () => {
      const f = await legacyConflictingMembership();
      const provider = { createJsapiPayment: vi.fn() };
      const service = new OrdersService(
        db,
        new ConfigService({ PAYMENT_PROVIDER: 'wechat' }),
        createOrderFinalizerService({} as never),
        provider as never,
      );
      for (const channel of ['CASH_PRINCIPAL', 'WECHAT'] as const)
        await expect(
          service.pay(f.order.id, { channel, idempotencyKey: key() }, f.buyer),
        ).rejects.toMatchObject({ status: 409 });
      expect(provider.createJsapiPayment).not.toHaveBeenCalled();
      expect(await db.payment.count({ where: { orderId: f.order.id } })).toBe(
        0,
      );
      expect(
        (await service.paymentOptions(f.order.id, f.buyer)).options.every(
          (o) => !o.enabled,
        ),
      ).toBe(true);
    });

    it('an already-paid conflicting WeChat callback records one compensation refund without granting benefits', async () => {
      const f = await legacyConflictingMembership();
      await db.payment.create({
        data: {
          paymentNo: key(),
          orderId: f.order.id,
          userId: f.buyer.sub,
          operatorId: f.buyer.sub,
          channel: 'WECHAT',
          amountCents: 10000,
          status: 'PROCESSING',
          idempotencyKey: key(),
        },
      });
      const service = new WechatPayService(
        new ConfigService({ PAYMENT_PROVIDER: 'wechat' }),
        db,
        createOrderFinalizerService({} as never),
      );
      vi.spyOn(
        service as unknown as { verifyWechatSignature: () => void },
        'verifyWechatSignature',
      ).mockImplementation(() => {});
      vi.spyOn(
        service as unknown as { decrypt: () => unknown },
        'decrypt',
      ).mockReturnValue({
        out_trade_no: f.order.orderNo,
        transaction_id: key(),
        trade_state: 'SUCCESS',
        amount: { total: 10000 },
      });
      const receive = () =>
        service.handleNotification(
          Buffer.from(
            JSON.stringify({ event_type: 'TRANSACTION.SUCCESS', resource: {} }),
          ),
          {
            'wechatpay-timestamp': String(Math.floor(Date.now() / 1000)),
            'wechatpay-nonce': 'local',
            'wechatpay-signature': 'local',
            'wechatpay-serial': 'local',
          },
        );
      await receive();
      await receive();
      const refunds = await db.refund.findMany({
        where: { orderId: f.order.id },
      });
      expect(refunds).toHaveLength(1);
      expect(refunds[0]).toMatchObject({
        compensationOnly: true,
        status: 'REQUESTED',
      });
      expect((await profile(f.buyer)).membershipExpiresAt).toEqual(
        f.member.membershipExpiresAt,
      );
      expect((await profile(f.buyer)).level).toBe('BLACK');
      expect(
        (await db.order.findUniqueOrThrow({ where: { id: f.order.id } }))
          .status,
      ).toBe('REFUND_PENDING');
    });

    it('same training period replays, changed costs conflict, and adjacent periods remain valid', async () => {
      const c = await recognized(),
        draft = await training.createSettlement(c.dto, finance);
      expect((await training.createSettlement(c.dto, finance)).id).toBe(
        draft.id,
      );
      await expect(
        training.createSettlement(
          { ...c.dto, acquisitionCostCents: 1 },
          finance,
        ),
      ).rejects.toMatchObject({ status: 409 });
      const adjacent = await training.createSettlement(
        {
          ...c.dto,
          periodStart: c.dto.periodEnd,
          periodEnd: new Date(+new Date(c.dto.periodEnd) + 1).toISOString(),
        },
        finance,
      );
      expect(adjacent.effectiveRevenueCents).toBe(0);
    });

    it('replaying an old void cannot release a newer version sources', async () => {
      const c = await recognized(),
        first = await training.createSettlement(c.dto, finance);
      const command = { reason: '核实后重开草稿', idempotencyKey: key() };
      await training.voidSettlement(first.id, command, finance);
      const second = await training.createSettlement(c.dto, finance);
      await training.voidSettlement(first.id, command, finance);
      expect(second.version).toBe(2);
      expect(
        (
          await db.trainingRevenueRecognition.findUniqueOrThrow({
            where: { id: c.recognition.id },
          })
        ).settlementId,
      ).toBe(second.id);
      expect(
        (
          await db.trainingSettlement.findUniqueOrThrow({
            where: { id: first.id },
          })
        ).sourceSnapshot,
      ).toEqual(first.sourceSnapshot);
      await settle(second.id);
    });

    it('concurrent same-period creation is idempotent and binds a source once', async () => {
      const c = await recognized();
      const results = await Promise.all([
        training.createSettlement(c.dto, finance),
        training.createSettlement(c.dto, finance),
      ]);
      expect(results[0].id).toBe(results[1].id);
      expect(
        (
          await db.trainingRevenueRecognition.findUniqueOrThrow({
            where: { id: c.recognition.id },
          })
        ).settlementId,
      ).toBe(results[0].id);
    });

    it('PostgreSQL rejects overlapping active statements even through a direct writer', async () => {
      const c = await recognized(),
        first = await training.createSettlement(c.dto, finance);
      const {
        id: _id,
        createdAt: _createdAt,
        updatedAt: _updatedAt,
        sourceSnapshot,
        ...data
      } = first;
      await expect(
        db.trainingSettlement.create({
          data: {
            ...data,
            sourceSnapshot: sourceSnapshot as never,
            periodEnd: new Date(+data.periodEnd + 1),
          },
        }),
      ).rejects.toThrow();
    });

    it('review rejects a statement whose amount was corrupted despite valid arithmetic constraints', async () => {
      const c = await recognized(),
        draft = await training.createSettlement(c.dto, finance);
      await db.trainingSettlement.update({
        where: { id: draft.id },
        data: {
          effectiveRevenueCents: 2000,
          venueContributionCents: 400,
          cashContributionMarginCents: 2000,
        },
      });
      await expect(
        training.submitSettlement(draft.id, {}, finance),
      ).rejects.toMatchObject({ status: 409 });
      await training.voidSettlement(
        draft.id,
        { reason: '来源核验不一致' },
        finance,
      );
    });

    it('a draft freezes later consumption and completion inside its accounting period', async () => {
      const c = await course(),
        s = await session(c);
      const row = await db.trainingSession.findUniqueOrThrow({
        where: { id: s.id },
      });
      const draft = await training.createSettlement(
        {
          periodStart: row.startsAt.toISOString(),
          periodEnd: new Date(+row.endsAt + 1000).toISOString(),
          acquisitionCostCents: 0,
          marketingCostCents: 0,
        },
        finance,
      );
      await expect(consume(s.id, c.enrollment.id)).rejects.toMatchObject({
        status: 409,
      });
      await training.voidSettlement(
        draft.id,
        { reason: '继续核实未完成课次' },
        finance,
      );
      await consume(s.id, c.enrollment.id);
    });

    it('makeup retries require the same target and an original cannot be marked attended again', async () => {
      const c = await makeupFixture(),
        dto = { enrollmentId: c.enrollment.id, makeupSessionId: c.target.id };
      const first = await training.scheduleMakeup(c.a.id, dto, coach);
      expect((await training.scheduleMakeup(c.a.id, dto, coach)).id).toBe(
        first.id,
      );
      await expect(
        training.scheduleMakeup(
          c.a.id,
          { ...dto, makeupSessionId: c.b.id },
          coach,
        ),
      ).rejects.toMatchObject({ status: 409 });
      await expect(
        training.markAttendance(
          c.a.id,
          { enrollmentId: c.enrollment.id, status: 'ATTENDED' },
          coach,
        ),
      ).rejects.toMatchObject({ status: 409 });
    });

    it('concurrent makeup assignment permits only one owner for a target attendance', async () => {
      const c = await makeupFixture(),
        dto = { enrollmentId: c.enrollment.id, makeupSessionId: c.target.id };
      const results = await Promise.all(
        [c.a, c.b].map((s) =>
          captured(training.scheduleMakeup(s.id, dto, coach)),
        ),
      );
      expect(results.filter((r) => r.ok)).toHaveLength(1);
      expect(results.find((r) => !r.ok)).toMatchObject({ status: 409 });
      const target = await db.trainingAttendance.findUniqueOrThrow({
        where: {
          sessionId_enrollmentId: {
            sessionId: c.target.id,
            enrollmentId: c.enrollment.id,
          },
        },
      });
      expect(
        await db.trainingAttendance.count({
          where: { makeupTargetId: target.id },
        }),
      ).toBe(1);
    });

    it.each(['CANCELLED', 'LEAVE', 'ABSENT'] as const)(
      'makeup %s restores the original pending assignment without creating another owed lesson',
      async (status) => {
        const c = await makeupFixture();
        await training.scheduleMakeup(
          c.a.id,
          { enrollmentId: c.enrollment.id, makeupSessionId: c.target.id },
          coach,
        );
        const target = await db.trainingSession.findUniqueOrThrow({
          where: { id: c.target.id },
        });
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(target.startsAt);
        try {
          await training.markAttendance(
            target.id,
            {
              enrollmentId: c.enrollment.id,
              status,
              reason: '本次补课未能到场',
            },
            coach,
          );
        } finally {
          vi.useRealTimers();
        }
        expect(
          await db.trainingAttendance.findUniqueOrThrow({
            where: {
              sessionId_enrollmentId: {
                sessionId: c.a.id,
                enrollmentId: c.enrollment.id,
              },
            },
          }),
        ).toMatchObject({ status: 'MAKEUP_REQUIRED', makeupTargetId: null });
        expect(
          await db.trainingAttendance.findUniqueOrThrow({
            where: {
              sessionId_enrollmentId: {
                sessionId: target.id,
                enrollmentId: c.enrollment.id,
              },
            },
          }),
        ).toMatchObject({ status: 'CANCELLED', consumedSessions: 0 });
        const later = await session(c, 6 * hour);
        await training.scheduleMakeup(
          c.a.id,
          { enrollmentId: c.enrollment.id, makeupSessionId: later.id },
          coach,
        );
      },
    );

    it('settlement includes completed session costs and holds a stable source snapshot', async () => {
      const c = await course(200, 100, 50),
        sessionId = (await session(c)).id;
      await consume(sessionId, c.enrollment.id);
      const row = await db.trainingSession.findUniqueOrThrow({
        where: { id: sessionId },
      });
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(+row.endsAt + 2);
      try {
        await training.completeSession(sessionId, admin);
      } finally {
        vi.useRealTimers();
      }
      const draft = await training.createSettlement(
        {
          periodStart: row.startsAt.toISOString(),
          periodEnd: new Date(+row.endsAt + 10).toISOString(),
          acquisitionCostCents: 30,
          marketingCostCents: 20,
        },
        finance,
      );
      expect(draft).toMatchObject({
        effectiveRevenueCents: 1000,
        venueContributionCents: 200,
        coachCostCents: 200,
        assistantCostCents: 100,
        materialCostCents: 50,
        cashContributionMarginCents: 600,
      });
      expect(Number(draft.occupiedCourtHours)).toBe(1);
      await settle(draft.id);
    });
  },
);
