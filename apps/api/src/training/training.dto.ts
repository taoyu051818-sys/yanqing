import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

import {
  SettlementStatus,
  SourceChannel,
  TrainingAudience,
} from '../generated/prisma/enums.js';
import { AttendanceStatus } from '../generated/prisma/enums.js';

export class CreateStudentDto {
  @IsString()
  @MaxLength(40)
  displayName: string;

  /** Month-level precision is sufficient for age-band placement. */
  @IsOptional()
  @IsDateString()
  birthMonth?: string;

  @IsBoolean()
  guardianConsentStatus: boolean;

  /** Staff must record the offline/electronic authorization evidence. */
  @IsOptional()
  @IsString()
  @MaxLength(300)
  authorizationNote?: string;

  /** Front desk/admin may onboard a child for a known guardian account. */
  @IsOptional()
  @IsString()
  guardianId?: string;
}

export class UpdateStudentDto {
  @IsOptional()
  @IsString()
  @MaxLength(40)
  displayName?: string;

  @IsOptional()
  @IsDateString()
  birthMonth?: string;

  @IsOptional()
  @IsBoolean()
  guardianConsentStatus?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  authorizationNote?: string;
}

class AuditedTrainingCreationDto {
  /** Business justification stored on the immutable audit entry. */
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(300)
  reason?: string;

  /**
   * A client-generated key makes a retried creation command return the
   * original object.  Reusing the key with a different normalized command is
   * rejected instead of silently accepting different data.
   */
  @IsOptional()
  @IsString()
  @MinLength(8)
  @MaxLength(100)
  creationIdempotencyKey?: string;
}

export class CreateTrainingProductDto extends AuditedTrainingCreationDto {
  @IsString()
  @MaxLength(40)
  code: string;

  @IsString()
  @MaxLength(100)
  name: string;

  @IsEnum(TrainingAudience)
  audience: TrainingAudience;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  totalSessions: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(730)
  validityDays: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  priceCents: number;

  @IsObject()
  refundRule: Record<string, unknown>;
}

export class CreateTrainingClassDto extends AuditedTrainingCreationDto {
  @IsString()
  @MaxLength(40)
  code: string;

  @IsString()
  productId: string;

  @IsString()
  @MaxLength(100)
  name: string;

  @IsOptional()
  @IsString()
  coachId?: string;

  @IsOptional()
  @IsString()
  assistantId?: string;

  @IsObject()
  schedule: Record<string, unknown>;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  capacity: number;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  coachCostCents = 0;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  assistantCostCents = 0;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  materialCostCents = 0;
}

export class PurchaseTrainingDto {
  @IsString()
  productId: string;

  @IsOptional()
  @IsString()
  classId?: string;

  @IsOptional()
  @IsString()
  studentId?: string;

  @IsEnum(SourceChannel)
  sourceChannel: SourceChannel = SourceChannel.MINI_PROGRAM;

  @IsOptional()
  @IsString()
  @MinLength(8)
  @MaxLength(100)
  creationIdempotencyKey?: string;
}

export class CreateTrainingSessionDto extends AuditedTrainingCreationDto {
  @IsString()
  classId: string;

  @IsDateString()
  startsAt: string;

  @IsDateString()
  endsAt: string;

  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  courtIds: string[];

  @IsOptional()
  @IsString()
  @MaxLength(300)
  note?: string;
}

/** Audited command metadata for a training-session status transition. */
export class TrainingSessionActionDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(300)
  reason?: string;

  @IsOptional()
  @IsString()
  @MinLength(8)
  @MaxLength(100)
  idempotencyKey?: string;
}

export class ConsumeTrainingDto {
  @IsString()
  enrollmentId: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  feedback?: string;

  /**
   * The mini-app historically sent PRESENT while the API domain uses
   * ATTENDED.  Keep accepting both values so the endpoint remains wire
   * compatible; the service still keeps the proposal in PENDING until an
   * authorised approver posts the consumption.
   */
  @IsOptional()
  @IsIn(['PRESENT', 'ATTENDED'])
  attendanceStatus?: 'PRESENT' | 'ATTENDED';
}

/**
 * Confirmation is deliberately a separate command even though it carries
 * the same attendance identity.  This makes the maker/checker boundary
 * explicit in the OpenAPI contract and leaves room for a future reason or
 * evidence field without changing the coach submission payload.
 */
export class ConfirmTrainingConsumeDto {
  @IsString()
  enrollmentId: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  feedback?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  reason?: string;

  @IsOptional()
  @IsString()
  @MinLength(8)
  @MaxLength(100)
  idempotencyKey?: string;
}

export class CreateTrainingConsumeCorrectionDto {
  @IsString()
  recognitionId: string;

  @IsString()
  @MinLength(2)
  @MaxLength(300)
  reason: string;

  @IsString()
  @MinLength(8)
  @MaxLength(100)
  idempotencyKey: string;
}

export class DecideTrainingConsumeCorrectionDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(300)
  reason?: string;

  @IsString()
  @MinLength(8)
  @MaxLength(100)
  idempotencyKey: string;
}

/** Attendance is a separate maker action from financial consumption. */
export class AttendanceActionDto {
  @IsString()
  enrollmentId: string;

  @IsEnum(AttendanceStatus)
  status: AttendanceStatus;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  feedback?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  reason?: string;
}

/** Move a leave record into a later, already scheduled makeup session. */
export class MakeupAttendanceDto {
  @IsString()
  enrollmentId: string;

  @IsString()
  makeupSessionId: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  reason?: string;
}

export class CreateTrainingSettlementDto {
  @IsDateString()
  periodStart: string;

  @IsDateString()
  periodEnd: string;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  acquisitionCostCents = 0;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  marketingCostCents = 0;
}

/** Finance-ledger filters; omitted fields deliberately mean the full ledger. */
export class ListTrainingSettlementsDto {
  @IsOptional()
  @IsDateString()
  periodStart?: string;

  @IsOptional()
  @IsDateString()
  periodEnd?: string;

  @IsOptional()
  @IsEnum(SettlementStatus)
  status?: SettlementStatus;
}

/**
 * Every state-changing command may carry an operator note. Return/void
 * commands require the reason at service level because class-validator cannot
 * vary validation rules by route without duplicating the transport shape.
 */
export class TrainingSettlementActionDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(300)
  reason?: string;

  @IsOptional()
  @IsString()
  @MinLength(8)
  @MaxLength(100)
  idempotencyKey?: string;
}
