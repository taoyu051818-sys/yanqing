import { Transform, Type } from 'class-transformer'
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  MinLength,
  Min,
} from 'class-validator'

import { CourtClosureStatus, CourtUsage, SourceChannel } from '../generated/prisma/enums.js'

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
  @MaxLength(80)
  name: string

  @IsOptional()
  @IsString()
  timeSlotId?: string

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(127)
  weekdayMask = 127

  @Type(() => Number)
  @IsInt()
  @Min(0)
  priceCents: number

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  newcomerPriceCents?: number

  @IsDateString()
  effectiveFrom: string

  @IsOptional()
  @IsDateString()
  effectiveTo?: string
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
