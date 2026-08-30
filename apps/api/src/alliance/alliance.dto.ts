import { Type } from 'class-transformer'
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator'

import { MerchantLevel, UserStatus } from '../generated/prisma/enums.js'

export class CreateMerchantDto {
  @IsString()
  @MinLength(2)
  @MaxLength(40)
  code: string

  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name: string

  @IsString()
  @MinLength(2)
  @MaxLength(80)
  category: string

  @IsEnum(MerchantLevel)
  level: MerchantLevel

  @IsOptional()
  @IsString()
  contactName?: string

  @IsOptional()
  @IsString()
  contactPhone?: string

  @IsObject()
  settlementRule: Record<string, unknown>
}

export class CreateCouponTemplateDto {
  @IsString()
  @MinLength(2)
  @MaxLength(40)
  code: string

  @IsString()
  merchantId: string

  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name: string

  @IsString()
  @MinLength(2)
  @MaxLength(120)
  activityName: string

  @IsString()
  @MinLength(2)
  @MaxLength(300)
  benefitDescription: string

  @Type(() => Number)
  @IsInt()
  @Min(0)
  faceValueCents = 0

  @IsDateString()
  validFrom: string

  @IsDateString()
  validTo: string

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  claimLimitPerUser = 1

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100000)
  issueLimit: number
}

export class GenerateCouponCodesDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(2000)
  count: number

  @IsString()
  @MinLength(8)
  @MaxLength(100)
  idempotencyKey: string
}

export class SetMerchantStatusDto {
  @IsEnum(UserStatus)
  status: UserStatus

  @IsString()
  @MinLength(2)
  @MaxLength(300)
  reason: string

  @IsString()
  @MinLength(8)
  @MaxLength(100)
  idempotencyKey: string
}

export class SetCouponTemplateStatusDto {
  @IsBoolean()
  enabled: boolean

  @IsString()
  @MinLength(2)
  @MaxLength(300)
  reason: string

  @IsString()
  @MinLength(8)
  @MaxLength(100)
  idempotencyKey: string
}

export class RedeemCouponDto {
  @IsString()
  @MaxLength(80)
  code: string

  @IsString()
  merchantId: string

  @Type(() => Number)
  @IsInt()
  @Min(0)
  attributedAmountCents = 0

  @IsString()
  @MinLength(8)
  @MaxLength(100)
  idempotencyKey: string
}

export class AllianceSettlementDto {
  @IsString()
  merchantId: string

  @IsDateString()
  periodStart: string

  @IsDateString()
  periodEnd: string

  @Type(() => Number)
  @IsInt()
  @Min(0)
  attributedGrossProfitCents = 0
}

/**
 * The settlement workflow deliberately keeps the action payload small.  The
 * calculated statement is immutable; only a reason can be supplied when a
 * merchant disputes it.  Any subsequent adjustment is recorded as a new
 * audit event instead of silently changing the statement totals.
 */
export class SettlementActionDto {
  @IsOptional()
  @IsString()
  @MaxLength(300)
  reason?: string
}
