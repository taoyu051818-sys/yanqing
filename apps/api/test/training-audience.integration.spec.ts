import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { validate } from 'class-validator';
import { PrismaService } from '../src/database/prisma.service.js';
import { YouthTrainingRulesService } from '../src/training/youth-training-rules.service.js';
import { TrainingService } from './support/training-service-fixture.js';
import { CreateYouthTrainingRuleDto } from '../src/training/training-operations.dto.js';
import { CreateTrainingProductDto } from '../src/training/training.dto.js';
import type { AuthUser } from '../src/common/auth/auth-user.js';
import type { TrainingProduct } from '../src/generated/prisma/client.js';
const url = process.env.TEST_DATABASE_URL;
const key = () => randomUUID();
describe.skipIf(!url)(
  'mixed-audience courses and staff-created learners on PostgreSQL',
  () => {
    let db: PrismaService,
      training: TrainingService,
      admin: AuthUser,
      guardian: AuthUser,
      stranger: AuthUser;
    let product: TrainingProduct, student: { id: string }, ruleId: string;
    beforeAll(async () => {
      const target = new URL(url!);
      if (target.hostname !== '127.0.0.1' || !target.pathname.endsWith('_test'))
        throw new Error('Isolated local test database required');
      db = new PrismaService(new ConfigService({ DATABASE_URL: url }));
      await db.$connect();
      async function person(role: 'ADMIN' | 'MEMBER'): Promise<AuthUser> {
        const user = await db.user.create({
          data: { displayName: '试听回归学员', primaryRole: role },
        });
        return { sub: user.id, displayName: user.displayName, roles: [role] };
      }
      admin = await person('ADMIN');
      guardian = await person('MEMBER');
      stranger = await person('MEMBER');
      const rule = await db.youthTrainingRule.create({
        data: {
          version: key(),
          status: 'PUBLISHED',
          maxTotalSessions: 100,
          maxValidityDays: 365,
          maxContractAmountCents: 1000000,
          warningThresholdDays: 10,
          hardBlock: true,
          effectiveFrom: new Date(),
          requestedById: admin.sub,
          requestReason: 'isolated acceptance',
          requestIdempotencyKey: key(),
          commandHash: 'a'.repeat(64),
          reviewedById: admin.sub,
          reviewedAt: new Date(),
          reviewReason: 'isolated acceptance',
          decisionIdempotencyKey: key(),
          decisionCommandHash: 'b'.repeat(64),
        },
      });
      ruleId = rule.id;
      training = new TrainingService(db, new YouthTrainingRulesService(db));
    });
    afterAll(async () => {
      if (ruleId)
        await db.youthTrainingRule.deleteMany({
          where: { requestedById: admin.sub },
        });
      await db?.$disconnect();
    });
    it('accepts ALL through DTO, persists the product without an optional reason and replays it', async () => {
      const command = Object.assign(new CreateTrainingProductDto(), {
        code: key(),
        name: '成人与青少年一对一',
        audience: 'ALL',
        totalSessions: 12,
        validityDays: 120,
        priceCents: 128000,
        refundRule: { beforeStart: 'FULL_REFUND' },
        creationIdempotencyKey: key(),
      });
      expect(await validate(command)).toEqual([]);
      product = await training.createProduct(command, admin);
      expect(product.audience).toBe('ALL');
      expect((await training.createProduct(command, admin)).id).toBe(
        product.id,
      );
      expect(
        await db.auditLog.count({
          where: { action: 'TRAINING_PRODUCT_CREATED', objectId: product.id },
        }),
      ).toBe(1);
    });
    it('reports a duplicate product code clearly and leaves no extra product', async () => {
      await expect(
        training.createProduct(
          {
            code: product.code,
            name: '重复编码',
            audience: 'ADULT',
            totalSessions: 12,
            validityDays: 120,
            priceCents: 128000,
            refundRule: {},
          },
          admin,
        ),
      ).rejects.toThrow('课程产品编码已存在');
      expect(
        await db.trainingProduct.count({ where: { code: product.code } }),
      ).toBe(1);
    });
    it('registers an entered learner name against the selected guardian, not the staff account', async () => {
      student = await training.createStudent(
        {
          displayName: ' 试听新学员 ',
          guardianId: guardian.sub,
          guardianConsentStatus: true,
          authorizationNote: '工作人员确认监护人同意建档和预约试听',
        },
        admin,
      );
      expect(student).toMatchObject({
        displayName: '试听新学员',
        guardianId: guardian.sub,
      });
      expect(await training.listStudents(guardian)).toEqual(
        expect.arrayContaining([expect.objectContaining({ id: student.id })]),
      );
      expect(await training.listStudents(stranger)).not.toEqual(
        expect.arrayContaining([expect.objectContaining({ id: student.id })]),
      );
    });
    it('creates distinct adult and youth orders, keeps their subjects on retry and enforces guardianship', async () => {
      const base = {
        productId: product.id,
        sourceChannel: 'MINI_PROGRAM' as const,
      };
      const adult = await training.purchase(
        { ...base, creationIdempotencyKey: key() },
        guardian,
      );
      const command = {
        ...base,
        studentId: student.id,
        creationIdempotencyKey: key(),
      };
      const child = await training.purchase(command, guardian);
      expect(child.id).not.toBe(adult.id);
      expect((await training.purchase(command, guardian)).id).toBe(child.id);
      expect(
        await db.trainingEnrollment.findUnique({
          where: { orderId: adult.id },
        }),
      ).toMatchObject({ studentId: null, buyerId: guardian.sub });
      expect(
        await db.trainingEnrollment.findUnique({
          where: { orderId: child.id },
        }),
      ).toMatchObject({ studentId: student.id, buyerId: guardian.sub });
      await expect(
        training.purchase(
          { ...command, creationIdempotencyKey: key() },
          stranger,
        ),
      ).rejects.toThrow('学员不存在或监护人授权未完成');
    });
    it('publishes immediately between the current and scheduled rules, preserves boundaries and replays once', async () => {
      const service = new YouthTrainingRulesService(db);
      const scheduledTime = new Date(Date.now() + 86400000);
      const values = {
        maxTotalSessions: 100,
        maxValidityDays: 999,
        maxContractAmountCents: 9999900,
        warningThresholdDays: 60,
        hardBlock: false,
        reason: '管理员设置课包限制',
      };
      const future = await service.create(
        {
          ...values,
          effectiveFrom: scheduledTime.toISOString(),
          idempotencyKey: key(),
        },
        admin,
      );
      const dto = Object.assign(new CreateYouthTrainingRuleDto(), {
        ...values,
        effectiveImmediately: true,
        idempotencyKey: key(),
      });
      expect(await validate(dto)).toEqual([]);
      const current = await service.create(dto, admin);
      expect(current.effectiveFrom.getTime()).toBeLessThanOrEqual(Date.now());
      expect(current.effectiveTo).toEqual(scheduledTime);
      expect((await service.active())?.id).toBe(current.id);
      expect((await service.active(scheduledTime))?.id).toBe(future.id);
      expect((await service.create(dto, admin)).id).toBe(current.id);
      expect(
        await db.youthTrainingRule.count({
          where: { requestIdempotencyKey: dto.idempotencyKey },
        }),
      ).toBe(1);
      expect(
        (
          await db.youthTrainingRule.findUniqueOrThrow({
            where: { id: ruleId },
          })
        ).effectiveTo,
      ).toEqual(current.effectiveFrom);
      const replayBefore = await db.youthTrainingRule.findUniqueOrThrow({
        where: { id: future.id },
      });
      expect(replayBefore.effectiveFrom).toEqual(scheduledTime);
      expect(replayBefore.maxValidityDays).toBe(999);
      await expect(
        service.create({ ...dto, maxValidityDays: 998 }, admin),
      ).rejects.toThrow('幂等键');
      await expect(
        service.create(
          {
            ...dto,
            idempotencyKey: key(),
            effectiveFrom: scheduledTime.toISOString(),
          },
          admin,
        ),
      ).rejects.toThrow('无需指定');
    });
  },
);
