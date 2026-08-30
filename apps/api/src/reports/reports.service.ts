import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common'
import ExcelJS from 'exceljs'

import type { AuthUser } from '../common/auth/auth-user.js'
import { PrismaService } from '../database/prisma.service.js'
import { AppRole } from '../generated/prisma/enums.js'

const EXPORT_ROW_LIMIT = 10_000
const SCOPES = [
  'orders',
  'members',
  'training',
  'alliance',
  'inventory',
  'audit',
  'finance',
  'all',
  'migration',
] as const
type ExportScope = (typeof SCOPES)[number]

type DatasetName =
  | 'Orders'
  | 'OrderItems'
  | 'Payments'
  | 'Refunds'
  | 'Members'
  | 'Accounts'
  | 'AccountTransactions'
  | 'TrainingEnrollments'
  | 'TrainingSessions'
  | 'TrainingAttendances'
  | 'TrainingRevenue'
  | 'TrainingSettlements'
  | 'Merchants'
  | 'CouponTemplates'
  | 'CouponCodes'
  | 'AllianceSettlements'
  | 'InventoryItems'
  | 'InventoryTransactions'
  | 'AuditLogs'
  | 'ReconciliationPeriods'

const ALL_DATASETS: DatasetName[] = [
  'Orders',
  'OrderItems',
  'Payments',
  'Refunds',
  'Members',
  'Accounts',
  'AccountTransactions',
  'TrainingEnrollments',
  'TrainingSessions',
  'TrainingAttendances',
  'TrainingRevenue',
  'TrainingSettlements',
  'Merchants',
  'CouponTemplates',
  'CouponCodes',
  'AllianceSettlements',
  'InventoryItems',
  'InventoryTransactions',
  'AuditLogs',
  'ReconciliationPeriods',
]

const DATASETS_BY_SCOPE: Record<ExportScope, DatasetName[]> = {
  orders: ['Orders', 'OrderItems', 'Payments', 'Refunds'],
  members: ['Members', 'Accounts', 'AccountTransactions'],
  training: [
    'TrainingEnrollments',
    'TrainingSessions',
    'TrainingAttendances',
    'TrainingRevenue',
    'TrainingSettlements',
  ],
  alliance: ['Merchants', 'CouponTemplates', 'CouponCodes', 'AllianceSettlements'],
  inventory: ['InventoryItems', 'InventoryTransactions'],
  audit: ['AuditLogs', 'ReconciliationPeriods'],
  finance: [
    'Payments',
    'Refunds',
    'AccountTransactions',
    'TrainingRevenue',
    'TrainingSettlements',
    'AllianceSettlements',
    'ReconciliationPeriods',
  ],
  all: ALL_DATASETS,
  migration: ALL_DATASETS,
}

const EXPORT_ROLES = new Set<AppRole>([AppRole.FINANCE, AppRole.ADMIN, AppRole.SUPER_ADMIN])

type ExportRow = Record<string, unknown>

const excelSafeString = (value: string) => (/^[=+\-@]/.test(value) ? `'${value}` : value)

const jsonReplacer = (_key: string, value: unknown) => {
  if (typeof value === 'bigint') return value.toString()
  if (value && typeof value === 'object' && 'toJSON' in value && typeof value.toJSON === 'function') {
    return value.toJSON()
  }
  return value
}

const maskPhone = (value: string) => {
  if (value.length < 7) return '***'
  return `${value.slice(0, 3)}****${value.slice(-4)}`
}

const cellValue = (key: string, value: unknown): string | number | boolean => {
  if (value === null || value === undefined) return ''
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'string') {
    return excelSafeString(/phone/i.test(key) ? maskPhone(value) : value)
  }
  if (typeof value === 'number' || typeof value === 'boolean') return value
  if (typeof value === 'bigint') return value.toString()
  return excelSafeString(JSON.stringify(value, jsonReplacer))
}

@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  async workbook(scope: string, actor: AuthUser): Promise<{ filename: string; buffer: Buffer }> {
    const privilegedRole = actor.roles.find((role) => EXPORT_ROLES.has(role))
    if (!privilegedRole) throw new ForbiddenException('无权导出经营数据')
    if (!SCOPES.includes(scope as ExportScope)) throw new BadRequestException('不支持的导出范围')

    const exportScope = scope as ExportScope
    const exportedAt = new Date()
    const datasets = await Promise.all(
      DATASETS_BY_SCOPE[exportScope].map(async (name) => ({ name, rows: await this.data(name) })),
    )

    const workbook = new ExcelJS.Workbook()
    workbook.creator = '延庆羽毛球馆会员生态系统'
    workbook.created = exportedAt
    this.addManifest(workbook, exportScope, actor, privilegedRole, exportedAt, datasets)
    for (const dataset of datasets) this.addDataSheet(workbook, dataset.name, dataset.rows)

    const content = await workbook.xlsx.writeBuffer()
    const sheetRows = Object.fromEntries(datasets.map(({ name, rows }) => [name, rows.length]))
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
    })
    return {
      filename: `yanqing-${exportScope}-${exportedAt.toISOString().slice(0, 10)}.xlsx`,
      buffer: Buffer.from(content),
    }
  }

  private addManifest(
    workbook: ExcelJS.Workbook,
    scope: ExportScope,
    actor: AuthUser,
    actorRole: AppRole,
    exportedAt: Date,
    datasets: Array<{ name: DatasetName; rows: ExportRow[] }>,
  ) {
    const sheet = workbook.addWorksheet('ExportManifest')
    sheet.columns = [
      { header: 'field', key: 'field', width: 28 },
      { header: 'value', key: 'value', width: 72 },
    ]
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
    ]
    for (const row of metadata) sheet.addRow(row)
    this.styleSheet(sheet, 2)
  }

  private addDataSheet(workbook: ExcelJS.Workbook, name: DatasetName, rows: ExportRow[]) {
    const sheet = workbook.addWorksheet(name)
    const keys = [...new Set(rows.flatMap((row) => Object.keys(row)))]
    const columns = keys.length ? keys : ['message']
    sheet.columns = columns.map((key) => ({
      header: key,
      key,
      width: Math.max(16, Math.min(42, key.length * 2 + 8)),
    }))
    if (rows.length) {
      for (const row of rows) {
        sheet.addRow(Object.fromEntries(columns.map((key) => [key, cellValue(key, row[key])])))
      }
    } else {
      sheet.addRow({ message: '暂无数据' })
    }
    this.styleSheet(sheet, columns.length)
  }

  private styleSheet(sheet: ExcelJS.Worksheet, columnCount: number) {
    sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } }
    sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1C5D4F' } }
    sheet.views = [{ state: 'frozen', ySplit: 1 }]
    sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columnCount } }
  }

  private async data(dataset: DatasetName): Promise<ExportRow[]> {
    if (dataset === 'Orders') {
      return this.prisma.order.findMany({ orderBy: { createdAt: 'desc' }, take: EXPORT_ROW_LIMIT }) as never
    }
    if (dataset === 'OrderItems') {
      return this.prisma.orderItem.findMany({ orderBy: { id: 'asc' }, take: EXPORT_ROW_LIMIT }) as never
    }
    if (dataset === 'Payments') {
      return this.prisma.payment.findMany({
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
      }) as never
    }
    if (dataset === 'Refunds') {
      return this.prisma.refund.findMany({ orderBy: { requestedAt: 'desc' }, take: EXPORT_ROW_LIMIT }) as never
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
      }) as never
    }
    if (dataset === 'Accounts') {
      return this.prisma.account.findMany({ orderBy: [{ userId: 'asc' }, { type: 'asc' }], take: EXPORT_ROW_LIMIT }) as never
    }
    if (dataset === 'AccountTransactions') {
      return this.prisma.accountTransaction.findMany({ orderBy: { createdAt: 'desc' }, take: EXPORT_ROW_LIMIT }) as never
    }
    if (dataset === 'TrainingEnrollments') {
      return this.prisma.trainingEnrollment.findMany({ orderBy: { createdAt: 'desc' }, take: EXPORT_ROW_LIMIT }) as never
    }
    if (dataset === 'TrainingSessions') {
      return this.prisma.trainingSession.findMany({ orderBy: { startsAt: 'desc' }, take: EXPORT_ROW_LIMIT }) as never
    }
    if (dataset === 'TrainingAttendances') {
      return this.prisma.trainingAttendance.findMany({ orderBy: { createdAt: 'desc' }, take: EXPORT_ROW_LIMIT }) as never
    }
    if (dataset === 'TrainingRevenue') {
      return this.prisma.trainingRevenueRecognition.findMany({ orderBy: { createdAt: 'desc' }, take: EXPORT_ROW_LIMIT }) as never
    }
    if (dataset === 'TrainingSettlements') {
      return this.prisma.trainingSettlement.findMany({ orderBy: { periodEnd: 'desc' }, take: EXPORT_ROW_LIMIT }) as never
    }
    if (dataset === 'Merchants') {
      return this.prisma.merchant.findMany({ orderBy: { code: 'asc' }, take: EXPORT_ROW_LIMIT }) as never
    }
    if (dataset === 'CouponTemplates') {
      return this.prisma.couponTemplate.findMany({ orderBy: { createdAt: 'desc' }, take: EXPORT_ROW_LIMIT }) as never
    }
    if (dataset === 'CouponCodes') {
      return this.prisma.couponCode.findMany({ orderBy: { createdAt: 'desc' }, take: EXPORT_ROW_LIMIT }) as never
    }
    if (dataset === 'AllianceSettlements') {
      return this.prisma.allianceSettlement.findMany({ orderBy: { periodEnd: 'desc' }, take: EXPORT_ROW_LIMIT }) as never
    }
    if (dataset === 'InventoryItems') {
      return this.prisma.inventoryItem.findMany({ orderBy: { sku: 'asc' }, take: EXPORT_ROW_LIMIT }) as never
    }
    if (dataset === 'InventoryTransactions') {
      return this.prisma.inventoryTransaction.findMany({ orderBy: { createdAt: 'desc' }, take: EXPORT_ROW_LIMIT }) as never
    }
    if (dataset === 'AuditLogs') {
      return this.prisma.auditLog.findMany({ orderBy: { createdAt: 'desc' }, take: EXPORT_ROW_LIMIT }) as never
    }
    return this.prisma.reconciliationPeriod.findMany({ orderBy: { businessDate: 'desc' }, take: EXPORT_ROW_LIMIT }) as never
  }
}
