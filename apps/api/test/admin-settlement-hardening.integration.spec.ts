import { afterAll, describe, expect, it } from 'vitest';
import { ConsignmentWorkflowService } from '../src/inventory/consignment/workflow/consignment-settlement-workflow.service.js';
import { TrainingSettlementsService } from '../src/training/settlements/training-settlements.service.js';
import type { AuthUser } from '../src/common/auth/auth-user.js';
import {
  actor,
  connection,
  database,
  failAudit,
  key,
} from './support/admin-hardening-db.js';

const prisma = database(),
  contender = database();
afterAll(async () => {
  await Promise.all([prisma.$disconnect(), contender.$disconnect()]);
});

async function fixture(type: 'CONSIGNMENT' | 'TRAINING', creator: AuthUser) {
  const periodStart = new Date(
    Date.UTC(2040, 0, 1) + Math.floor(Math.random() * 1e10),
  );
  const periodEnd = new Date(periodStart.getTime() + 3600000);
  if (type === 'CONSIGNMENT') {
    const supplier = await prisma.supplier.create({
      data: {
        code: key('supplier'),
        name: 'Test supplier',
        type: 'CONSIGNMENT',
      },
    });
    const item = await prisma.inventoryItem.create({
      data: {
        sku: key('sku'),
        name: 'Test grip',
        category: 'TEST',
        mode: 'CONSIGNMENT',
        supplier: supplier.name,
        supplierId: supplier.id,
        purchasePriceCents: 0,
        salePriceCents: 1000,
      },
    });
    const order = await prisma.order.create({
      data: {
        orderNo: key('goods'),
        memberId: creator.sub,
        createdById: creator.sub,
        businessType: 'GOODS',
        subjectAccount: 'VENUE',
        sourceChannel: 'MINI_PROGRAM',
        status: 'PAID',
        title: 'Test consignment sale',
        listAmountCents: 1000,
        payableCents: 1000,
        paidCents: 1000,
        paidAt: periodStart,
        parameterSnapshot: {},
        items: {
          create: {
            itemType: 'GOODS',
            itemId: item.id,
            name: item.name,
            unitPriceCents: 1000,
            amountCents: 1000,
          },
        },
      },
      include: { items: true },
    });
    const entry = await prisma.consignmentPayableEntry.create({
      data: {
        type: 'SALE',
        supplierId: supplier.id,
        itemId: item.id,
        orderId: order.id,
        orderItemId: order.items[0].id,
        quantity: 1,
        unitSalePriceCents: 1000,
        grossSaleCents: 1000,
        commissionRateBps: 2000,
        commissionCents: 200,
        payableCents: 800,
        ruleSnapshot: {},
        occurredAt: periodStart,
        idempotencyKey: key('sale'),
      },
    });
    return prisma.consignmentSettlement.create({
      data: {
        statementNo: key('statement'),
        supplierId: supplier.id,
        periodStart,
        periodEnd,
        entryCount: 1,
        netQuantity: 1,
        grossSaleCents: 1000,
        commissionCents: 200,
        payableCents: 800,
        ruleSnapshot: {},
        creationReason: 'Isolated test',
        creationIdempotencyKey: key('create'),
        creationCommandHash: 'a'.repeat(64),
        createdById: creator.sub,
        lines: {
          create: {
            payableEntryId: entry.id,
            quantity: 1,
            grossSaleCents: 1000,
            commissionCents: 200,
            payableCents: 800,
          },
        },
      },
    });
  }
  const row = await prisma.trainingSettlement.create({
    data: {
      periodStart,
      periodEnd,
      sourceSnapshot: { version: 1, recognitions: [], sessions: [] },
      effectiveRevenueCents: 0,
      venueContributionCents: 0,
      cashContributionMarginCents: 0,
    },
  });
  await prisma.auditLog.create({
    data: {
      actorId: creator.sub,
      actorRole: creator.roles[0],
      action: 'TRAINING_SETTLEMENT_CREATED',
      objectType: 'TrainingSettlement',
      objectId: row.id,
    },
  });
  return row;
}
const objectType = (type: string) =>
  type === 'CONSIGNMENT' ? 'ConsignmentSettlement' : 'TrainingSettlement';
const read = (type: string, id: string) =>
  type === 'CONSIGNMENT'
    ? prisma.consignmentSettlement.findUniqueOrThrow({ where: { id } })
    : prisma.trainingSettlement.findUniqueOrThrow({ where: { id } });
const service = (type: string, db = prisma) =>
  type === 'CONSIGNMENT'
    ? new ConsignmentWorkflowService(db)
    : new TrainingSettlementsService(db);

describe.skipIf(!connection)(
  'Administrator settlement commands on PostgreSQL',
  () => {
    it('rejects whitespace payment evidence without advancing the consignment draft', async () => {
      const admin = await actor(prisma),
        row = await fixture('CONSIGNMENT', admin);
      await expect(
        new ConsignmentWorkflowService(prisma).settleSettlement(
          row.id,
          {
            reason: '实际付款核对',
            paymentReference: '   ',
            idempotencyKey: key('settle'),
          },
          admin,
        ),
      ).rejects.toMatchObject({ status: 400 });
      expect((await read('CONSIGNMENT', row.id)).status).toBe('DRAFT');
      expect(
        await prisma.consignmentSettlementTransition.count({
          where: { settlementId: row.id },
        }),
      ).toBe(0);
      expect(await prisma.auditLog.count({ where: { objectId: row.id } })).toBe(
        0,
      );
    });

    for (const type of ['CONSIGNMENT', 'TRAINING'] as const) {
      it.each(['ADMIN', 'SUPER_ADMIN'] as const)(
        `${type}: %s rolls back all phases on final failure, then retries once`,
        async (role) => {
          const admin = await actor(prisma, role),
            row = await fixture(type, admin);
          const dto = {
            reason: '实际付款已核对',
            paymentReference: 'BANK-TEST-001',
            idempotencyKey: key('settle'),
          };
          const failing = service(
            type,
            failAudit(prisma, `${type}_SETTLEMENT_SETTLED`),
          );
          await expect(
            failing.settleSettlement(row.id, dto, admin),
          ).rejects.toThrow('Injected final audit failure');
          expect(await read(type, row.id)).toMatchObject({
            status: 'DRAFT',
            confirmedAt: null,
            settledAt: null,
          });
          expect(
            await prisma.auditLog.count({
              where: {
                objectId: row.id,
                action: {
                  in: [
                    `${type}_SETTLEMENT_SUBMITTED`,
                    `${type}_SETTLEMENT_CONFIRMED`,
                    `${type}_SETTLEMENT_SETTLED`,
                  ],
                },
              },
            }),
          ).toBe(0);
          if (type === 'CONSIGNMENT')
            expect(
              await prisma.consignmentSettlementTransition.count({
                where: { settlementId: row.id },
              }),
            ).toBe(0);
          await service(type).settleSettlement(row.id, dto, admin);
          await service(type).settleSettlement(row.id, dto, admin);
          expect((await read(type, row.id)).status).toBe('SETTLED');
          const audit = await prisma.auditLog.findMany({
            where: {
              objectType: objectType(type),
              objectId: row.id,
              action: { not: `${type}_SETTLEMENT_CREATED` },
            },
          });
          expect(audit).toHaveLength(3);
          expect(audit.every((entry) => entry.actorId === admin.sub)).toBe(
            true,
          );
          if (type === 'CONSIGNMENT')
            expect(await read(type, row.id)).toMatchObject({
              paymentReference: dto.paymentReference,
            });
        },
      );

      it(`${type}: simultaneous callers cannot record settlement twice`, async () => {
        const admin = await actor(prisma),
          row = await fixture(type, admin);
        const dto = {
          reason: '并发付款核对',
          paymentReference: 'BANK-TEST-002',
          idempotencyKey: key('race'),
        };
        const results = await Promise.allSettled([
          service(type).settleSettlement(row.id, dto, admin),
          service(type, contender).settleSettlement(row.id, dto, admin),
        ]);
        expect(results.some((result) => result.status === 'fulfilled')).toBe(
          true,
        );
        for (const result of results)
          if (result.status === 'rejected')
            expect(result.reason).toMatchObject({ status: 409 });
        await service(type).settleSettlement(row.id, dto, admin);
        expect((await read(type, row.id)).status).toBe('SETTLED');
        expect(
          await prisma.auditLog.count({
            where: { objectId: row.id, action: `${type}_SETTLEMENT_SETTLED` },
          }),
        ).toBe(1);
      });

      it(`${type}: finance retains the submitted/confirmed workflow and cannot confirm own document`, async () => {
        const finance = await actor(prisma, 'FINANCE'),
          row = await fixture(type, finance);
        const dto = {
          reason: '提交核对',
          paymentReference: 'BANK-TEST-003',
          idempotencyKey: key('submit'),
        };
        await expect(
          service(type).settleSettlement(row.id, dto, finance),
        ).rejects.toBeDefined();
        expect((await read(type, row.id)).status).toBe('DRAFT');
        await service(type).submitSettlement(row.id, dto, finance);
        await expect(
          service(type).confirmSettlement(
            row.id,
            { ...dto, idempotencyKey: key('confirm') },
            finance,
          ),
        ).rejects.toMatchObject({ status: 403 });
        expect((await read(type, row.id)).status).toBe('PENDING_CONFIRMATION');
      });
    }
  },
);
