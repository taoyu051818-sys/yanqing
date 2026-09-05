import { Transform, Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
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
  Matches,
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
  @IsOptional()
  @IsIn(['MANUAL', 'INVITE'])
  registrationMode?: 'MANUAL' | 'INVITE';

  @IsOptional()
  @IsBoolean()
  captainPlays?: boolean;

  @IsOptional()
  @IsBoolean()
  consent?: boolean;

  @IsOptional()
  @Transform(({ value }) => normalizeParticipantPhone(value))
  @Matches(/^1[3-9]\d{9}$/, { message: '请填写选手一的11位手机号' })
  playerAPhone?: string;

  @IsOptional()
  @Transform(({ value }) => normalizeParticipantPhone(value))
  @Matches(/^1[3-9]\d{9}$/, { message: '请填写选手二的11位手机号' })
  playerBPhone?: string;
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  playerAName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  playerBName?: string;

  @IsOptional()
  @IsString()
  playerAUserId?: string;

  @IsOptional()
  @IsString()
  playerBUserId?: string;

  /**
   * Optional account-authorized partner. MANUAL instead records two consenting
   * participants' names/contact numbers without creating a partner login.
   */
  @IsOptional()
  @IsString()
  @MinLength(20)
  @MaxLength(100)
  @Matches(/^EP_[A-Za-z0-9_-]+$/)
  partnerInviteCode?: string;

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

export class EventPartnerInviteCodeDto {
  @IsString()
  @MinLength(20)
  @MaxLength(100)
  @Matches(/^EP_[A-Za-z0-9_-]+$/)
  partnerInviteCode: string;
}

export const normalizeParticipantPhone = (value: unknown): string =>
  typeof value === 'string'
    ? value.replace(/[\s-]/g, '').replace(/^\+?86(?=1\d{10}$)/, '')
    : '';

export class CreateEventTeamInviteDto {
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name: string;

  @IsString()
  @MinLength(1)
  @MaxLength(40)
  playerAName: string;

  @Transform(({ value }) => normalizeParticipantPhone(value))
  @Matches(/^1[3-9]\d{9}$/, { message: '请填写选手一的11位手机号' })
  playerAPhone: string;

  @IsEnum(TeamCategory)
  category: TeamCategory;

  @Equals(true, { message: '请确认已征得参赛者同意' })
  consent: boolean;
}

export class AcceptEventTeamInviteDto extends EventPartnerInviteCodeDto {
  @IsString()
  @MinLength(1)
  @MaxLength(40)
  playerBName: string;

  @Transform(({ value }) => normalizeParticipantPhone(value))
  @Matches(/^1[3-9]\d{9}$/, { message: '请填写你的11位手机号' })
  playerBPhone: string;

  @Equals(true, { message: '请确认同意与该队长组队参赛' })
  consent: boolean;
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
