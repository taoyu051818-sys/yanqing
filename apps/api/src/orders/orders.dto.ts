import { Transform, Type } from 'class-transformer'
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

// Older mini-program builds serialized an absent optional query as a literal
// "undefined". Normalize only empty sentinels, never an unknown enum value.
const optionalFilter = ({ value }: { value: unknown }) =>
  value === '' || value === 'undefined' || value === 'null' ? undefined : value

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

  @Transform(optionalFilter)
  @IsOptional()
  @IsEnum(BusinessType, { message: '订单类型筛选无效，请重新选择' })
  businessType?: BusinessType

  @Transform(optionalFilter)
  @IsOptional()
  @IsEnum(OrderStatus, { message: '订单状态筛选无效，请重新选择' })
  status?: OrderStatus
}

export class PayOrderDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  expectedDebitAmount?: number

  @IsEnum(PaymentChannel)
  channel: PaymentChannel

  @IsString()
  @MinLength(8)
  @MaxLength(100)
  idempotencyKey: string
}

export class CancelPendingOrderDto {
  @IsString()
  @MinLength(8)
  @MaxLength(100)
  idempotencyKey: string

  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(300)
  reason?: string
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
