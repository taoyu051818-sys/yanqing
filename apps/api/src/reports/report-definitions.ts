import { AppRole } from '../generated/prisma/enums.js';

export const EXPORT_ROW_LIMIT = 10_000;

export const SCOPES = [
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

export type ExportScope = (typeof SCOPES)[number];

export type DatasetName =
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

export const ALL_DATASETS: DatasetName[] = [
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

export const DATASETS_BY_SCOPE: Record<ExportScope, DatasetName[]> = {
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

export const EXPORT_ROLES = new Set<AppRole>([
  AppRole.FINANCE,
  AppRole.ADMIN,
  AppRole.SUPER_ADMIN,
]);

export const EXPORT_ROLE_PRIORITY = [
  AppRole.SUPER_ADMIN,
  AppRole.ADMIN,
  AppRole.FINANCE,
] as const;

export const FINANCE_SCOPES = new Set<ExportScope>(['orders', 'finance']);

export type ExportRow = Record<string, unknown>;

export const FINANCE_BLOCKED_FIELDS = new Set([
  'parameterSnapshot',
  'creationIdempotencyKey',
  'creationCommandHash',
  'idempotencyKey',
  'requestIdempotencyKey',
  'commandHash',
  'metadata',
  'providerPayload',
  'ruleSnapshot',
  'commissionRateBps',
  'detail',
]);

export const financeRows = (rows: ExportRow[]): ExportRow[] =>
  rows.map((row) =>
    Object.fromEntries(
      Object.entries(row).filter(([key]) => !FINANCE_BLOCKED_FIELDS.has(key)),
    ),
  );

export const excelSafeString = (value: string) =>
  /^[=+\-@]/.test(value) ? `'${value}` : value;

export const jsonReplacer = (_key: string, value: unknown) => {
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

export const maskPhone = (value: string) => {
  if (value.length < 7) return '***';
  return `${value.slice(0, 3)}****${value.slice(-4)}`;
};

export const cellValue = (
  key: string,
  value: unknown,
): string | number | boolean => {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') {
    return excelSafeString(/phone/i.test(key) ? maskPhone(value) : value);
  }
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return value.toString();
  return excelSafeString(JSON.stringify(value, jsonReplacer));
};
