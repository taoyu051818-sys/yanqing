import { Type } from 'class-transformer'
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator'

import { MemberLevel } from '../generated/prisma/enums.js'

export class PurchaseMembershipDto {
  @IsString()
  productId: string

  @IsOptional()
  @IsString()
  @MinLength(8)
  @MaxLength(100)
  creationIdempotencyKey?: string
}

export class CreateMembershipProductDto {
  @IsString()
  @Matches(/^[A-Z0-9][A-Z0-9_-]{1,39}$/)
  code: string

  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name: string

  @IsEnum(MemberLevel)
  level: MemberLevel

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(10_000_000)
  priceCents: number

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(3_650)
  durationDays: number

  @IsObject()
  benefits: Record<string, unknown>

  @IsDateString({ strict: true })
  effectiveFrom: string

  @IsOptional()
  @IsDateString({ strict: true })
  effectiveTo?: string

  @IsString()
  @MinLength(2)
  @MaxLength(300)
  reason: string

  @IsString()
  @MinLength(8)
  @MaxLength(100)
  idempotencyKey: string
}

export class CreateMembershipProductVersionDto {
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name: string

  @IsEnum(MemberLevel)
  level: MemberLevel

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(10_000_000)
  priceCents: number

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(3_650)
  durationDays: number

  @IsObject()
  benefits: Record<string, unknown>

  @IsDateString({ strict: true })
  effectiveFrom: string

  @IsOptional()
  @IsDateString({ strict: true })
  effectiveTo?: string

  @IsString()
  @MinLength(2)
  @MaxLength(300)
  reason: string

  @IsString()
  @MinLength(8)
  @MaxLength(100)
  idempotencyKey: string
}

export class SetMembershipProductStatusDto {
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

export class CreateRechargeDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  planId: string

  @IsOptional()
  @IsString()
  @MinLength(8)
  @MaxLength(100)
  creationIdempotencyKey?: string
}

export class CreateRechargePlanDto {
  @IsString()
  @Matches(/^[A-Z0-9][A-Z0-9_-]{1,39}$/)
  code: string

  @IsString()
  @MinLength(2)
  @MaxLength(50)
  name: string

  @Type(() => Number)
  @IsInt()
  @Min(100)
  @Max(10_000_000)
  principalCents: number

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(10_000_000)
  giftCents: number

  @IsDateString({ strict: true })
  effectiveFrom: string

  @IsOptional()
  @IsDateString({ strict: true })
  effectiveTo?: string

  @IsString()
  @MinLength(2)
  @MaxLength(300)
  reason: string

  @IsString()
  @MinLength(8)
  @MaxLength(100)
  idempotencyKey: string
}

export class SetRechargePlanStatusDto {
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
