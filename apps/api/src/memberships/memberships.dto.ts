import { Type } from 'class-transformer'
import { IsInt, IsOptional, IsString, MaxLength, Min, MinLength } from 'class-validator'

export class PurchaseMembershipDto {
  @IsString()
  productId: string

  @IsOptional()
  @IsString()
  @MinLength(8)
  @MaxLength(100)
  creationIdempotencyKey?: string
}

export class CreateRechargeDto {
  @Type(() => Number)
  @IsInt()
  @Min(100)
  principalCents: number

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  giftCents = 0

  @IsOptional()
  @IsString()
  @MinLength(8)
  @MaxLength(100)
  creationIdempotencyKey?: string
}
