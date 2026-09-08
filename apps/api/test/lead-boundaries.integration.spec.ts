import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PrismaService } from '../src/database/prisma.service.js';
import { MembersService } from '../src/members/members.service.js';
import { AllianceService } from '../src/alliance/alliance.service.js';
import { TrainingService } from '../src/training/training.service.js';
import { TrainingTrialsService } from '../src/training/training-trials.service.js';
import { OrdersService } from '../src/orders/orders.service.js';
import { OrderFinalizerService } from '../src/payments/order-finalizer.service.js';
import type { AuthUser } from '../src/common/auth/auth-user.js';
import type { AppRole } from '../src/generated/prisma/client.js';

const url = process.env.TEST_DATABASE_URL;
const key = () => 'r7-' + randomUUID();
const day = 86400000,
  hour = 3600000;
const capture = <T>(p: Promise<T>) =>
  p.then(
    (value) => ({ value, error: undefined }),
    (error) => ({ value: undefined, error }),
  );
function latch() {
  let signal!: () => void;
  const promise = new Promise<void>((resolve) => {
    signal = resolve;
  });
  return { promise, signal };
}
// Uses real services and SQL; gates only control the ordering of concurrent requests.
describe.skipIf(!url)(
  'lead and merchant lifecycle boundaries on PostgreSQL',
  () => {
    let db: PrismaService, members: MembersService, alliance: AllianceService;
    let training: TrainingService, trials: TrainingTrialsService;
    let admin: AuthUser, coach: AuthUser, buyer: AuthUser;
    beforeAll(async () => {
      const target = new URL(url!);
      if (
        !['localhost', '127.0.0.1'].includes(target.hostname) ||
        !target.pathname.endsWith('_test')
      )
        throw new Error('Local isolated test database only');
      db = new PrismaService(new ConfigService({ DATABASE_URL: url }));
      await db.$connect();
      members = new MembersService(db);
      alliance = new AllianceService(db);
      training = new TrainingService(db);
      trials = new TrainingTrialsService(db);
      admin = await person('SUPER_ADMIN');
      coach = await person('COACH');
      buyer = await person('MEMBER');
    });
    afterAll(async () => {
      vi.useRealTimers();
      if (db) await db.$disconnect();
    });
    async function person(role: AppRole): Promise<AuthUser> {
      const u = await db.user.create({
        data: {
          displayName: '第七轮隔离审查',
          primaryRole: role,
          memberProfile:
            role === 'MEMBER' ? { create: { tags: [] } } : undefined,
        },
      });
      return { sub: u.id, displayName: u.displayName, roles: [role] };
    }
    const lead = (campaign = key()) =>
      members.createLead(
        {
          displayName: '隔离线索',
          sourceChannel: 'OTHER',
          campaign,
        },
        admin,
      );
    const funnel = () =>
      members.leadFunnel({
        from: new Date(Date.now() - day).toISOString(),
        to: new Date(Date.now() + day).toISOString(),
      });

    it('keeps converted funnel counts after archiving', async () => {
      const l = await lead();
      await members.addLeadFollowUp(
        l.id,
        {
          kind: '电话',
          content: '完成试听跟进',
          nextStatus: 'ATTENDED',
        },
        admin,
      );
      await members.convertLead(l.id, { memberId: buyer.sub }, admin);
      const before = (await funnel()).campaigns.find(
        (x) => x.campaign === l.campaign,
      )!;
      expect(before.converted).toBe(1);
      await members.archiveLead(l.id, { reason: '常规归档' }, admin);
      const after = (await funnel()).campaigns.find(
        (x) => x.campaign === l.campaign,
      )!;
      expect(after.leads).toBe(1);
      expect(after.converted).toBe(1);
      const row = await db.customerLead.findUniqueOrThrow({
        where: { id: l.id },
      });
      expect(row.convertedMemberId).toBe(buyer.sub);
      expect(row.convertedAt).not.toBeNull();
    });

    it('keeps lost funnel counts after archiving', async () => {
      const l = await lead();
      await members.loseLead(l.id, { reason: '暂无需求' }, admin);
      const before = (await funnel()).campaigns.find(
        (x) => x.campaign === l.campaign,
      )!;
      await members.archiveLead(l.id, { reason: '常规归档' }, admin);
      const after = (await funnel()).campaigns.find(
        (x) => x.campaign === l.campaign,
      )!;
      expect(before.lost).toBe(1);
      expect(after.lost).toBe(1);
    });

    it('duplicate active phone is rejected by service and database', async () => {
      const dto = {
        displayName: '唯一线索',
        sourceChannel: 'OTHER' as const,
        phone: key().slice(0, 25),
      };
      const results = await Promise.allSettled([
        members.createLead(dto, admin),
        members.createLead(dto, admin),
      ]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const failed = results.find((r) => r.status === 'rejected')!;
      if (failed.status === 'rejected')
        expect(failed.reason.getStatus()).toBe(409);
      expect(await db.customerLead.count({ where: { phone: dto.phone } })).toBe(
        1,
      );
    });

    it('sequential assignment rejects a converted terminal lead', async () => {
      const l = await lead();
      await members.convertLead(l.id, { memberId: buyer.sub }, admin);
      await expect(
        members.assignLead(l.id, { ownerId: coach.sub }, admin),
      ).rejects.toMatchObject({ status: 409 });
    });

    it('rejects assignment when another request converts the lead', async () => {
      const l = await lead();
      const read = latch(),
        resume = latch();
      let stopped = false;
      const instrumented = db.$extends({
        query: {
          customerLead: {
            findUnique: async ({ args, query }) => {
              const result = await query(args);
              if (!stopped && args.where.id === l.id) {
                stopped = true;
                read.signal();
                await resume.promise;
              }
              return result;
            },
          },
        },
      });
      const assigning = capture(
        new MembersService(instrumented as never).assignLead(
          l.id,
          { ownerId: coach.sub },
          admin,
        ),
      );
      await read.promise;
      try {
        await members.convertLead(l.id, { memberId: buyer.sub }, admin);
      } finally {
        resume.signal();
      }
      const result = await assigning;
      expect(result.error).toMatchObject({ status: 409 });
      const row = await db.customerLead.findUniqueOrThrow({
        where: { id: l.id },
      });
      expect(row.status).toBe('CONVERTED');
      expect(row.ownerId).toBeNull();
      expect(
        await db.auditLog.count({
          where: { objectId: l.id, action: 'CUSTOMER_LEAD_ASSIGNED' },
        }),
      ).toBe(0);
    });

    async function couponFixture() {
      const merchant = await alliance.createMerchant(
        {
          code: key(),
          name: '隔离商户',
          category: '餐饮',
          level: 'TRAFFIC_PARTNER',
          settlementRule: { mode: 'PER_REDEMPTION', amountCents: 1000 },
        },
        admin,
      );
      const template = await alliance.createTemplate(
        {
          code: key(),
          merchantId: merchant.id,
          name: '隔离券',
          activityName: '隔离活动',
          benefitDescription: '隔离核销权益',
          faceValueCents: 0,
          allowVenueBooking: false,
          validFrom: new Date(Date.now() - day).toISOString(),
          validTo: new Date(Date.now() + day).toISOString(),
          claimLimitPerUser: 1,
          issueLimit: 10,
        },
        admin,
      );
      const batch = await alliance.generateCodes(
        template.id,
        { count: 1, idempotencyKey: key() },
        admin,
      );
      await alliance.claim(batch.codes[0], buyer);
      return {
        merchant,
        template,
        command: {
          code: batch.codes[0],
          merchantId: merchant.id,
          attributedAmountCents: 10000,
          idempotencyKey: key(),
        },
      };
    }

    it('a merchant disabled before redemption is rejected', async () => {
      const f = await couponFixture();
      await alliance.setMerchantStatus(
        f.merchant.id,
        {
          status: 'DISABLED',
          reason: '暂停合作',
          idempotencyKey: key(),
        },
        admin,
      );
      await expect(alliance.redeem(f.command, admin)).rejects.toMatchObject({
        status: 409,
      });
      const row = await db.couponCode.findUniqueOrThrow({
        where: { code: f.command.code },
      });
      expect(row.status).toBe('CLAIMED');
    });

    it('rejects redemption if merchant was disabled after preflight', async () => {
      const f = await couponFixture();
      const read = latch(),
        resume = latch();
      let stopped = false;
      const instrumented = db.$extends({
        query: {
          merchant: {
            findUnique: async ({ args, query }) => {
              const result = await query(args);
              if (!stopped && args.where.id === f.merchant.id) {
                stopped = true;
                read.signal();
                await resume.promise;
              }
              return result;
            },
          },
        },
      });
      const redeeming = capture(
        new AllianceService(instrumented as never).redeem(f.command, admin),
      );
      await read.promise;
      try {
        await alliance.setMerchantStatus(
          f.merchant.id,
          {
            status: 'DISABLED',
            reason: '暂停合作',
            idempotencyKey: key(),
          },
          admin,
        );
      } finally {
        resume.signal();
      }
      const result = await redeeming;
      expect(result.error).toMatchObject({ status: 409 });
      expect(
        (await db.merchant.findUniqueOrThrow({ where: { id: f.merchant.id } }))
          .status,
      ).toBe('DISABLED');
      const row = await db.couponCode.findUniqueOrThrow({
        where: { code: f.command.code },
      });
      expect(row.status).toBe('CLAIMED');
      expect(row.attributedAmountCents).toBe(0);
      expect(
        (
          await db.couponTemplate.findUniqueOrThrow({
            where: { id: f.template.id },
          })
        ).redeemedCount,
      ).toBe(0);
    });

    let fixtureDay = 0;
    async function trialFixture(service = trials) {
      const l = await lead();
      const start = new Date(Date.now() + (++fixtureDay + 1) * day);
      const end = new Date(+start + hour);
      const product = await training.createProduct(
        {
          code: key(),
          name: '隔离成人试听产品',
          audience: 'ADULT',
          totalSessions: 10,
          validityDays: 90,
          priceCents: 10000,
          refundRule: {},
        },
        admin,
      );
      const c = await training.createClass(
        {
          code: key(),
          productId: product.id,
          name: '隔离试听班',
          coachId: coach.sub,
          schedule: {},
          capacity: 10,
          coachCostCents: 0,
          assistantCostCents: 0,
          materialCostCents: 0,
        },
        admin,
      );
      const court = await db.court.create({
        data: {
          code: key(),
          name: '隔离试听场地',
          zone: 'EAST',
          sortOrder: 1,
        },
      });
      const session = await training.createSession(
        {
          classId: c.id,
          courtIds: [court.id],
          startsAt: start.toISOString(),
          endsAt: end.toISOString(),
          reason: '隔离排课',
          creationIdempotencyKey: key(),
        },
        admin,
      );
      const trial = await service.create(
        {
          leadId: l.id,
          productId: product.id,
          classId: c.id,
          sessionId: session.id,
          coachId: coach.sub,
          sourceChannel: 'OTHER',
          scheduledStartsAt: start.toISOString(),
          scheduledEndsAt: end.toISOString(),
          reason: '隔离试听预约',
          idempotencyKey: key(),
        },
        admin,
      );
      return { l, start, trial, product, trainingClass: c };
    }

    it('unconverted lead can check in to its reserved trial', async () => {
      const f = await trialFixture();
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(f.start);
      try {
        const result = await trials.checkIn(
          f.trial.id,
          { reason: '到场签到', idempotencyKey: key() },
          admin,
        );
        expect(result.status).toBe('CHECKED_IN');
        expect(
          (await db.customerLead.findUniqueOrThrow({ where: { id: f.l.id } }))
            .status,
        ).toBe('ATTENDED');
      } finally {
        vi.useRealTimers();
      }
    });

    it('allows converted lead to check in without changing its terminal state', async () => {
      const f = await trialFixture();
      await members.convertLead(f.l.id, { memberId: buyer.sub }, admin);
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(f.start);
      try {
        const result = await capture(
          trials.checkIn(
            f.trial.id,
            { reason: '到场签到', idempotencyKey: key() },
            admin,
          ),
        );
        expect(result.error).toBeUndefined();
        expect(result.value?.status).toBe('CHECKED_IN');
        expect(
          (
            await db.trainingTrial.findUniqueOrThrow({
              where: { id: f.trial.id },
            })
          ).status,
        ).toBe('CHECKED_IN');
        expect(
          (await db.customerLead.findUniqueOrThrow({ where: { id: f.l.id } }))
            .status,
        ).toBe('CONVERTED');
      } finally {
        vi.useRealTimers();
      }
    });

    it('keeps original conversion time when cancelling a trial', async () => {
      const f = await trialFixture();
      const converted = await members.convertLead(
        f.l.id,
        { memberId: buyer.sub },
        admin,
      );
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(f.start);
      try {
        await trials.cancel(
          f.trial.id,
          { reason: '取消试听预约', idempotencyKey: key() },
          admin,
        );
        const row = await db.customerLead.findUniqueOrThrow({
          where: { id: f.l.id },
        });
        expect(row.status).toBe('CONVERTED');
        expect(row.convertedMemberId).toBe(buyer.sub);
        expect(row.convertedAt).toEqual(converted.convertedAt);
      } finally {
        vi.useRealTimers();
      }
    });

    it('records one assignment and rejects a second stale assignment', async () => {
      const l = await lead(),
        other = await person('FRONT_DESK');
      const read = latch(),
        resume = latch();
      let arrivals = 0;
      const gated = db.$extends({
        query: {
          customerLead: {
            findUnique: async ({ args, query }) => {
              const row = await query(args);
              if (args.where.id === l.id && ++arrivals <= 2) {
                if (arrivals === 2) read.signal();
                await resume.promise;
              }
              return row;
            },
          },
        },
      });
      const service = new MembersService(gated as never);
      const a = capture(
        service.assignLead(l.id, { ownerId: coach.sub }, admin),
      );
      const b = capture(
        service.assignLead(l.id, { ownerId: other.sub }, admin),
      );
      await read.promise;
      resume.signal();
      const results = await Promise.all([a, b]);
      expect(results.filter((x) => !x.error)).toHaveLength(1);
      expect(results.find((x) => x.error)?.error).toMatchObject({
        status: 409,
      });
      const audits = await db.auditLog.findMany({
        where: { objectId: l.id, action: 'CUSTOMER_LEAD_ASSIGNED' },
      });
      expect(audits).toHaveLength(1);
      expect(audits[0].oldValue).toEqual({ ownerId: null });
      expect(audits[0].newValue).toEqual({
        ownerId: (
          await db.customerLead.findUniqueOrThrow({ where: { id: l.id } })
        ).ownerId,
      });
    });

    it('allows an already locked redemption to finish before merchant disable commits', async () => {
      const f = await couponFixture(),
        locked = latch(),
        resume = latch();
      const gated = db.$extends({
        query: {
          $allOperations: async ({ operation, args, query }) => {
            const result = await query(args);
            if (operation === '$queryRaw') {
              locked.signal();
              await resume.promise;
            }
            return result;
          },
        },
      });
      const redeeming = capture(
        new AllianceService(gated as never).redeem(f.command, admin),
      );
      await locked.promise;
      const disableCommand = {
        status: 'DISABLED',
        reason: '结束商户合作',
        idempotencyKey: key(),
      } as const;
      const disabling = capture(
        alliance.setMerchantStatus(f.merchant.id, disableCommand, admin),
      );
      let blocked = false;
      try {
        const deadline = Date.now() + 3000;
        while (Date.now() < deadline) {
          const rows = await db.$queryRaw<Array<{ blocked: boolean }>>`
          SELECT EXISTS(SELECT 1 FROM pg_stat_activity
          WHERE datname = current_database() AND wait_event_type = 'Lock'
          AND query LIKE '%Merchant%') AS blocked`;
          if (rows[0].blocked) {
            blocked = true;
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
      } finally {
        resume.signal();
      }
      const [redeemed, disabled] = await Promise.all([redeeming, disabling]);
      expect(blocked).toBe(true);
      expect(redeemed.error).toBeUndefined();
      expect(redeemed.value?.status).toBe('REDEEMED');
      if (disabled.error) {
        expect(disabled.error.getStatus()).toBe(409);
        expect(
          (
            await db.merchant.findUniqueOrThrow({
              where: { id: f.merchant.id },
            })
          ).status,
        ).toBe('ACTIVE');
      }
      expect(
        (await alliance.setMerchantStatus(f.merchant.id, disableCommand, admin))
          .status,
      ).toBe('DISABLED');
    }, 15000);

    it('keeps redemption retries idempotent across concurrent requests and later disable', async () => {
      const f = await couponFixture();
      const results = await Promise.all([
        capture(alliance.redeem(f.command, admin)),
        capture(alliance.redeem(f.command, admin)),
      ]);
      expect(results.some((x) => x.value?.status === 'REDEEMED')).toBe(true);
      for (const result of results)
        if (result.error) expect(result.error.getStatus()).toBe(409);
      await alliance.setMerchantStatus(
        f.merchant.id,
        {
          status: 'DISABLED',
          reason: '暂停合作',
          idempotencyKey: key(),
        },
        admin,
      );
      const replay = await alliance.redeem(f.command, admin);
      expect(replay.status).toBe('REDEEMED');
      expect(
        (
          await db.couponTemplate.findUniqueOrThrow({
            where: { id: f.template.id },
          })
        ).redeemedCount,
      ).toBe(1);
      expect(
        await db.auditLog.count({
          where: { objectId: replay.id, action: 'ALLIANCE_COUPON_REDEEMED' },
        }),
      ).toBe(1);
      await expect(
        alliance.redeem({ ...f.command, attributedAmountCents: 20000 }, admin),
      ).rejects.toMatchObject({ status: 409 });
    });

    it.each(['LOST', 'ARCHIVED'] as const)(
      'preserves %s lead history during attendance and assessment',
      async (state) => {
        const f = await trialFixture();
        await members.loseLead(f.l.id, { reason: '暂不购买正式课程' }, admin);
        if (state === 'ARCHIVED')
          await members.archiveLead(f.l.id, { reason: '整理历史线索' }, admin);
        const before = await db.customerLead.findUniqueOrThrow({
          where: { id: f.l.id },
        });
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(f.start);
        try {
          await trials.checkIn(
            f.trial.id,
            { reason: '客户仍按约体验', idempotencyKey: key() },
            admin,
          );
          await trials.assess(
            f.trial.id,
            {
              reason: '完成现场测评',
              idempotencyKey: key(),
              recommendation: '建议加强发球练习',
              dimensions: [{ key: 'serve', label: '发球', score: 3 }],
            },
            coach,
          );
          const after = await db.customerLead.findUniqueOrThrow({
            where: { id: f.l.id },
          });
          expect(after).toEqual(before);
          const evidence = await db.leadFollowUp.findMany({
            where: {
              leadId: f.l.id,
              kind: { in: ['TRIAL_CHECK_IN', 'TRIAL_ASSESS'] },
            },
          });
          expect(evidence).toHaveLength(2);
          expect(
            evidence.every(
              (x) => x.statusBefore === state && x.statusAfter === state,
            ),
          ).toBe(true);
        } finally {
          vi.useRealTimers();
        }
      },
    );

    it('rechecks lead state when it changes during trial reservation preflight', async () => {
      const read = latch(),
        resume = latch();
      let leadId: string | undefined;
      const gated = db.$extends({
        query: {
          customerLead: {
            findUnique: async ({ args, query }) => {
              const row = await query(args);
              if (!leadId && row) {
                leadId = row.id;
                read.signal();
                await resume.promise;
              }
              return row;
            },
          },
        },
      });
      const reserving = capture(
        trialFixture(new TrainingTrialsService(gated as never)),
      );
      await read.promise;
      try {
        await members.convertLead(leadId!, { memberId: buyer.sub }, admin);
      } finally {
        resume.signal();
      }
      expect((await reserving).error).toMatchObject({ status: 409 });
      expect(await db.trainingTrial.count({ where: { leadId } })).toBe(0);
    });

    it('completes a paid trial conversion after the lead has already become a member', async () => {
      const f = await trialFixture();
      const converted = await members.convertLead(
        f.l.id,
        { memberId: buyer.sub },
        admin,
      );
      await members.archiveLead(
        f.l.id,
        { reason: '客户已完成注册归档' },
        admin,
      );
      const before = await db.customerLead.findUniqueOrThrow({
        where: { id: f.l.id },
      });
      await db.account.create({
        data: { userId: buyer.sub, type: 'CASH_PRINCIPAL', balance: 100000 },
      });
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(f.start);
      try {
        await trials.checkIn(
          f.trial.id,
          { reason: '到场试听', idempotencyKey: key() },
          admin,
        );
        await trials.assess(
          f.trial.id,
          {
            reason: '完成测评',
            idempotencyKey: key(),
            recommendation: '建议报名基础班',
            dimensions: [{ key: 'serve', label: '发球', score: 3 }],
          },
          coach,
        );
        const order = await training.purchase(
          {
            productId: f.product.id,
            classId: f.trainingClass.id,
            sourceChannel: 'OTHER',
            creationIdempotencyKey: key(),
          },
          buyer,
        );
        const orders = new OrdersService(
          db,
          new ConfigService({ PAYMENT_PROVIDER: 'wechat' }),
          new OrderFinalizerService({} as never),
          {} as never,
        );
        await orders.pay(
          order.id,
          { channel: 'CASH_PRINCIPAL', idempotencyKey: key() },
          buyer,
        );
        const enrollment = await db.trainingEnrollment.findUniqueOrThrow({
          where: { orderId: order.id },
        });
        const command = {
          enrollmentId: enrollment.id,
          reason: '已付正式课学费',
          idempotencyKey: key(),
        };
        const result = await trials.convert(f.trial.id, command, admin);
        expect(result.status).toBe('CONVERTED');
        expect((await trials.convert(f.trial.id, command, admin)).id).toBe(
          result.id,
        );
        const after = await db.customerLead.findUniqueOrThrow({
          where: { id: f.l.id },
        });
        expect(after).toEqual(before);
        expect(after.convertedAt).toEqual(converted.convertedAt);
      } finally {
        vi.useRealTimers();
      }
    });
  },
);
