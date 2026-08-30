import { Type } from 'class-transformer'
import {
  ArrayMinSize,
  IsArray,
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

import { GameLevel, SourceChannel } from '../generated/prisma/enums.js'

export const GAME_CAPACITY_MIN = 4
export const GAME_CAPACITY_MAX = 6

export class ReviewHostDto {
  @IsOptional()
  @IsString()
  @MaxLength(300)
  reason?: string
}

export class RejectHostDto {
  @IsString()
  @MaxLength(300)
  reason: string
}

/**
 * A game is created as a draft and only becomes visible to members after an
 * operator has reviewed its time, courts, capacity and pricing.  Keeping the
 * publish reason in the command gives the operations desk an audit-friendly
 * hand-off without adding mutable approval fields to the Game row.
 */
export class PublishGameDto {
  @IsOptional()
  @IsString()
  @MaxLength(300)
  reason?: string
}

export class CancelGameDto {
  @IsString()
  @MinLength(2)
  @MaxLength(300)
  reason: string

  @IsString()
  @MinLength(8)
  @MaxLength(100)
  idempotencyKey: string
}

export class GameCheckInDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(300)
  overrideReason?: string
}

export class CreateGameDto {
  @IsString()
  @MaxLength(120)
  title: string

  @IsEnum(GameLevel)
  level: GameLevel

  @IsDateString()
  startsAt: string

  @IsDateString()
  endsAt: string

  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  courtIds: string[]

  @Type(() => Number)
  @IsInt()
  @Min(GAME_CAPACITY_MIN)
  @Max(GAME_CAPACITY_MAX)
  capacity: number

  @Type(() => Number)
  @IsInt()
  @Min(0)
  feeCents: number

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string

  @IsOptional()
  @IsObject()
  rewardRule?: Record<string, unknown>
}

export class RegisterGameDto {
  @IsEnum(SourceChannel)
  sourceChannel: SourceChannel = SourceChannel.MINI_PROGRAM

  @IsOptional()
  @IsString()
  @MinLength(8)
  @MaxLength(100)
  creationIdempotencyKey?: string
}
