import { IsOptional, IsString, MaxLength } from 'class-validator'

/** Optional context retained in the audit log when finance closes a day. */
export class CloseReconciliationPeriodDto {
  @IsOptional()
  @IsString()
  @MaxLength(300)
  reason?: string
}
