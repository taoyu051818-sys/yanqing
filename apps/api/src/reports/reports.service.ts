import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import ExcelJS from 'exceljs';

import type { AuthUser } from '../common/auth/auth-user.js';
import { PrismaService } from '../database/prisma.service.js';
import { AppRole, BusinessType } from '../generated/prisma/enums.js';

const EXPORT_ROW_LIMIT = 10_000;
const SCOPES = [
  'orders',
  'members',
  'training',
  'events',
  'alliance',
  'inventory',
  'audit',
  'finance',
  'all',
  'migration',
] as const;
type ExportScope = (typeof SCOPES)[number];

type DatasetName =
  | 'Orders'
  | 'OrderItems'
  | 'Payments'
  | 'Refunds'
  | 'Members'
  | 'Accounts'
  | 'AccountTransactions'
  | 'Students'
  | 'TrainingProducts'
  | 'TrainingClasses'
  | 'TrainingEnrollments'
  | 'TrainingSessions'
  | 'TrainingAttendances'
  | 'TrainingRevenue'
  | 'TrainingConsumeCorrections'
  | 'TrainingSettlements'
  | 'Events'
  | 'EventTeams'
  | 'EventMatches'
  | 'EventPrizeAwards'
  | 'Merchants'
  | 'CouponTemplates'
  | 'CouponCodes'
  | 'AllianceSettlements'
  | 'Suppliers'
  | 'ConsignmentPayableEntries'
  | 'ConsignmentSettlements'
  | 'ConsignmentSettlementLines'
  | 'ConsignmentTransitions'
  | 'InventoryLocations'
  | 'InventoryItems'
  | 'InventoryStockBalances'
  | 'InventoryTransactions'
  | 'PurchaseOrders'
  | 'PurchaseOrderLines'
  | 'PurchaseReceipts'
  | 'PurchaseReceiptLines'
  | 'Stocktakes'
  | 'StocktakeLines'
  | 'InventoryOperations'
  | 'AuditLogs'
  | 'ReconciliationPeriods';

const ALL_DATASETS: DatasetName[] = [
  'Orders',
  'OrderItems',
  'Payments',
  'Refunds',
  'Members',
  'Accounts',
  'AccountTransactions',
  'Students',
  'TrainingProducts',
  'TrainingClasses',
  'TrainingEnrollments',
  'TrainingSessions',
  'TrainingAttendances',
  'TrainingRevenue',
  'TrainingConsumeCorrections',
  'TrainingSettlements',
  'Events',
  'EventTeams',
  'EventMatches',
  'EventPrizeAwards',
  'Merchants',
  'CouponTemplates',
  'CouponCodes',
  'AllianceSettlements',
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
  'AuditLogs',
  'ReconciliationPeriods',
];

const DATASETS_BY_SCOPE: Record<ExportScope, DatasetName[]> = {
  orders: ['Orders', 'OrderItems', 'Payments', 'Refunds'],
  members: ['Members', 'Accounts', 'AccountTransactions'],
  training: [
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
  ],
  events: [
    'Orders',
    'OrderItems',
    'Payments',
    'Refunds',
    'Events',
    'EventTeams',
    'EventMatches',
    'EventPrizeAwards',
  ],
  alliance: [
    'Merchants',
    'CouponTemplates',
    'CouponCodes',
    'AllianceSettlements',
  ],
  inventory: [
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
  ],
  audit: ['AuditLogs', 'ReconciliationPeriods'],
  finance: [
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
  ],
  all: ALL_DATASETS,
  migration: ALL_DATASETS,
};

const EXPORT_ROLES = new Set<AppRole>([
  AppRole.FINANCE,
  AppRole.ADMIN,
  AppRole.SUPER_ADMIN,
]);

type ExportRow = Record<string, unknown>;

const excelSafeString = (value: string) =>
  /^[=+\-@]/.test(value) ? `'${value}` : value;

const jsonReplacer = (_key: string, value: unknown) => {
  if (typeof value === 'bigint') return value.toString();
  if (
    value &&
    typeof value === 'object' &&
    'toJSON' in value &&
    typeof value.toJSON === 'function'
  ) {
    return value.toJSON();
  }
  return value;
};

const maskPhone = (value: string) => {
  if (value.length < 7) return '***';
  return `${value.slice(0, 3)}****${value.slice(-4)}`;
};

const cellValue = (key: string, value: unknown): string | number | boolean => {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') {
    return excelSafeString(/phone/i.test(key) ? maskPhone(value) : value);
  }
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return value.toString();
  return excelSafeString(JSON.stringify(value, jsonReplacer));
};

@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  async workbook(
    scope: string,
    actor: AuthUser,
  ): Promise<{ filename: string; buffer: Buffer }> {
    const privilegedRole = actor.roles.find((role) => EXPORT_ROLES.has(role));
    if (!privilegedRole) throw new ForbiddenException('无权导出经营数据');
    if (!SCOPES.includes(scope as ExportScope))
      throw new BadRequestException('不支持的导出范围');

    const exportScope = scope as ExportScope;
    const exportedAt = new Date();
    const datasets = await Promise.all(
      DATASETS_BY_SCOPE[exportScope].map(async (name) => ({
        name,
        rows: await this.data(name, exportScope),
      })),
    );

    const workbook = new ExcelJS.Workbook();
    workbook.creator = '延庆羽毛球馆会员生态系统';
    workbook.created = exportedAt;
    this.addManifest(
      workbook,
      exportScope,
      actor,
      privilegedRole,
      exportedAt,
      datasets,
    );
    for (const dataset of datasets)
      this.addDataSheet(workbook, dataset.name, dataset.rows);

    const content = await workbook.xlsx.writeBuffer();
    const sheetRows = Object.fromEntries(
      datasets.map(({ name, rows }) => [name, rows.length]),
    );
    await this.prisma.auditLog.create({
      data: {
        actorId: actor.sub,
        actorRole: privilegedRole,
        action: 'DATA_EXPORTED',
        objectType: 'Export',
        objectId: exportScope,
        newValue: {
          scope: exportScope,
          format: 'xlsx',
          exportedAt: exportedAt.toISOString(),
          rowLimitPerSheet: EXPORT_ROW_LIMIT,
          sheetRows,
        } as never,
      },
    });
    return {
      filename: `yanqing-${exportScope}-${exportedAt.toISOString().slice(0, 10)}.xlsx`,
      buffer: Buffer.from(content),
    };
  }

  private addManifest(
    workbook: ExcelJS.Workbook,
    scope: ExportScope,
    actor: AuthUser,
    actorRole: AppRole,
    exportedAt: Date,
    datasets: Array<{ name: DatasetName; rows: ExportRow[] }>,
  ) {
    const sheet = workbook.addWorksheet('ExportManifest');
    sheet.columns = [
      { header: 'field', key: 'field', width: 28 },
      { header: 'value', key: 'value', width: 72 },
    ];
    const metadata = [
      { field: 'scope', value: scope },
      { field: 'exportedAt', value: exportedAt.toISOString() },
      { field: 'actorId', value: actor.sub },
      { field: 'actorRole', value: actorRole },
      { field: 'format', value: 'xlsx' },
      { field: 'rowLimitPerSheet', value: EXPORT_ROW_LIMIT },
      ...datasets.flatMap(({ name, rows }) => [
        { field: `sheet.${name}.rows`, value: rows.length },
        {
          field: `sheet.${name}.limitReached`,
          value: rows.length === EXPORT_ROW_LIMIT,
        },
      ]),
    ];
    for (const row of metadata) sheet.addRow(row);
    this.styleSheet(sheet, 2);
  }

  private addDataSheet(
    workbook: ExcelJS.Workbook,
    name: DatasetName,
    rows: ExportRow[],
  ) {
    const sheet = workbook.addWorksheet(name);
    const keys = [...new Set(rows.flatMap((row) => Object.keys(row)))];
    const columns = keys.length ? keys : ['message'];
    sheet.columns = columns.map((key) => ({
      header: key,
      key,
      width: Math.max(16, Math.min(42, key.length * 2 + 8)),
    }));
    if (rows.length) {
      for (const row of rows) {
        sheet.addRow(
          Object.fromEntries(
            columns.map((key) => [key, cellValue(key, row[key])]),
          ),
        );
      }
    } else {
      sheet.addRow({ message: '暂无数据' });
    }
    this.styleSheet(sheet, columns.length);
  }

  private styleSheet(sheet: ExcelJS.Worksheet, columnCount: number) {
    sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    sheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF1C5D4F' },
    };
    sheet.views = [{ state: 'frozen', ySplit: 1 }];
    sheet.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: 1, column: columnCount },
    };
  }

  private async data(
    dataset: DatasetName,
    scope: ExportScope,
  ): Promise<ExportRow[]> {
    const scopedBusinessType =
      scope === 'training'
        ? BusinessType.TRAINING
        : scope === 'events'
          ? BusinessType.EVENT
          : scope === 'inventory'
            ? BusinessType.GOODS
            : undefined;
    if (dataset === 'Orders') {
      return this.prisma.order.findMany({
        where: scopedBusinessType
          ? { businessType: scopedBusinessType }
          : undefined,
        orderBy: { createdAt: 'desc' },
        take: EXPORT_ROW_LIMIT,
      }) as never;
    }
    if (dataset === 'OrderItems') {
      return this.prisma.orderItem.findMany({
        where: scopedBusinessType
          ? { order: { businessType: scopedBusinessType } }
          : undefined,
        orderBy: { id: 'asc' },
        take: EXPORT_ROW_LIMIT,
      }) as never;
    }
    if (dataset === 'Payments') {
      return this.prisma.payment.findMany({
        where: scopedBusinessType
          ? { order: { businessType: scopedBusinessType } }
          : undefined,
        select: {
          id: true,
          paymentNo: true,
          orderId: true,
          userId: true,
          channel: true,
          amountCents: true,
          status: true,
          providerTradeNo: true,
          idempotencyKey: true,
          paidAt: true,
          createdAt: true,
          updatedAt: true,
        },
        orderBy: { createdAt: 'desc' },
        take: EXPORT_ROW_LIMIT,
      }) as never;
    }
    if (dataset === 'Refunds') {
      return this.prisma.refund.findMany({
        where: scopedBusinessType
          ? { order: { businessType: scopedBusinessType } }
          : undefined,
        orderBy: { requestedAt: 'desc' },
        take: EXPORT_ROW_LIMIT,
      }) as never;
    }
    if (dataset === 'Members') {
      return this.prisma.user.findMany({
        where: { memberProfile: { isNot: null } },
        select: {
          id: true,
          displayName: true,
          phone: true,
          primaryRole: true,
          status: true,
          createdAt: true,
          updatedAt: true,
        },
        orderBy: { createdAt: 'desc' },
        take: EXPORT_ROW_LIMIT,
      }) as never;
    }
    if (dataset === 'Accounts') {
      return this.prisma.account.findMany({
        orderBy: [{ userId: 'asc' }, { type: 'asc' }],
        take: EXPORT_ROW_LIMIT,
      }) as never;
    }
    if (dataset === 'AccountTransactions') {
      return this.prisma.accountTransaction.findMany({
        orderBy: { createdAt: 'desc' },
        take: EXPORT_ROW_LIMIT,
      }) as never;
    }
    if (dataset === 'Students') {
      return this.prisma.student.findMany({
        orderBy: { createdAt: 'desc' },
        take: EXPORT_ROW_LIMIT,
      }) as never;
    }
    if (dataset === 'TrainingProducts') {
      return this.prisma.trainingProduct.findMany({
        orderBy: { createdAt: 'desc' },
        take: EXPORT_ROW_LIMIT,
      }) as never;
    }
    if (dataset === 'TrainingClasses') {
      return this.prisma.trainingClass.findMany({
        orderBy: { createdAt: 'desc' },
        take: EXPORT_ROW_LIMIT,
      }) as never;
    }
    if (dataset === 'TrainingEnrollments') {
      return this.prisma.trainingEnrollment.findMany({
        orderBy: { createdAt: 'desc' },
        take: EXPORT_ROW_LIMIT,
      }) as never;
    }
    if (dataset === 'TrainingSessions') {
      return this.prisma.trainingSession.findMany({
        orderBy: { startsAt: 'desc' },
        take: EXPORT_ROW_LIMIT,
      }) as never;
    }
    if (dataset === 'TrainingAttendances') {
      return this.prisma.trainingAttendance.findMany({
        orderBy: { createdAt: 'desc' },
        take: EXPORT_ROW_LIMIT,
      }) as never;
    }
    if (dataset === 'TrainingRevenue') {
      return this.prisma.trainingRevenueRecognition.findMany({
        orderBy: { createdAt: 'desc' },
        take: EXPORT_ROW_LIMIT,
      }) as never;
    }
    if (dataset === 'TrainingConsumeCorrections') {
      return this.prisma.trainingConsumeCorrection.findMany({
        orderBy: { requestedAt: 'desc' },
        take: EXPORT_ROW_LIMIT,
      }) as never;
    }
    if (dataset === 'TrainingSettlements') {
      return this.prisma.trainingSettlement.findMany({
        orderBy: { periodEnd: 'desc' },
        take: EXPORT_ROW_LIMIT,
      }) as never;
    }
    if (dataset === 'Events') {
      return this.prisma.event.findMany({
        orderBy: { startsAt: 'desc' },
        take: EXPORT_ROW_LIMIT,
      }) as never;
    }
    if (dataset === 'EventTeams') {
      return this.prisma.eventTeam.findMany({
        orderBy: { createdAt: 'desc' },
        take: EXPORT_ROW_LIMIT,
      }) as never;
    }
    if (dataset === 'EventMatches') {
      return this.prisma.eventMatch.findMany({
        orderBy: [{ eventId: 'asc' }, { round: 'asc' }, { createdAt: 'asc' }],
        take: EXPORT_ROW_LIMIT,
      }) as never;
    }
    if (dataset === 'EventPrizeAwards') {
      return this.prisma.eventPrizeAward.findMany({
        orderBy: { issuedAt: 'desc' },
        take: EXPORT_ROW_LIMIT,
      }) as never;
    }
    if (dataset === 'Merchants') {
      return this.prisma.merchant.findMany({
        orderBy: { code: 'asc' },
        take: EXPORT_ROW_LIMIT,
      }) as never;
    }
    if (dataset === 'CouponTemplates') {
      return this.prisma.couponTemplate.findMany({
        orderBy: { createdAt: 'desc' },
        take: EXPORT_ROW_LIMIT,
      }) as never;
    }
    if (dataset === 'CouponCodes') {
      return this.prisma.couponCode.findMany({
        orderBy: { createdAt: 'desc' },
        take: EXPORT_ROW_LIMIT,
      }) as never;
    }
    if (dataset === 'AllianceSettlements') {
      return this.prisma.allianceSettlement.findMany({
        orderBy: { periodEnd: 'desc' },
        take: EXPORT_ROW_LIMIT,
      }) as never;
    }
    if (dataset === 'Suppliers') {
      return this.prisma.supplier.findMany({
        orderBy: { code: 'asc' },
        take: EXPORT_ROW_LIMIT,
      }) as never;
    }
    if (dataset === 'ConsignmentPayableEntries') {
      return this.prisma.consignmentPayableEntry.findMany({
        orderBy: [{ occurredAt: 'desc' }, { createdAt: 'desc' }],
        take: EXPORT_ROW_LIMIT,
      }) as never;
    }
    if (dataset === 'ConsignmentSettlements') {
      return this.prisma.consignmentSettlement.findMany({
        orderBy: [{ periodEnd: 'desc' }, { version: 'desc' }],
        take: EXPORT_ROW_LIMIT,
      }) as never;
    }
    if (dataset === 'ConsignmentSettlementLines') {
      return this.prisma.consignmentSettlementLine.findMany({
        orderBy: [{ settlementId: 'asc' }, { createdAt: 'asc' }],
        take: EXPORT_ROW_LIMIT,
      }) as never;
    }
    if (dataset === 'ConsignmentTransitions') {
      return this.prisma.consignmentSettlementTransition.findMany({
        orderBy: [{ settlementId: 'asc' }, { createdAt: 'asc' }],
        take: EXPORT_ROW_LIMIT,
      }) as never;
    }
    if (dataset === 'InventoryLocations') {
      return this.prisma.inventoryLocation.findMany({
        orderBy: { code: 'asc' },
        take: EXPORT_ROW_LIMIT,
      }) as never;
    }
    if (dataset === 'InventoryItems') {
      return this.prisma.inventoryItem.findMany({
        orderBy: { sku: 'asc' },
        take: EXPORT_ROW_LIMIT,
      }) as never;
    }
    if (dataset === 'InventoryStockBalances') {
      return this.prisma.inventoryStockBalance.findMany({
        orderBy: [
          { itemId: 'asc' },
          { locationId: 'asc' },
          { batchCode: 'asc' },
        ],
        take: EXPORT_ROW_LIMIT,
      }) as never;
    }
    if (dataset === 'InventoryTransactions') {
      return this.prisma.inventoryTransaction.findMany({
        orderBy: { createdAt: 'desc' },
        take: EXPORT_ROW_LIMIT,
      }) as never;
    }
    if (dataset === 'PurchaseOrders') {
      return this.prisma.purchaseOrder.findMany({
        orderBy: { createdAt: 'desc' },
        take: EXPORT_ROW_LIMIT,
      }) as never;
    }
    if (dataset === 'PurchaseOrderLines') {
      return this.prisma.purchaseOrderLine.findMany({
        orderBy: { id: 'asc' },
        take: EXPORT_ROW_LIMIT,
      }) as never;
    }
    if (dataset === 'PurchaseReceipts') {
      return this.prisma.purchaseReceipt.findMany({
        orderBy: { receivedAt: 'desc' },
        take: EXPORT_ROW_LIMIT,
      }) as never;
    }
    if (dataset === 'PurchaseReceiptLines') {
      return this.prisma.purchaseReceiptLine.findMany({
        orderBy: { id: 'asc' },
        take: EXPORT_ROW_LIMIT,
      }) as never;
    }
    if (dataset === 'Stocktakes') {
      return this.prisma.stocktake.findMany({
        orderBy: { createdAt: 'desc' },
        take: EXPORT_ROW_LIMIT,
      }) as never;
    }
    if (dataset === 'StocktakeLines') {
      return this.prisma.stocktakeLine.findMany({
        orderBy: { id: 'asc' },
        take: EXPORT_ROW_LIMIT,
      }) as never;
    }
    if (dataset === 'InventoryOperations') {
      return this.prisma.inventoryOperation.findMany({
        orderBy: { createdAt: 'desc' },
        take: EXPORT_ROW_LIMIT,
      }) as never;
    }
    if (dataset === 'AuditLogs') {
      return this.prisma.auditLog.findMany({
        orderBy: { createdAt: 'desc' },
        take: EXPORT_ROW_LIMIT,
      }) as never;
    }
    return this.prisma.reconciliationPeriod.findMany({
      orderBy: { businessDate: 'desc' },
      take: EXPORT_ROW_LIMIT,
    }) as never;
  }
}
