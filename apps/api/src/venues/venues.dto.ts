import { Transform, Type } from 'class-transformer'
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsDefined,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  MinLength,
  Min,
  ValidateNested,
} from 'class-validator'

import {
  BookingStatus,
  CourtClosureStatus,
  CourtUsage,
  SourceChannel,
} from '../generated/prisma/enums.js'

export const VENUE_FULFILLMENT_OUTCOMES = [
  BookingStatus.COMPLETED,
  BookingStatus.NO_SHOW,
] as const

export const VENUE_FULFILLMENT_EVIDENCE_SOURCES = [
  'FRONT_DESK_ROLL_CALL',
  'ACCESS_CONTROL_LOG',
  'COURT_INSPECTION',
] as const

export class VenueFulfillmentEvidenceDto {
  /** A controlled source code only; no member name, phone or raw media. */
  @IsIn(VENUE_FULFILLMENT_EVIDENCE_SOURCES)
  source: (typeof VENUE_FULFILLMENT_EVIDENCE_SOURCES)[number]

  @IsDateString()
  observedAt: string
}

export class CompleteVenueBookingDto {
  @IsIn(VENUE_FULFILLMENT_OUTCOMES)
  outcome: (typeof VENUE_FULFILLMENT_OUTCOMES)[number]

  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @IsString()
  @MinLength(2)
  @MaxLength(300)
  reason: string

  @IsDefined()
  @ValidateNested()
  @Type(() => VenueFulfillmentEvidenceDto)
  evidence: VenueFulfillmentEvidenceDto

  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @IsString()
  @MinLength(8)
  @MaxLength(100)
  idempotencyKey: string
}

export class VenueCheckInDto {
  @IsOptional()
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @IsString()
  @MinLength(2)
  @MaxLength(300)
  overrideReason?: string
}

export class AvailabilityQueryDto {
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  date: string
}

export class CreateVenueBookingDto {
  /**
   * Target customer for an operator-assisted booking.  Member requests may
   * omit it (or send their own ID); front-desk and administrator requests are
   * required to select an active member explicitly.
   */
  @IsOptional()
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  memberId?: string

  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  date: string

  @IsString()
  courtId: string

  @IsString()
  slotId: string

  @IsEnum(SourceChannel)
  sourceChannel: SourceChannel = SourceChannel.MINI_PROGRAM

  @IsOptional()
  @IsString()
  @MaxLength(80)
  couponCode?: string

  @IsOptional()
  @IsString()
  @MinLength(8)
  @MaxLength(100)
  creationIdempotencyKey?: string
}

export class UpdateCourtDto {
  @IsOptional()
  @IsEnum(CourtUsage)
  usage?: CourtUsage

  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  enabled?: boolean
}

export class CreatePriceRuleDto {
  @IsString()
  @Matches(/^[A-Z0-9][A-Z0-9_-]{1,39}$/)
  code: string

  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name: string

  @IsOptional()
  @IsString()
  timeSlotId?: string

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(127)
  weekdayMask = 127

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(10_000_000)
  priceCents: number

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(10_000_000)
  newcomerPriceCents?: number

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

export class CreatePriceRuleVersionDto {
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name: string

  @IsOptional()
  @IsString()
  timeSlotId?: string

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(127)
  weekdayMask = 127

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(10_000_000)
  priceCents: number

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(10_000_000)
  newcomerPriceCents?: number

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

export class SetPriceRuleStatusDto {
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

export class ListCourtClosuresQueryDto {
  @IsOptional()
  @IsString()
  courtId?: string

  @IsOptional()
  @IsEnum(CourtClosureStatus)
  status?: CourtClosureStatus

  @IsOptional()
  @IsDateString()
  from?: string

  @IsOptional()
  @IsDateString()
  to?: string
}

export class CreateCourtClosureDto {
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  courtId: string

  @IsDateString()
  startsAt: string

  @IsDateString()
  endsAt: string

  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @IsString()
  @MinLength(2)
  @MaxLength(300)
  reason: string

  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @IsString()
  @MinLength(8)
  @MaxLength(100)
  creationIdempotencyKey: string
}

export class CancelCourtClosureDto {
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @IsString()
  @MinLength(2)
  @MaxLength(300)
  reason: string
}
