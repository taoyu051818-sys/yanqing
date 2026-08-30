import { BadRequestException, ForbiddenException } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { describe, expect, it, vi } from 'vitest';

import type { AuthUser } from '../common/auth/auth-user.js';
import { AppRole } from '../generated/prisma/enums.js';
import { ReportsService } from './reports.service.js';

const finance: AuthUser = {
  sub: 'finance-1',
  displayName: '财务',
  roles: [AppRole.FINANCE],
};
const member: AuthUser = {
  sub: 'member-1',
  displayName: '会员',
  roles: [AppRole.MEMBER],
};

const delegate = () => ({ findMany: vi.fn().mockResolvedValue([]) });

const makePrisma = () => ({
  order: delegate(),
  orderItem: delegate(),
  payment: delegate(),
  refund: delegate(),
  user: delegate(),
  account: delegate(),
  accountTransaction: delegate(),
  student: delegate(),
  trainingProduct: delegate(),
  trainingClass: delegate(),
  trainingEnrollment: delegate(),
  trainingSession: delegate(),
  trainingAttendance: delegate(),
  trainingRevenueRecognition: delegate(),
  trainingConsumeCorrection: delegate(),
  trainingSettlement: delegate(),
  event: delegate(),
  eventTeam: delegate(),
  eventMatch: delegate(),
  eventPrizeAward: delegate(),
  merchant: delegate(),
  couponTemplate: delegate(),
  couponCode: delegate(),
  allianceSettlement: delegate(),
  supplier: delegate(),
  consignmentPayableEntry: delegate(),
  consignmentSettlement: delegate(),
  consignmentSettlementLine: delegate(),
  consignmentSettlementTransition: delegate(),
  inventoryLocation: delegate(),
  inventoryItem: delegate(),
  inventoryStockBalance: delegate(),
  inventoryTransaction: delegate(),
  purchaseOrder: delegate(),
  purchaseOrderLine: delegate(),
  purchaseReceipt: delegate(),
  purchaseReceiptLine: delegate(),
  stocktake: delegate(),
  stocktakeLine: delegate(),
  inventoryOperation: delegate(),
  reconciliationPeriod: delegate(),
  auditLog: {
    findMany: vi.fn().mockResolvedValue([]),
    create: vi.fn().mockResolvedValue({}),
  },
});

const readWorkbook = async (buffer: Buffer) => {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as never);
  return workbook;
};

const valueAt = (sheet: ExcelJS.Worksheet, header: string, row = 2) => {
  const headerRow = sheet.getRow(1);
  const column =
    headerRow.values instanceof Array ? headerRow.values.indexOf(header) : -1;
  return sheet.getRow(row).getCell(column).value;
};

describe('ReportsService', () => {
  it('enforces export roles inside the service before querying business data', async () => {
    const prisma = makePrisma();
    const service = new ReportsService(prisma as never);

    await expect(service.workbook('orders', member)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(prisma.order.findMany).not.toHaveBeenCalled();
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });

  it('rejects unknown scopes without writing an export audit', async () => {
    const prisma = makePrisma();
    const service = new ReportsService(prisma as never);

    await expect(
      service.workbook('private-table', finance),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });

  it('exports orders as auditable related sheets and serializes unsafe values', async () => {
    const prisma = makePrisma();
    prisma.order.findMany.mockResolvedValue([
      {
        id: 'order-1',
        title: '=HYPERLINK("https://invalid.example")',
        parameterSnapshot: { priceCents: 8800, effectiveAt: '2026-08-29' },
        createdAt: new Date('2026-08-29T01:02:03.000Z'),
      },
    ]);
    prisma.orderItem.findMany.mockResolvedValue([
      { id: 'item-1', orderId: 'order-1', metadata: { sku: 'B-1' } },
    ]);
    prisma.payment.findMany.mockResolvedValue([
      { id: 'payment-1', orderId: 'order-1', amountCents: 8800 },
    ]);
    prisma.refund.findMany.mockResolvedValue([
      { id: 'refund-1', orderId: 'order-1', amountCents: 1000 },
    ]);
    const service = new ReportsService(prisma as never);

    const result = await service.workbook('orders', {
      ...finance,
      roles: [AppRole.MEMBER, AppRole.FINANCE],
    });
    const workbook = await readWorkbook(result.buffer);

    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual([
      'ExportManifest',
      'Orders',
      'OrderItems',
      'Payments',
      'Refunds',
    ]);
    const orders = workbook.getWorksheet('Orders')!;
    expect(valueAt(orders, 'title')).toBe(
      '\'=HYPERLINK("https://invalid.example")',
    );
    expect(valueAt(orders, 'parameterSnapshot')).toBe(
      '{"priceCents":8800,"effectiveAt":"2026-08-29"}',
    );
    expect(valueAt(orders, 'createdAt')).toBe('2026-08-29T01:02:03.000Z');
    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorRole: AppRole.FINANCE,
        action: 'DATA_EXPORTED',
        objectId: 'orders',
        newValue: expect.objectContaining({
          sheetRows: { Orders: 1, OrderItems: 1, Payments: 1, Refunds: 1 },
        }),
      }),
    });
  });

  it('finance scope covers every money and reconciliation ledger', async () => {
    const prisma = makePrisma();
    const service = new ReportsService(prisma as never);

    const result = await service.workbook('finance', finance);
    const workbook = await readWorkbook(result.buffer);

    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual([
      'ExportManifest',
      'Orders',
      'Payments',
      'Refunds',
      'Accounts',
      'AccountTransactions',
      'TrainingRevenue',
      'TrainingSettlements',
      'AllianceSettlements',
      'ConsignmentPayableEntries',
      'ConsignmentSettlements',
      'ConsignmentSettlementLines',
      'ConsignmentTransitions',
      'ReconciliationPeriods',
    ]);
    expect(prisma.payment.findMany).toHaveBeenCalledOnce();
    expect(prisma.refund.findMany).toHaveBeenCalledOnce();
    expect(prisma.order.findMany).toHaveBeenCalledOnce();
    expect(prisma.account.findMany).toHaveBeenCalledOnce();
    expect(prisma.accountTransaction.findMany).toHaveBeenCalledOnce();
    expect(prisma.trainingRevenueRecognition.findMany).toHaveBeenCalledOnce();
    expect(prisma.trainingSettlement.findMany).toHaveBeenCalledOnce();
    expect(prisma.allianceSettlement.findMany).toHaveBeenCalledOnce();
    expect(prisma.consignmentPayableEntry.findMany).toHaveBeenCalledOnce();
    expect(prisma.consignmentSettlement.findMany).toHaveBeenCalledOnce();
    expect(prisma.consignmentSettlementLine.findMany).toHaveBeenCalledOnce();
    expect(
      prisma.consignmentSettlementTransition.findMany,
    ).toHaveBeenCalledOnce();
    expect(prisma.reconciliationPeriod.findMany).toHaveBeenCalledOnce();
    expect(prisma.payment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.not.objectContaining({ providerPayload: true }),
      }),
    );
  });

  it('training scope carries the contract, guardian, four-ledger and correction evidence', async () => {
    const prisma = makePrisma();
    prisma.trainingProduct.findMany.mockResolvedValue([
      {
        id: 'product-1',
        name: '青少年成长课包',
        refundRule: { beforeStart: 'FULL', afterStart: 'UNCONSUMED_ONLY' },
      },
    ]);
    prisma.student.findMany.mockResolvedValue([
      {
        id: 'student-1',
        guardianId: 'guardian-1',
        guardianConsentStatus: true,
        authorizationNote: '电子授权编号 AUTH-1',
      },
    ]);
    prisma.trainingEnrollment.findMany.mockResolvedValue([
      {
        id: 'enrollment-1',
        totalAmountCents: 128_000,
        prepaidBalanceCents: 96_000,
        confirmedRevenueCents: 32_000,
        refundedCents: 0,
        contractNo: 'HT-1',
      },
    ]);
    const service = new ReportsService(prisma as never);

    const result = await service.workbook('training', finance);
    const workbook = await readWorkbook(result.buffer);

    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual([
      'ExportManifest',
      'Orders',
      'Payments',
      'Refunds',
      'Students',
      'TrainingProducts',
      'TrainingClasses',
      'TrainingEnrollments',
      'TrainingSessions',
      'TrainingAttendances',
      'TrainingRevenue',
      'TrainingConsumeCorrections',
      'TrainingSettlements',
    ]);
    expect(prisma.order.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { businessType: 'TRAINING' },
      }),
    );
    expect(prisma.payment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { order: { businessType: 'TRAINING' } },
      }),
    );
    expect(prisma.refund.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { order: { businessType: 'TRAINING' } },
      }),
    );
    expect(
      valueAt(workbook.getWorksheet('TrainingProducts')!, 'refundRule'),
    ).toContain('UNCONSUMED_ONLY');
    expect(
      valueAt(workbook.getWorksheet('Students')!, 'guardianConsentStatus'),
    ).toBe(true);
    expect(
      valueAt(
        workbook.getWorksheet('TrainingEnrollments')!,
        'prepaidBalanceCents',
      ),
    ).toBe(96_000);
    expect(
      valueAt(
        workbook.getWorksheet('TrainingEnrollments')!,
        'confirmedRevenueCents',
      ),
    ).toBe(32_000);
    expect(
      valueAt(workbook.getWorksheet('TrainingEnrollments')!, 'refundedCents'),
    ).toBe(0);
  });

  it('events scope exports registration money, five-round results and prize evidence', async () => {
    const prisma = makePrisma();
    prisma.eventMatch.findMany.mockResolvedValue([
      {
        id: 'match-1',
        eventId: 'event-1',
        round: 5,
        startingScoreA: 5,
        startingScoreB: 0,
        scoreA: 21,
        scoreB: 18,
      },
    ]);
    const service = new ReportsService(prisma as never);

    const result = await service.workbook('events', finance);
    const workbook = await readWorkbook(result.buffer);

    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual([
      'ExportManifest',
      'Orders',
      'OrderItems',
      'Payments',
      'Refunds',
      'Events',
      'EventTeams',
      'EventMatches',
      'EventPrizeAwards',
    ]);
    expect(prisma.order.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { businessType: 'EVENT' },
      }),
    );
    expect(prisma.orderItem.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { order: { businessType: 'EVENT' } },
      }),
    );
    expect(prisma.payment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { order: { businessType: 'EVENT' } },
      }),
    );
    expect(prisma.refund.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { order: { businessType: 'EVENT' } },
      }),
    );
    expect(valueAt(workbook.getWorksheet('EventMatches')!, 'round')).toBe(5);
    expect(
      valueAt(workbook.getWorksheet('EventMatches')!, 'startingScoreA'),
    ).toBe(5);
  });

  it('inventory scope exports goods money and every operational stock document', async () => {
    const prisma = makePrisma();
    const service = new ReportsService(prisma as never);

    const result = await service.workbook('inventory', finance);
    const workbook = await readWorkbook(result.buffer);

    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual([
      'ExportManifest',
      'Orders',
      'OrderItems',
      'Payments',
      'Refunds',
      'Suppliers',
      'ConsignmentPayableEntries',
      'ConsignmentSettlements',
      'ConsignmentSettlementLines',
      'ConsignmentTransitions',
      'InventoryLocations',
      'InventoryItems',
      'InventoryStockBalances',
      'InventoryTransactions',
      'PurchaseOrders',
      'PurchaseOrderLines',
      'PurchaseReceipts',
      'PurchaseReceiptLines',
      'Stocktakes',
      'StocktakeLines',
      'InventoryOperations',
    ]);
    expect(prisma.order.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { businessType: 'GOODS' },
      }),
    );
    expect(prisma.supplier.findMany).toHaveBeenCalledOnce();
    expect(prisma.consignmentPayableEntry.findMany).toHaveBeenCalledOnce();
    expect(prisma.consignmentSettlement.findMany).toHaveBeenCalledOnce();
    expect(prisma.consignmentSettlementLine.findMany).toHaveBeenCalledOnce();
    expect(
      prisma.consignmentSettlementTransition.findMany,
    ).toHaveBeenCalledOnce();
    expect(prisma.inventoryLocation.findMany).toHaveBeenCalledOnce();
    expect(prisma.inventoryStockBalance.findMany).toHaveBeenCalledOnce();
    expect(prisma.purchaseOrder.findMany).toHaveBeenCalledOnce();
    expect(prisma.purchaseOrderLine.findMany).toHaveBeenCalledOnce();
    expect(prisma.purchaseReceipt.findMany).toHaveBeenCalledOnce();
    expect(prisma.purchaseReceiptLine.findMany).toHaveBeenCalledOnce();
    expect(prisma.stocktake.findMany).toHaveBeenCalledOnce();
    expect(prisma.stocktakeLine.findMany).toHaveBeenCalledOnce();
    expect(prisma.inventoryOperation.findMany).toHaveBeenCalledOnce();
  });

  it('masks phone fields in member exports', async () => {
    const prisma = makePrisma();
    prisma.user.findMany.mockResolvedValue([
      { id: 'member-1', displayName: '测试会员', phone: '13812345678' },
    ]);
    const service = new ReportsService(prisma as never);

    const result = await service.workbook('members', finance);
    const workbook = await readWorkbook(result.buffer);

    expect(valueAt(workbook.getWorksheet('Members')!, 'phone')).toBe(
      '138****5678',
    );
  });

  it.each(['all', 'migration'])(
    '%s scope emits the complete migration workbook',
    async (scope) => {
      const prisma = makePrisma();
      const service = new ReportsService(prisma as never);

      const result = await service.workbook(scope, finance);
      const workbook = await readWorkbook(result.buffer);

      expect(workbook.worksheets).toHaveLength(43);
      expect(workbook.getWorksheet('Orders')).toBeDefined();
      expect(workbook.getWorksheet('Members')).toBeDefined();
      expect(workbook.getWorksheet('TrainingRevenue')).toBeDefined();
      expect(workbook.getWorksheet('Students')).toBeDefined();
      expect(workbook.getWorksheet('TrainingProducts')).toBeDefined();
      expect(workbook.getWorksheet('TrainingConsumeCorrections')).toBeDefined();
      expect(workbook.getWorksheet('EventMatches')).toBeDefined();
      expect(workbook.getWorksheet('EventPrizeAwards')).toBeDefined();
      expect(workbook.getWorksheet('CouponCodes')).toBeDefined();
      expect(workbook.getWorksheet('Suppliers')).toBeDefined();
      expect(workbook.getWorksheet('ConsignmentPayableEntries')).toBeDefined();
      expect(workbook.getWorksheet('ConsignmentSettlements')).toBeDefined();
      expect(workbook.getWorksheet('ConsignmentSettlementLines')).toBeDefined();
      expect(workbook.getWorksheet('ConsignmentTransitions')).toBeDefined();
      expect(workbook.getWorksheet('PurchaseOrders')).toBeDefined();
      expect(workbook.getWorksheet('PurchaseReceipts')).toBeDefined();
      expect(workbook.getWorksheet('Stocktakes')).toBeDefined();
      expect(workbook.getWorksheet('InventoryOperations')).toBeDefined();
      expect(workbook.getWorksheet('InventoryTransactions')).toBeDefined();
      expect(workbook.getWorksheet('AuditLogs')).toBeDefined();
      expect(workbook.getWorksheet('ReconciliationPeriods')).toBeDefined();
      expect(prisma.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ objectId: scope }),
      });
    },
  );
});
