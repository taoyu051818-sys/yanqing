import { BadRequestException } from '@nestjs/common';
import {
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  IsInt,
  Min,
  Max,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';

export class PeriodQuery {
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) dateFrom?: string;
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) dateTo?: string;
}
export function period(query: PeriodQuery) {
  const parse = (day: string) => {
    const date = new Date(`${day}T00:00:00+08:00`);
    if (
      !Number.isFinite(date.getTime()) ||
      new Date(date.getTime() + 28800000).toISOString().slice(0, 10) !== day
    )
      throw new BadRequestException('请选择有效日期');
    return date;
  };
  const gte = query.dateFrom ? parse(query.dateFrom) : undefined;
  const end = query.dateTo ? parse(query.dateTo) : undefined;
  if (gte && end && gte > end)
    throw new BadRequestException('开始日期不能晚于结束日期');
  return {
    ...(gte ? { gte } : {}),
    ...(end ? { lt: new Date(end.getTime() + 86400000) } : {}),
  };
}
export class TimelineQuery extends PeriodQuery {
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim() || undefined : value,
  )
  @IsOptional()
  @IsString()
  @MaxLength(50)
  keyword?: string;
  @IsOptional() @IsIn(['EXTERNAL', 'ACCOUNTS']) scope: 'EXTERNAL' | 'ACCOUNTS' =
    'EXTERNAL';
  @IsOptional()
  @IsIn([
    'CASH_PRINCIPAL',
    'GIFT_BALANCE',
    'BADMINTON_COIN',
    'EVENT_POINTS',
    'GROWTH_POINTS',
  ])
  accountType?: string;
  @IsOptional() @IsString() @MaxLength(300) cursor?: string;
  @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize = 20;
}
export class RefundTimelineQuery extends TimelineQuery {
  @IsOptional()
  @IsIn([
    'ACTIVE',
    'ALL',
    'REQUESTED',
    'APPROVED',
    'PROCESSING',
    'FAILED',
    'SUCCEEDED',
    'REJECTED',
  ])
  status = 'ACTIVE';
}
export function decodeCursor(value?: string): { at: Date; id: string } | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString());
    if (
      typeof parsed.at !== 'string' ||
      typeof parsed.id !== 'string' ||
      parsed.id.length > 150 ||
      !parsed.id
    )
      throw new Error();
    const at = new Date(parsed.at);
    if (!Number.isFinite(at.getTime())) throw new Error();
    return { at, id: parsed.id };
  } catch {
    throw new BadRequestException('分页位置无效，请刷新列表');
  }
}
export const encodeCursor = (at: Date, id: string) =>
  Buffer.from(JSON.stringify({ at: at.toISOString(), id })).toString(
    'base64url',
  );
