import { Type } from 'class-transformer'
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator'

import {
  SourceChannel,
  TrainingTrialStatus,
  YouthTrainingRuleStatus,
} from '../generated/prisma/enums.js'

export class TrainingTrialQueryDto {
  @IsOptional()
  @IsEnum(TrainingTrialStatus)
  status?: TrainingTrialStatus

  @IsOptional()
  @IsDateString()
  from?: string

  @IsOptional()
  @IsDateString()
  to?: string
}

export class CreateTrainingTrialDto {
  @IsOptional()
  @IsString()
  leadId?: string

  @IsOptional()
  @IsString()
  studentId?: string

  @IsOptional()
  @IsString()
  memberId?: string

  @IsString()
  productId: string

  @IsOptional()
  @IsString()
  classId?: string

  @IsOptional()
  @IsString()
  sessionId?: string

  @IsString()
  coachId: string

  @IsEnum(SourceChannel)
  sourceChannel: SourceChannel

  @IsDateString()
  scheduledStartsAt: string

  @IsDateString()
  scheduledEndsAt: string

  @IsString()
  @MinLength(2)
  @MaxLength(300)
  reason: string

  @IsString()
  @MinLength(8)
  @MaxLength(100)
  idempotencyKey: string
}

export class TrainingTrialActionDto {
  @IsString()
  @MinLength(2)
  @MaxLength(300)
  reason: string

  @IsString()
  @MinLength(8)
  @MaxLength(100)
  idempotencyKey: string
}

export class TrainingTrialDimensionDto {
  @IsString()
  @MinLength(1)
  @MaxLength(40)
  key: string

  @IsString()
  @MinLength(1)
  @MaxLength(80)
  label: string

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  score: number

  @IsOptional()
  @IsString()
  @MaxLength(300)
  note?: string
}

export class AssessTrainingTrialDto extends TrainingTrialActionDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => TrainingTrialDimensionDto)
  dimensions: TrainingTrialDimensionDto[]

  @IsString()
  @MinLength(2)
  @MaxLength(500)
  recommendation: string

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string
}

export class ConvertTrainingTrialDto extends TrainingTrialActionDto {
  @IsString()
  enrollmentId: string
}

export class CreateYouthTrainingRuleDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  maxTotalSessions: number

  @Type(() => Number)
  @IsInt()
  @Min(1)
  maxValidityDays: number

  @Type(() => Number)
  @IsInt()
  @Min(1)
  maxContractAmountCents: number

  @Type(() => Number)
  @IsInt()
  @Min(0)
  warningThresholdDays: number

  @IsBoolean()
  hardBlock: boolean

  @IsDateString()
  effectiveFrom: string

  @IsString()
  @MinLength(2)
  @MaxLength(300)
  reason: string

  @IsString()
  @MinLength(8)
  @MaxLength(100)
  idempotencyKey: string
}

export class DecideYouthTrainingRuleDto extends TrainingTrialActionDto {}

export class YouthTrainingRuleQueryDto {
  @IsOptional()
  @IsEnum(YouthTrainingRuleStatus)
  status?: YouthTrainingRuleStatus
}
