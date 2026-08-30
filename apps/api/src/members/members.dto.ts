import { Type } from 'class-transformer'
import {
  IsBooleanString,
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator'

import { AccountAdjustmentStatus, AccountType, LeadStatus, MemberLevel, SourceChannel } from '../generated/prisma/enums.js'

export class MemberQueryDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 20

  @IsOptional()
  @IsString()
  @MaxLength(50)
  keyword?: string

  @IsOptional()
  @IsEnum(MemberLevel)
  level?: MemberLevel
}

export class AdjustAccountDto {
  @IsEnum(AccountType)
  accountType: AccountType

  @Type(() => Number)
  @IsInt()
  amount: number

  @IsString()
  @MinLength(2)
  @MaxLength(200)
  reason: string

  @IsString()
  @MinLength(8)
  @MaxLength(100)
  idempotencyKey: string
}

export class AccountAdjustmentQueryDto {
  @IsOptional()
  @IsEnum(AccountAdjustmentStatus)
  status?: AccountAdjustmentStatus
}

export class ReviewAccountAdjustmentDto {
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  reason: string
}

export class BindReferralDto {
  @IsString()
  @MinLength(1)
  referrerId: string
}

export class LeadQueryDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 20

  @IsOptional()
  @IsString()
  @MaxLength(50)
  keyword?: string

  @IsOptional()
  @IsEnum(LeadStatus)
  status?: LeadStatus

  @IsOptional()
  @IsEnum(SourceChannel)
  sourceChannel?: SourceChannel

  @IsOptional()
  @IsString()
  ownerId?: string

  @IsOptional()
  @IsBooleanString()
  overdue?: string
}

export class CreateLeadDto {
  @IsString()
  @MinLength(1)
  @MaxLength(40)
  displayName: string

  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string

  @IsEnum(SourceChannel)
  sourceChannel: SourceChannel

  @IsOptional()
  @IsString()
  @MaxLength(80)
  campaign?: string

  @IsOptional()
  @IsString()
  referrerId?: string

  @IsOptional()
  @IsString()
  ownerId?: string

  @IsOptional()
  @IsDateString()
  nextFollowUpAt?: string

  @IsOptional()
  @IsDateString()
  slaDueAt?: string
}

export class AssignLeadDto {
  @IsString()
  @MinLength(1)
  ownerId: string
}

export class AddLeadFollowUpDto {
  @IsString()
  @MinLength(1)
  @MaxLength(30)
  kind: string

  @IsString()
  @MinLength(2)
  @MaxLength(1000)
  content: string

  @IsOptional()
  @IsEnum(LeadStatus)
  nextStatus?: LeadStatus

  @IsOptional()
  @IsDateString()
  nextFollowUpAt?: string
}

export class ConvertLeadDto {
  @IsString()
  @MinLength(1)
  memberId: string
}

export class LoseLeadDto {
  @IsString()
  @MinLength(2)
  @MaxLength(300)
  reason: string
}

export class ArchiveLeadDto {
  @IsString()
  @MinLength(2)
  @MaxLength(300)
  reason: string
}
