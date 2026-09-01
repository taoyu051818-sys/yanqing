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
const admin: AuthUser = {
  sub: 'admin-1',
  displayName: '管理员',
  roles: [AppRole.ADMIN],
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

const headers = (sheet: ExcelJS.Worksheet) => {
  const values = sheet.getRow(1).values;
  return values instanceof Array ? values.slice(1) : [];
};

const manifestValue = (sheet: ExcelJS.Worksheet, field: string) => {
  const row = sheet
    .getRows(2, sheet.rowCount - 1)
    ?.find((item) => item.getCell(1).value === field);
  return row?.getCell(2).value;
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

  it.each([
    'members',
    'training',
    'events',
    'alliance',
    'inventory',
    'audit',
    'all',
    'migration',
  ])(
    'rejects finance from the %s scope before querying business data',
    async (scope) => {
      const prisma = makePrisma();
      const service = new ReportsService(prisma as never);

      await expect(service.workbook(scope, finance)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(prisma.auditLog.create).not.toHaveBeenCalled();
      expect(prisma.user.findMany).not.toHaveBeenCalled();
      expect(prisma.inventoryItem.findMany).not.toHaveBeenCalled();
    },
  );

  it.each([
    [AppRole.FINANCE, AppRole.ADMIN],
    [AppRole.ADMIN, AppRole.FINANCE],
  ])(
    'attributes mixed-role exports to the highest authorization role (%s, %s)',
    async (firstRole, secondRole) => {
      const prisma = makePrisma();
      const service = new ReportsService(prisma as never);

      const result = await service.workbook('orders', {
        ...admin,
        roles: [firstRole, secondRole],
      });
      const workbook = await readWorkbook(result.buffer);

      expect(
        manifestValue(workbook.getWorksheet('ExportManifest')!, 'actorRole'),
      ).toBe(AppRole.ADMIN);
      expect(prisma.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ actorRole: AppRole.ADMIN }),
      });
    },
  );

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

    const result = await service.workbook('orders', admin);
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
        actorRole: AppRole.ADMIN,
        action: 'DATA_EXPORTED',
        objectId: 'orders',
        newValue: expect.objectContaining({
          sheetRows: { Orders: 1, OrderItems: 1, Payments: 1, Refunds: 1 },
        }),
      }),
    });
  });

  it('gives finance an accounting projection without internal order evidence', async () => {
    const prisma = makePrisma();
    prisma.order.findMany.mockResolvedValue([
      {
        id: 'order-1',
        orderNo: 'O-1',
        title: '场地订单',
        payableCents: 8800,
        parameterSnapshot: { priceRule: 'private' },
        creationIdempotencyKey: 'order-key',
        creationCommandHash: 'order-hash',
      },
    ]);
    prisma.orderItem.findMany.mockResolvedValue([
      {
        id: 'item-1',
        orderId: 'order-1',
        name: '一号场地',
        amountCents: 8800,
        metadata: { commissionRateBps: 1500 },
      },
    ]);
    prisma.payment.findMany.mockResolvedValue([
      {
        id: 'payment-1',
        paymentNo: 'P-1',
        amountCents: 8800,
        idempotencyKey: 'payment-key',
        providerPayload: { raw: 'private' },
      },
    ]);
    prisma.refund.findMany.mockResolvedValue([
      {
        id: 'refund-1',
        refundNo: 'R-1',
        amountCents: 1000,
        idempotencyKey: 'refund-key',
      },
    ]);
    const service = new ReportsService(prisma as never);

    const result = await service.workbook('orders', finance);
    const workbook = await readWorkbook(result.buffer);

    expect(valueAt(workbook.getWorksheet('Orders')!, 'payableCents')).toBe(
      8800,
    );
    expect(valueAt(workbook.getWorksheet('OrderItems')!, 'amountCents')).toBe(
      8800,
    );
    expect(headers(workbook.getWorksheet('Orders')!)).not.toEqual(
      expect.arrayContaining([
        'parameterSnapshot',
        'creationIdempotencyKey',
        'creationCommandHash',
      ]),
    );
    expect(headers(workbook.getWorksheet('OrderItems')!)).not.toContain(
      'metadata',
    );
    expect(headers(workbook.getWorksheet('Payments')!)).not.toEqual(
      expect.arrayContaining(['idempotencyKey', 'providerPayload']),
    );
    expect(headers(workbook.getWorksheet('Refunds')!)).not.toContain(
      'idempotencyKey',
    );
    expect(prisma.order.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.not.objectContaining({
          parameterSnapshot: true,
          creationIdempotencyKey: true,
          creationCommandHash: true,
        }),
      }),
    );
    expect(prisma.orderItem.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.not.objectContaining({ metadata: true }),
      }),
    );
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

  it('removes private rule snapshots and replay keys from finance ledgers', async () => {
    const prisma = makePrisma();
    prisma.accountTransaction.findMany.mockResolvedValue([
      {
        id: 'txn-1',
        amount: 8800,
        idempotencyKey: 'account-key',
        metadata: { private: true },
      },
    ]);
    prisma.trainingRevenueRecognition.findMany.mockResolvedValue([
      {
        id: 'revenue-1',
        effectiveRevenueCents: 8800,
        idempotencyKey: 'training-key',
      },
    ]);
    prisma.allianceSettlement.findMany.mockResolvedValue([
      {
        id: 'alliance-1',
        cooperationFeeCents: 1200,
        detail: { private: true },
      },
    ]);
    prisma.consignmentPayableEntry.findMany.mockResolvedValue([
      {
        id: 'payable-1',
        payableCents: 7000,
        commissionRateBps: 1500,
        ruleSnapshot: { internalRule: true },
        idempotencyKey: 'payable-key',
      },
    ]);
    prisma.consignmentSettlement.findMany.mockResolvedValue([
      {
        id: 'settlement-1',
        payableCents: 7000,
        ruleSnapshot: { internalRule: true },
        creationIdempotencyKey: 'settlement-key',
        creationCommandHash: 'settlement-hash',
      },
    ]);
    prisma.consignmentSettlementTransition.findMany.mockResolvedValue([
      {
        id: 'transition-1',
        reason: '复核通过',
        idempotencyKey: 'transition-key',
        commandHash: 'transition-hash',
      },
    ]);
    prisma.reconciliationPeriod.findMany.mockResolvedValue([
      {
        id: 'period-1',
        totals: { paidCents: 8800 },
        detail: { internalChecks: ['private'] },
      },
    ]);
    const service = new ReportsService(prisma as never);

    const result = await service.workbook('finance', finance);
    const workbook = await readWorkbook(result.buffer);
    const blocked = [
      'parameterSnapshot',
      'creationIdempotencyKey',
      'creationCommandHash',
      'idempotencyKey',
      'commandHash',
      'metadata',
      'providerPayload',
      'ruleSnapshot',
      'commissionRateBps',
      'detail',
    ];

    for (const sheet of workbook.worksheets.slice(1)) {
      expect(headers(sheet)).not.toEqual(expect.arrayContaining(blocked));
    }
    expect(
      valueAt(
        workbook.getWorksheet('ConsignmentPayableEntries')!,
        'payableCents',
      ),
    ).toBe(7000);
    expect(
      valueAt(workbook.getWorksheet('ReconciliationPeriods')!, 'totals'),
    ).toBe('{"paidCents":8800}');
    expect(prisma.consignmentPayableEntry.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.not.objectContaining({
          commissionRateBps: true,
          ruleSnapshot: true,
          idempotencyKey: true,
        }),
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

    const result = await service.workbook('training', admin);
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

    const result = await service.workbook('events', admin);
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

    const result = await service.workbook('inventory', admin);
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

    const result = await service.workbook('members', admin);
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

      const result = await service.workbook(scope, admin);
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
