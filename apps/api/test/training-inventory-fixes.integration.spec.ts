import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PrismaService } from '../src/database/prisma.service.js';
import type { AuthUser } from '../src/common/auth/auth-user.js';
import type { AppRole } from '../src/generated/prisma/client.js';
import { TrainingService } from './support/training-service-fixture.js';
import { OrdersService } from './support/orders-fixture.js';
import { createOrderFinalizerService } from './support/domain-consumer-fixtures.js';
import { createSettlement } from '../src/training/settlements/training-settlements.js';
import { list as listMembers } from '../src/members/directory/members-directory.commands.js';
import { profile } from '../src/members/directory/member-profile.query.js';
import { update as updateItem } from '../src/inventory/catalog/inventory-catalog.commands.js';
import {
  applyGoodsSale,
  restoreGoodsSale,
} from '../src/inventory/goods-stock.js';
import {
  countStocktakeLine,
  submitStocktake,
  postStocktake,
} from '../src/inventory/stocktaking/inventory-operations-stocktaking.commands.js';
import {
  loadInventory,
  mapInventoryWorkItems,
} from '../src/work-items/domains/inventory.js';

const url = process.env.TEST_DATABASE_URL;
const key = () => `fix-${randomUUID()}`;
const hour = 3_600_000;
const day = 24 * hour;
const periodBase =
  Date.UTC(2040, 0, 1) +
  (parseInt(randomUUID().slice(0, 8), 16) % 100_000) * 12 * day;
const capture = <T>(p: Promise<T>) =>
  p.then(
    (value) => ({ value, error: undefined }),
    (error) => ({ value: undefined, error }),
  );
function latch() {
  let release!: () => void;
  return {
    promise: new Promise<void>((resolve) => {
      release = resolve;
    }),
    release: () => release(),
  };
}
// Real PostgreSQL and production domain functions. No HTTP, WeChat or external
// money. Initial identities, opening inventory and financial source rows are fixtures.
describe.skipIf(!url)(
  '2026-09-12 training, member and inventory regressions on PostgreSQL',
  () => {
    let db: PrismaService, training: TrainingService, orders: OrdersService;
    let admin: AuthUser, checker: AuthUser, coach: AuthUser;
    let location: { id: string }, supplier: { id: string; name: string };
    let fixtureDay = 0;
    beforeAll(async () => {
      const target = new URL(url!);
      if (
        !['127.0.0.1', 'localhost'].includes(target.hostname) ||
        !target.pathname.endsWith('_test')
      )
        throw new Error('Local isolated test database required');
      db = new PrismaService(new ConfigService({ DATABASE_URL: url }));
      await db.$connect();
      training = new TrainingService(db);
      orders = new OrdersService(
        db,
        new ConfigService({ PAYMENT_PROVIDER: 'wechat' }),
        createOrderFinalizerService({} as never),
        {} as never,
      );
      admin = await person('ADMIN');
      checker = await person('ADMIN');
      coach = await person('COACH');
      location = await db.inventoryLocation.create({
        data: { code: key(), name: 'Fix regression location' },
      });
      supplier = await db.supplier.create({
        data: {
          code: key(),
          name: 'Fix regression supplier',
          type: 'OWNED',
          settlementRule: { settlementCycle: 'MONTHLY', paymentTermsDays: 30 },
        },
      });
    });
    afterAll(async () => {
      vi.useRealTimers();
      if (db) await db.$disconnect();
    });
    async function person(role: AppRole = 'MEMBER'): Promise<AuthUser> {
      const row = await db.user.create({
        data: {
          displayName: key(),
          primaryRole: role,
          memberProfile: { create: { tags: [] } },
          accounts: { create: { type: 'CASH_PRINCIPAL', balance: 1_000_000 } },
        },
      });
      return { sub: row.id, displayName: row.displayName, roles: [role] };
    }
    async function item(stock: number, expiresAt: Date | null = null) {
      return db.inventoryItem.create({
        data: {
          sku: key(),
          name: key(),
          category: 'Regression',
          mode: 'PURCHASE',
          supplier: supplier.name,
          supplierId: supplier.id,
          defaultLocationId: location.id,
          batchCode: 'DEFAULT',
          expiresAt,
          purchasePriceCents: 100,
          salePriceCents: 200,
          stock,
          stockBalances: {
            create: {
              locationId: location.id,
              batchCode: 'DEFAULT',
              expiresAt,
              quantity: stock,
            },
          },
        },
      });
    }
    async function sourceCourse(totalSessions = 1, priceCents = 19800) {
      const product = await db.trainingProduct.create({
        data: {
          code: key(),
          name: key(),
          audience: 'ADULT',
          totalSessions,
          validityDays: 365,
          priceCents,
          unitRevenueCents: Math.floor(priceCents / totalSessions),
          refundRule: {},
        },
      });
      const klass = await db.trainingClass.create({
        data: {
          code: key(),
          name: key(),
          productId: product.id,
          coachId: coach.sub,
          capacity: 10,
          schedule: {},
        },
      });
      return { product, klass };
    }
    async function recognizedRows(amounts: number[]) {
      const { product, klass } = await sourceCourse(
        amounts.length,
        amounts.reduce((a, b) => a + b, 0),
      );
      // Unique isolated future periods keep source-ledger aggregates independent.
      const start = new Date(periodBase + ++fixtureDay * 3 * day);
      const end = new Date(+start + 3 * day);
      const enrollment = await db.trainingEnrollment.create({
        data: {
          enrollmentNo: key(),
          contractNo: key(),
          productId: product.id,
          classId: klass.id,
          buyerId: admin.sub,
          totalSessions: amounts.length,
          consumedSessions: amounts.length,
          totalAmountCents: product.priceCents,
          prepaidBalanceCents: 0,
          confirmedRevenueCents: product.priceCents,
          status: 'COMPLETED',
          startsAt: start,
          expiresAt: end,
        },
      });
      const recognitions = [];
      for (const [n, amount] of amounts.entries()) {
        const session = await db.trainingSession.create({
          data: {
            classId: klass.id,
            startsAt: new Date(+start + n * hour),
            endsAt: new Date(+start + (n + 1) * hour),
            status: 'COMPLETED',
            courtCount: 1,
            occupiedCourtHours: 1,
          },
        });
        const attendance = await db.trainingAttendance.create({
          data: {
            sessionId: session.id,
            enrollmentId: enrollment.id,
            status: 'ATTENDED',
            consumedSessions: 1,
            confirmedRevenueCents: amount,
            operatorId: coach.sub,
            consumedAt: session.endsAt,
          },
        });
        recognitions.push(
          await db.trainingRevenueRecognition.create({
            data: {
              attendanceId: attendance.id,
              enrollmentId: enrollment.id,
              effectiveRevenueCents: amount,
              venueContributionCents: Math.round(amount * 0.2),
              idempotencyKey: key(),
              createdAt: session.endsAt,
            },
          }),
        );
      }
      return { start, end, enrollment, recognitions };
    }
    it.each([1073741, 1073742])(
      'accepts %i cents and its signed reversal without int32 intermediate overflow',
      async (amount) => {
        const f = await recognizedRows([amount]);
        const source = f.recognitions[0];
        const reversal = await db.trainingRevenueRecognition.create({
          data: {
            attendanceId: source.attendanceId,
            enrollmentId: f.enrollment.id,
            type: 'REVERSAL',
            sequence: 2,
            reversalOfId: source.id,
            effectiveRevenueCents: -amount,
            venueContributionCents: -Math.round(amount * 0.2),
            idempotencyKey: key(),
            createdAt: new Date(+f.end - 1),
          },
        });
        expect(reversal.venueContributionCents).toBe(-Math.round(amount * 0.2));
        const draft = await createSettlement(
          db,
          {
            periodStart: f.start.toISOString(),
            periodEnd: new Date(+f.start + 2 * hour).toISOString(),
            acquisitionCostCents: 0,
            marketingCostCents: 0,
          },
          admin,
        );
        expect(draft.effectiveRevenueCents).toBe(amount);
        expect(draft.venueContributionCents).toBe(Math.round(amount * 0.2));
        const reversed = await createSettlement(
          db,
          {
            periodStart: new Date(+f.start + 2 * hour).toISOString(),
            periodEnd: f.end.toISOString(),
            acquisitionCostCents: 0,
            marketingCostCents: 0,
          },
          admin,
        );
        expect(reversed.effectiveRevenueCents).toBe(-amount);
        expect(reversed.venueContributionCents).toBe(-Math.round(amount * 0.2));
        await expect(
          db.trainingRevenueRecognition.update({
            where: { id: source.id },
            data: { venueContributionCents: 0 },
          }),
        ).rejects.toMatchObject({ code: 'P2039' });
      },
    );
    it('settles 55 ordinary ¥198 lessons with the correct ¥2,178 contribution', async () => {
      const f = await recognizedRows(Array(55).fill(19800));
      const draft = await createSettlement(
        db,
        {
          periodStart: f.start.toISOString(),
          periodEnd: f.end.toISOString(),
          acquisitionCostCents: 0,
          marketingCostCents: 0,
        },
        admin,
      );
      expect(draft).toMatchObject({
        effectiveRevenueCents: 1089000,
        venueContributionCents: 217800,
      });
      expect(
        await db.trainingRevenueRecognition.count({
          where: { settlementId: draft.id },
        }),
      ).toBe(55);
    });
    it('reopens a completed class only on approved correction, then re-proposes, confirms and completes it', async () => {
      const f = await sourceCourse();
      const buyer = await person();
      const order = await training.purchase(
        {
          productId: f.product.id,
          classId: f.klass.id,
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
      const court = await db.court.create({
        data: { code: key(), name: key(), zone: 'EAST', sortOrder: 1 },
      });
      const start = new Date(
        Date.now() +
          30 * day +
          (parseInt(randomUUID().replaceAll('-', '').slice(0, 12), 16) %
            (250 * day)),
      );
      const session = await training.createSession(
        {
          classId: f.klass.id,
          courtIds: [court.id],
          startsAt: start.toISOString(),
          endsAt: new Date(+start + hour).toISOString(),
          reason: '回归排课',
          creationIdempotencyKey: key(),
        },
        coach,
      );
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(+start + hour + 1);
      try {
        await training.markAttendance(
          session.id,
          { enrollmentId: enrollment.id, status: 'ATTENDED' },
          coach,
        );
        await training.proposeConsume(
          session.id,
          { enrollmentId: enrollment.id },
          coach,
        );
        const source = await training.confirmConsume(
          session.id,
          {
            enrollmentId: enrollment.id,
            reason: '实际出勤确认',
            idempotencyKey: key(),
          },
          admin,
        );
        await training.completeSession(session.id, admin, {
          reason: '首次结课',
          idempotencyKey: key(),
        });
        expect(
          (
            await db.trainingSession.findUniqueOrThrow({
              where: { id: session.id },
            })
          ).status,
        ).toBe('COMPLETED');
        const request = await training.requestConsumeCorrection(
          {
            recognitionId: source.id,
            reason: '原始出勤记录需复核',
            idempotencyKey: key(),
          },
          coach,
        );
        const decision = {
          reason: '批准更正并重新核实',
          idempotencyKey: key(),
        };
        await training.approveConsumeCorrection(request.id, decision, admin);
        await training.approveConsumeCorrection(request.id, decision, admin);
        expect(
          (
            await db.trainingSession.findUniqueOrThrow({
              where: { id: session.id },
            })
          ).status,
        ).toBe('SCHEDULED');
        expect(
          await db.auditLog.count({
            where: {
              action: 'TRAINING_SESSION_REOPENED',
              objectId: session.id,
            },
          }),
        ).toBe(1);
        expect(
          (await db.order.findUniqueOrThrow({ where: { id: order.id } }))
            .completedAt,
        ).toBeNull();
        await training.proposeConsume(
          session.id,
          { enrollmentId: enrollment.id },
          coach,
        );
        const second = await training.confirmConsume(
          session.id,
          {
            enrollmentId: enrollment.id,
            reason: '更正后重新确认',
            idempotencyKey: key(),
          },
          admin,
        );
        await training.completeSession(session.id, admin, {
          reason: '更正后重新结课',
          idempotencyKey: key(),
        });
        expect(second.sequence).toBe(3);
        expect(
          await db.trainingEnrollment.findUniqueOrThrow({
            where: { id: enrollment.id },
          }),
        ).toMatchObject({
          status: 'COMPLETED',
          consumedSessions: 1,
          prepaidBalanceCents: 0,
          confirmedRevenueCents: 19800,
        });
        const dto = {
          periodStart: start.toISOString(),
          periodEnd: new Date(+start + 2 * hour).toISOString(),
          acquisitionCostCents: 0,
          marketingCostCents: 0,
        };
        const draft = await training.createSettlement(dto, admin);
        const lockedRequest = await training.requestConsumeCorrection(
          {
            recognitionId: second.id,
            reason: '结算锁验证',
            idempotencyKey: key(),
          },
          coach,
        );
        await expect(
          training.approveConsumeCorrection(
            lockedRequest.id,
            { reason: '结算期间不可重开', idempotencyKey: key() },
            admin,
          ),
        ).rejects.toMatchObject({ status: 409 });
        expect(
          (
            await db.trainingSession.findUniqueOrThrow({
              where: { id: session.id },
            })
          ).status,
        ).toBe('COMPLETED');
        expect(draft.effectiveRevenueCents).toBe(19800);
        await training.voidSettlement(
          draft.id,
          { reason: '回归测试释放账期', idempotencyKey: key() },
          admin,
        );
      } finally {
        vi.useRealTimers();
      }
    });
    it('returns only the assigned or assisted children in coach directory and profile', async () => {
      const guardian = await person(),
        otherCoach = await person('COACH');
      const own = await sourceCourse();
      const assisted = await db.trainingClass.create({
        data: {
          code: key(),
          name: key(),
          productId: own.product.id,
          coachId: otherCoach.sub,
          assistantId: coach.sub,
          capacity: 10,
          schedule: {},
        },
      });
      const unrelated = await db.trainingClass.create({
        data: {
          code: key(),
          name: key(),
          productId: own.product.id,
          coachId: otherCoach.sub,
          capacity: 10,
          schedule: {},
        },
      });
      const students = [];
      for (const klass of [own.klass, assisted, unrelated, null]) {
        const student = await db.student.create({
          data: {
            guardianId: guardian.sub,
            displayName: key(),
            guardianConsentStatus: true,
          },
        });
        students.push(student);
        if (klass)
          await db.trainingEnrollment.create({
            data: {
              enrollmentNo: key(),
              contractNo: key(),
              buyerId: guardian.sub,
              studentId: student.id,
              productId: own.product.id,
              classId: klass.id,
              totalSessions: 1,
              totalAmountCents: 19800,
              prepaidBalanceCents: 19800,
              status: 'ACTIVE',
              startsAt: new Date(),
              expiresAt: new Date(Date.now() + day),
            },
          });
      }
      const directory = await listMembers(
        db,
        { page: 1, pageSize: 20, keyword: guardian.displayName },
        coach,
      );
      const member = await profile(db, guardian.sub, coach);
      const allowed = students
        .slice(0, 2)
        .map((s) => s.id)
        .sort();
      expect(directory.items).toHaveLength(1);
      expect(
        (
          directory.items[0] as unknown as {
            guardianStudents: { id: string }[];
          }
        ).guardianStudents
          .map((s) => s.id)
          .sort(),
      ).toEqual(allowed);
      expect(member.guardianStudents.map((s) => s.id).sort()).toEqual(allowed);
      expect(
        (await profile(db, guardian.sub, admin)).guardianStudents,
      ).toHaveLength(4);
    });
    it('serializes a late count with submission and keeps the posted line, stock and ledger equal', async () => {
      const sku = await item(10);
      const sheet = await db.stocktake.create({
        data: {
          stocktakeNo: key(),
          locationId: location.id,
          status: 'COUNTING',
          reason: '回归盘点',
          createdById: admin.sub,
          startedAt: new Date(),
          lines: {
            create: {
              itemId: sku.id,
              batchCode: 'DEFAULT',
              bookQuantity: 10,
              countedQuantity: 8,
              difference: -2,
            },
          },
        },
        include: { lines: true },
      });
      const paused = latch(),
        resume = latch();
      const gated = db.$extends({
        query: {
          stocktakeLine: {
            async update({ args, query }) {
              if (args.where.id === sheet.lines[0].id) {
                paused.release();
                await resume.promise;
              }
              return query(args);
            },
          },
        },
      });
      const counting = capture(
        countStocktakeLine(
          gated as unknown as PrismaService,
          sheet.id,
          sheet.lines[0].id,
          { countedQuantity: 9 },
          admin,
        ),
      );
      let submitting: ReturnType<typeof capture> | undefined;
      try {
        await paused.promise;
        submitting = capture(submitStocktake(db, sheet.id, admin));
        let blocked = false;
        const deadline = Date.now() + 3000;
        while (Date.now() < deadline) {
          const rows = await db.$queryRaw<
            { blocked: boolean }[]
          >`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%Stocktake%') AS blocked`;
          if (rows[0].blocked) {
            blocked = true;
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
        expect(blocked).toBe(true);
      } finally {
        resume.release();
      }
      expect((await counting).error).toBeUndefined();
      const submitted = await submitting!;
      if (submitted.error) {
        expect(submitted.error).toMatchObject({ status: 409 });
        await submitStocktake(db, sheet.id, admin);
      }
      await postStocktake(db, sheet.id, { idempotencyKey: key() }, checker);
      await expect(
        countStocktakeLine(
          db,
          sheet.id,
          sheet.lines[0].id,
          { countedQuantity: 7 },
          admin,
        ),
      ).rejects.toMatchObject({ status: 409 });
      const final = await db.stocktakeLine.findUniqueOrThrow({
        where: { id: sheet.lines[0].id },
        include: { inventoryTransaction: true },
      });
      expect(final).toMatchObject({ countedQuantity: 9, difference: -1 });
      expect(final.inventoryTransaction?.quantity).toBe(-1);
      expect(
        (await db.inventoryItem.findUniqueOrThrow({ where: { id: sku.id } }))
          .stock,
      ).toBe(9);
    }, 20000);
    it.each(['batch', 'location'] as const)(
      'returns sold-out goods to the original retained balance after changing default %s',
      async (field) => {
        const sku = await item(1);
        const order = await db.order.create({
          data: {
            orderNo: key(),
            memberId: admin.sub,
            createdById: admin.sub,
            businessType: 'GOODS',
            subjectAccount: 'VENUE',
            sourceChannel: 'MINI_PROGRAM',
            title: '回归销售',
            parameterSnapshot: {},
            listAmountCents: 200,
            payableCents: 200,
            paidCents: 200,
            status: 'PAID',
            paidAt: new Date(),
            items: {
              create: {
                itemType: 'GOODS',
                itemId: sku.id,
                name: sku.name,
                quantity: 1,
                unitPriceCents: 200,
                amountCents: 200,
              },
            },
          },
          include: { items: true },
        });
        const original = await db.inventoryStockBalance.findFirstOrThrow({
          where: { itemId: sku.id },
        });
        await db.$transaction(async (tx) => {
          const sold = await applyGoodsSale(tx, sku, 1);
          await tx.inventoryTransaction.create({
            data: {
              itemId: sku.id,
              orderItemId: order.items[0].id,
              type: 'SALE_OUT',
              quantity: -1,
              stockBefore: 1,
              stockAfter: 0,
              operatorId: admin.sub,
              reason: '回归销售',
              idempotencyKey: key(),
              metadata: { allocations: sold.allocations },
            },
          });
        });
        const sold = await db.inventoryItem.findUniqueOrThrow({
          where: { id: sku.id },
        });
        const nextLocation =
          field === 'location'
            ? await db.inventoryLocation.create({
                data: { code: key(), name: 'Next regression location' },
              })
            : location;
        await updateItem(
          db,
          sku.id,
          {
            ...(field === 'batch'
              ? { batchCode: 'NEXT' }
              : { defaultLocationId: nextLocation.id }),
            expectedUpdatedAt: sold.updatedAt.toISOString(),
            reason: '切换下批库存',
            idempotencyKey: key(),
          },
          admin,
        );
        const changed = await db.inventoryItem.findUniqueOrThrow({
          where: { id: sku.id },
        });
        const returned = await db.$transaction((tx) =>
          restoreGoodsSale(tx, changed, 1, order.items[0].id),
        );
        expect(returned.stockAfter).toBe(1);
        expect(
          (
            await db.inventoryStockBalance.findUniqueOrThrow({
              where: { id: original.id },
            })
          ).quantity,
        ).toBe(1);
        expect(
          (
            await db.inventoryStockBalance.findFirstOrThrow({
              where: {
                itemId: sku.id,
                batchCode: field === 'batch' ? 'NEXT' : 'DEFAULT',
                locationId: nextLocation.id,
              },
            })
          ).quantity,
        ).toBe(0);
      },
    );
    it.each([null, new Date('2027-02-01T00:00:00Z')])(
      'edits stocked SKU with unchanged expiry %s and rejects a real expiry change',
      async (expiresAt) => {
        const sku = await item(2, expiresAt);
        const dto = {
          salePriceCents: 300,
          expiresAt: expiresAt?.toISOString() ?? null,
          expectedUpdatedAt: sku.updatedAt.toISOString(),
          reason: '仅调整售价',
          idempotencyKey: key(),
        };
        const updated = await updateItem(db, sku.id, dto, admin);
        expect(updated.salePriceCents).toBe(300);
        expect((await updateItem(db, sku.id, dto, admin)).id).toBe(sku.id);
        await expect(
          updateItem(
            db,
            sku.id,
            {
              ...dto,
              expiresAt: '2027-03-01T00:00:00Z',
              expectedUpdatedAt: updated.updatedAt.toISOString(),
              idempotencyKey: key(),
            },
            admin,
          ),
        ).rejects.toMatchObject({ status: 409 });
        await expect(
          updateItem(
            db,
            sku.id,
            { ...dto, expiresAt: '2027-03-01T00:00:00Z' },
            admin,
          ),
        ).rejects.toMatchObject({ status: 409 });
      },
    );
    it('does not let 100 healthy SKUs crowd a real shortage out of the default work queue', async () => {
      await db.inventoryItem.createMany({
        data: Array.from({ length: 100 }, () => ({
          sku: key(),
          name: key(),
          category: 'Regression',
          supplier: supplier.name,
          mode: 'PURCHASE' as const,
          purchasePriceCents: 100,
          salePriceCents: 200,
          stock: 1,
          safeStock: 0,
        })),
      });
      const shortage = await item(20);
      await db.inventoryItem.update({
        where: { id: shortage.id },
        data: { safeStock: 100 },
      });
      const rows = await loadInventory(db, {
        limit: 50,
        canOperateInventory: true,
      });
      expect(rows.some((row) => row.id === shortage.id)).toBe(true);
      expect(rows.every((row) => row.stock <= row.safeStock)).toBe(true);
      expect(
        mapInventoryWorkItems(rows, { limit: 50 }).some(
          (row) => row.objectId === shortage.id,
        ),
      ).toBe(true);
      expect(
        await loadInventory(db, { limit: 50, canOperateInventory: false }),
      ).toEqual([]);
    });
  },
);
