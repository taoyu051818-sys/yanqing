import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import ExcelJS from 'exceljs';
import type { AuthUser } from '../common/auth/auth-user.js';
import { PrismaService } from '../database/prisma.service.js';
import { AppRole } from '../generated/prisma/enums.js';
import { Prisma } from '../generated/prisma/client.js';
import {
  EXPORT_ROW_LIMIT,
  SCOPES,
  ExportScope,
  DatasetName,
  DATASETS_BY_SCOPE,
  EXPORT_ROLES,
  EXPORT_ROLE_PRIORITY,
  FINANCE_SCOPES,
  ExportRow,
} from './report-definitions.js';
import { addManifest, addDataSheet } from './workbook/workbook-format.js';
import { data } from './datasets/report-data.js';

@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  async workbook(
    scope: string,
    actor: AuthUser,
  ): Promise<{ filename: string; buffer: Buffer }> {
    const authorizationRole = EXPORT_ROLE_PRIORITY.find((role) =>
      actor.roles.includes(role),
    );
    if (!authorizationRole || !EXPORT_ROLES.has(authorizationRole)) {
      throw new ForbiddenException('无权导出经营数据');
    }
    if (!SCOPES.includes(scope as ExportScope))
      throw new BadRequestException('不支持的导出范围');

    const exportScope = scope as ExportScope;
    const isAdministrator = actor.roles.some((role) =>
      ([AppRole.ADMIN, AppRole.SUPER_ADMIN] as AppRole[]).includes(role),
    );
    if (!isAdministrator && !FINANCE_SCOPES.has(exportScope)) {
      throw new ForbiddenException('财务角色仅可导出订单与财务账簿数据');
    }
    const exportedAt = new Date();
    const datasets = await this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SET TRANSACTION READ ONLY`;
        const result: Array<{ name: DatasetName; rows: ExportRow[] }> = [];
        for (const name of DATASETS_BY_SCOPE[exportScope]) {
          result.push({
            name,
            rows: await data(tx, name, exportScope, isAdministrator),
          });
        }
        return result;
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
        timeout: 30000,
      },
    );

    const workbook = new ExcelJS.Workbook();
    workbook.creator = '延庆羽毛球馆会员生态系统';
    workbook.created = exportedAt;
    addManifest(
      workbook,
      exportScope,
      actor,
      authorizationRole,
      exportedAt,
      datasets,
    );
    for (const dataset of datasets)
      addDataSheet(workbook, dataset.name, dataset.rows);

    const content = await workbook.xlsx.writeBuffer();
    const sheetRows = Object.fromEntries(
      datasets.map(({ name, rows }) => [name, rows.length]),
    );
    await this.prisma.auditLog.create({
      data: {
        actorId: actor.sub,
        actorRole: authorizationRole,
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

  /**
   * Finance exports are accounting views, not database snapshots. Keep these
   * selects explicit so internal replay evidence and business-rule snapshots
   * cannot be exposed merely because a model gains another column.
   */
}
