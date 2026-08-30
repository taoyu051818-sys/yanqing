import { Type } from 'class-transformer'
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator'

import { BusinessType, OrderStatus, PaymentChannel } from '../generated/prisma/enums.js'

export class OrderQueryDto {
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
  @IsEnum(BusinessType)
  businessType?: BusinessType

  @IsOptional()
  @IsEnum(OrderStatus)
  status?: OrderStatus
}

export class PayOrderDto {
  @IsEnum(PaymentChannel)
  channel: PaymentChannel

  @IsString()
  @MinLength(8)
  @MaxLength(100)
  idempotencyKey: string
}

export class RequestRefundDto {
  /**
   * A client generated key makes retries (for example after a flaky network
   * response) return the original refund request instead of creating a second
   * one.  It is optional for older clients; the service derives a stable key
   * when it is omitted.
   */
  @IsOptional()
  @IsString()
  @MinLength(8)
  @MaxLength(100)
  idempotencyKey?: string

  @Type(() => Number)
  @IsInt()
  @Min(1)
  amountCents: number

  @IsString()
  @MinLength(2)
  @MaxLength(300)
  reason: string
}

export class ReviewRefundDto {
  @IsString()
  @MinLength(2)
  @MaxLength(300)
  reason: string
}
