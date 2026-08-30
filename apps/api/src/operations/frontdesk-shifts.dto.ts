import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

import { FrontDeskShiftStatus } from '../generated/prisma/enums.js';

export class OpenFrontDeskShiftDto {
  @Type(() => Number)
  @IsInt()
  @Min(0)
  openingCashCents: number;
}

export class CloseFrontDeskShiftDto {
  @Type(() => Number)
  @IsInt()
  @Min(0)
  closingCashCents: number;

  @IsString()
  @MinLength(2)
  @MaxLength(1000)
  handoverNote: string;

  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(300)
  reason?: string;
}

export class ReviewFrontDeskShiftVarianceDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(300)
  reason?: string;
}

export class FrontDeskShiftHistoryQueryDto {
  @IsOptional()
  @IsEnum(FrontDeskShiftStatus)
  status?: FrontDeskShiftStatus;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  operatorId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 30;
}
