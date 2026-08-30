import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Equals,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

import { SourceChannel, TeamCategory } from '../generated/prisma/enums.js';

/**
 * The venue's Swiss event format is intentionally not configurable.  Keeping
 * these values next to the transport contract makes it impossible for a
 * client to accidentally create a different tournament variant.
 */
export const EVENT_MINIMUM_PEOPLE = 24 as const;
export const EVENT_MAX_CAPACITY_PEOPLE = 48 as const;
export const EVENT_TOTAL_ROUNDS = 5 as const;

export class CreateEventDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  code: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name: string;

  @IsDateString()
  startsAt: string;

  @IsDateString()
  registrationEndsAt: string;

  @Type(() => Number)
  @IsInt()
  @Min(EVENT_MINIMUM_PEOPLE)
  @Max(EVENT_MAX_CAPACITY_PEOPLE)
  capacityPeople = EVENT_MAX_CAPACITY_PEOPLE;

  @Type(() => Number)
  @IsInt()
  @Equals(EVENT_MINIMUM_PEOPLE)
  minimumPeople = EVENT_MINIMUM_PEOPLE;

  @Type(() => Number)
  @IsInt()
  @Equals(EVENT_TOTAL_ROUNDS)
  totalRounds = EVENT_TOTAL_ROUNDS;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  feeCents: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  memberFeeCents?: number;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  rules?: string[];

  @IsOptional()
  @IsObject()
  prizePool?: Record<string, unknown>;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  sponsor?: string;
}

/**
 * Publishing is an explicit workflow action.  The event is created as a
 * draft and only an operator with the publish permission can make it visible
 * for registration.  The optional reason is retained in the audit log so a
 * reviewer can explain the decision without changing the event schema.
 */
export class PublishEventDto {
  @IsOptional()
  @IsString()
  @MaxLength(300)
  reason?: string;
}

export class CancelEventDto {
  @IsString()
  @MinLength(2)
  @MaxLength(300)
  reason: string;

  @IsString()
  @MinLength(8)
  @MaxLength(100)
  idempotencyKey: string;
}

/** A captain/operator command to withdraw one fixed-doubles registration. */
export class CancelEventRegistrationDto extends CancelEventDto {
  /** Event managers may identify the team they are assisting. */
  @IsOptional()
  @IsString()
  teamId?: string;
}

export class EventTeamCheckInDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(300)
  overrideReason?: string;
}

export class RegisterEventTeamDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  name: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  playerAName: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  playerBName: string;

  @IsOptional()
  @IsString()
  playerAUserId?: string;

  @IsOptional()
  @IsString()
  playerBUserId?: string;

  @IsEnum(TeamCategory)
  category: TeamCategory;

  @IsEnum(SourceChannel)
  sourceChannel: SourceChannel = SourceChannel.MINI_PROGRAM;

  @IsOptional()
  @IsString()
  @MinLength(8)
  @MaxLength(100)
  creationIdempotencyKey?: string;
}

export class SubmitScoreDto {
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(21)
  scoreA: number;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(21)
  scoreB: number;
}

export class CorrectScoreDto extends SubmitScoreDto {
  @IsString()
  @MinLength(2)
  @MaxLength(300)
  reason: string;
}

export class CorrectEventPairingDto {
  @IsString()
  @IsNotEmpty()
  teamAId: string;

  @IsOptional()
  @IsString()
  teamBId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  courtLabel?: string;
}

/**
 * Replace the current round's still-unplayed pairings as one audited command.
 * Requiring the complete round prevents a partial edit from leaving a team
 * duplicated, omitted or assigned both a match and a bye.
 */
export class CorrectEventPairingsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CorrectEventPairingDto)
  pairings: CorrectEventPairingDto[];

  @IsString()
  @MinLength(2)
  @MaxLength(300)
  reason: string;

  @IsString()
  @MinLength(8)
  @MaxLength(100)
  idempotencyKey: string;
}

export class IssueEventPrizeDto {
  @IsString()
  @IsNotEmpty()
  teamId: string;

  @IsString()
  @MinLength(2)
  @MaxLength(80)
  awardName: string;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  @MaxLength(40, { each: true })
  recipientNames?: string[];

  @IsString()
  @IsNotEmpty()
  inventoryItemId: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(999)
  quantity: number;

  @IsString()
  @MinLength(8)
  @MaxLength(100)
  idempotencyKey: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  note?: string;
}

export class ReceiveEventPrizeDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  receivedByName: string;

  @IsString()
  @MinLength(8)
  @MaxLength(100)
  idempotencyKey: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  note?: string;
}
