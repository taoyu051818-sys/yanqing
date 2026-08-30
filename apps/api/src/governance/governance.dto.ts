import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
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
  AppRole,
  RiskSeverity,
  RiskStatus,
  UserStatus,
} from '../generated/prisma/enums.js';

export class GovernanceUserQueryDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 20;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  keyword?: string;

  @IsOptional()
  @IsEnum(AppRole)
  role?: AppRole;

  @IsOptional()
  @IsEnum(UserStatus)
  status?: UserStatus;
}

export class SetUserRolesDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsEnum(AppRole, { each: true })
  roles: AppRole[];

  @IsEnum(AppRole)
  primaryRole: AppRole;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  merchantId?: string;

  @IsString()
  @MinLength(2)
  @MaxLength(200)
  reason: string;

  @IsOptional()
  @IsString()
  @MinLength(8)
  @MaxLength(100)
  idempotencyKey?: string;
}

export class SetUserStatusDto {
  @IsEnum(UserStatus)
  status: UserStatus;

  @IsString()
  @MinLength(2)
  @MaxLength(200)
  reason: string;

  @IsOptional()
  @IsString()
  @MinLength(8)
  @MaxLength(100)
  idempotencyKey?: string;
}

export class RiskEventQueryDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 20;

  @IsOptional()
  @IsEnum(RiskStatus)
  status?: RiskStatus;

  @IsOptional()
  @IsEnum(RiskSeverity)
  severity?: RiskSeverity;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  keyword?: string;
}

export class ReviewRiskEventDto {
  @IsString()
  @MinLength(2)
  @MaxLength(300)
  reason: string;

  @IsOptional()
  @IsString()
  @MinLength(8)
  @MaxLength(100)
  idempotencyKey?: string;
}
