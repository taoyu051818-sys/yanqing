import ExcelJS from 'exceljs';
import type { AuthUser } from '../../common/auth/auth-user.js';
import { AppRole } from '../../generated/prisma/enums.js';
import {
  EXPORT_ROW_LIMIT,
  ExportScope,
  DatasetName,
  ExportRow,
  cellValue,
} from '../report-definitions.js';

export function addManifest(
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
    { field: 'consistency', value: 'REPEATABLE_READ' },
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
  styleSheet(sheet, 2);
}

export function addDataSheet(
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
  styleSheet(sheet, columns.length);
}

export function styleSheet(sheet: ExcelJS.Worksheet, columnCount: number) {
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
