import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PrismaService } from '../src/database/prisma.service.js';
import { TrainingService } from './support/training-service-fixture.js';
import { TrainingAttendanceService } from '../src/training/attendance/training-attendance.service.js';
import { TrainingConsumptionService } from '../src/training/consumption/training-consumption.service.js';
import { TrainingBatchService } from '../src/training/batch/training-batch.service.js';
import { OrdersService } from './support/orders-fixture.js';
import { createOrderFinalizerService } from './support/domain-consumer-fixtures.js';
import type { AuthUser } from '../src/common/auth/auth-user.js';
const url = process.env.TEST_DATABASE_URL;
const key = () => randomUUID();
describe.skipIf(!url)(
  'training bulk attendance and posting on PostgreSQL',
  () => {
    let db: PrismaService,
      training: TrainingService,
      batch: TrainingBatchService,
      orders: OrdersService;
    let admin: AuthUser, coach: AuthUser;
    beforeAll(async () => {
      const target = new URL(url!);
      if (target.hostname !== '127.0.0.1' || !target.pathname.endsWith('_test'))
        throw new Error('Isolated local test database required');
      db = new PrismaService(new ConfigService({ DATABASE_URL: url }));
      await db.$connect();
      training = new TrainingService(db);
      batch = new TrainingBatchService(
        new TrainingAttendanceService(db),
        new TrainingConsumptionService(db),
      );
      orders = new OrdersService(
        db,
        new ConfigService({ PAYMENT_PROVIDER: 'mock' }),
        createOrderFinalizerService({} as never),
        {} as never,
      );
      admin = await person('ADMIN');
      coach = await person('COACH');
    });
    afterAll(async () => {
      vi.useRealTimers();
      await db?.$disconnect();
    });
    async function person(
      role: 'ADMIN' | 'COACH' | 'MEMBER',
    ): Promise<AuthUser> {
      const user = await db.user.create({
        data: {
          displayName: '批量回归',
          primaryRole: role,
          openId: key(),
          memberProfile: { create: { tags: [] } },
          accounts: { create: { type: 'CASH_PRINCIPAL', balance: 100000 } },
        },
      });
      return { sub: user.id, displayName: user.displayName, roles: [role] };
    }
    it('posts only successful members, retries partial and concurrent responses once, and keeps one ledger entry per person', async () => {
      const command = {
        name: '批量课程',
        audience: 'ADULT' as const,
        totalSessions: 10,
        validityDays: 90,
        priceCents: 10000,
        refundRule: {},
        creationIdempotencyKey: key(),
      };
      const product = await training.createProduct(command, admin);
      expect((await training.createProduct(command, admin)).code).toBe(
        product.code,
      );
      const cls = await training.createClass(
        {
          code: key(),
          name: '批量班级',
          productId: product.id,
          coachId: coach.sub,
          schedule: {},
          capacity: 10,
          coachCostCents: 0,
          assistantCostCents: 0,
          materialCostCents: 0,
        },
        admin,
      );
      const enrolled = [];
      for (let i = 0; i < 3; i++) {
        const member = await person('MEMBER');
        const order = await training.purchase(
          {
            productId: product.id,
            classId: cls.id,
            sourceChannel: 'MINI_PROGRAM',
            creationIdempotencyKey: key(),
          },
          member,
        );
        await orders.pay(
          order.id,
          { channel: 'CASH_PRINCIPAL', idempotencyKey: key() },
          member,
        );
        enrolled.push(
          await db.trainingEnrollment.findUniqueOrThrow({
            where: { orderId: order.id },
          }),
        );
      }
      const court = await db.court.create({
        data: { code: key(), name: '批量测试场地', zone: 'EAST', sortOrder: 1 },
      });
      const start = Date.now() + 86400000,
        end = start + 3600000;
      const lesson = await training.createSession(
        {
          classId: cls.id,
          courtIds: [court.id],
          startsAt: new Date(start).toISOString(),
          endsAt: new Date(end).toISOString(),
          reason: '隔离回归排课',
          creationIdempotencyKey: key(),
        },
        coach,
      );
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(end + 1000);
      const dto = {
        items: enrolled.map((item) => ({
          enrollmentId: item.id,
          idempotencyKey: key(),
        })),
      };
      expect(
        (await batch.execute(lesson.id, 'attendance', dto, coach)).results.map(
          (row) => row.status,
        ),
      ).toEqual(['SUCCEEDED', 'SUCCEEDED', 'SUCCEEDED']);
      expect(
        (await batch.execute(lesson.id, 'proposal', dto, coach)).results.every(
          (row) => row.status === 'SUCCEEDED',
        ),
      ).toBe(true);
      expect(
        await db.trainingRevenueRecognition.count({
          where: { attendance: { sessionId: lesson.id } },
        }),
      ).toBe(0);
      await db.order.update({
        where: { id: enrolled[1].orderId },
        data: { status: 'REFUND_PENDING' },
      });
      const partial = await batch.execute(
        lesson.id,
        'confirmation',
        dto,
        admin,
      );
      expect(partial.results.map((row) => row.status)).toEqual([
        'SUCCEEDED',
        'FAILED',
        'SUCCEEDED',
      ]);
      expect(
        await db.trainingRevenueRecognition.count({
          where: { attendance: { sessionId: lesson.id } },
        }),
      ).toBe(2);
      await db.order.update({
        where: { id: enrolled[1].orderId },
        data: { status: 'PAID' },
      });
      await Promise.all([
        batch.execute(lesson.id, 'confirmation', dto, admin),
        batch.execute(lesson.id, 'confirmation', dto, admin),
      ]);
      expect(
        (
          await batch.execute(lesson.id, 'confirmation', dto, admin)
        ).results.every((row) => row.status === 'SUCCEEDED'),
      ).toBe(true);
      expect(
        await db.trainingRevenueRecognition.count({
          where: { attendance: { sessionId: lesson.id } },
        }),
      ).toBe(3);
      for (const item of enrolled)
        expect(
          await db.trainingEnrollment.findUniqueOrThrow({
            where: { id: item.id },
          }),
        ).toMatchObject({
          consumedSessions: 1,
          prepaidBalanceCents: 9000,
          confirmedRevenueCents: 1000,
        });
      expect(
        await db.auditLog.count({
          where: {
            action: 'TRAINING_CONSUME_CONFIRMED',
            requestId: { in: dto.items.map((item) => item.idempotencyKey) },
          },
        }),
      ).toBe(3);
    }, 30000);
  },
);
