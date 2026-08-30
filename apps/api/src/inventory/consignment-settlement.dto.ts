import { Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

import {
  ConsignmentPayableEntryType,
  SettlementStatus,
} from '../generated/prisma/enums.js';

export class ConsignmentPayableQueryDto {
  @IsOptional()
  @IsString()
  supplierId?: string;

  @IsOptional()
  @IsEnum(ConsignmentPayableEntryType)
  type?: ConsignmentPayableEntryType;

  @IsOptional()
  @IsDateString()
  periodStart?: string;

  @IsOptional()
  @IsDateString()
  periodEnd?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  pageSize = 50;
}

export class ConsignmentSettlementQueryDto {
  @IsOptional()
  @IsString()
  supplierId?: string;

  @IsOptional()
  @IsEnum(SettlementStatus)
  status?: SettlementStatus;

  @IsOptional()
  @IsDateString()
  periodStart?: string;

  @IsOptional()
  @IsDateString()
  periodEnd?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 30;
}

export class CreateConsignmentSettlementDto {
  @IsString()
  supplierId: string;

  @IsDateString()
  periodStart: string;

  @IsDateString()
  periodEnd: string;

  @IsString()
  @MinLength(2)
  @MaxLength(300)
  reason: string;

  @IsString()
  @MinLength(8)
  @MaxLength(100)
  idempotencyKey: string;
}

export class ConsignmentSettlementActionDto {
  @IsString()
  @MinLength(2)
  @MaxLength(300)
  reason: string;

  @IsString()
  @MinLength(8)
  @MaxLength(100)
  idempotencyKey: string;
}

export class SettleConsignmentSettlementDto extends ConsignmentSettlementActionDto {
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  paymentReference: string;
}
