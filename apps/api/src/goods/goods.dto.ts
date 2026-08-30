import { Type } from 'class-transformer'
import { ArrayMinSize, IsArray, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength, ValidateNested } from 'class-validator'

export class GoodsCartItemDto {
  @IsString()
  itemId: string

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  quantity: number
}

export class CreateGoodsOrderDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => GoodsCartItemDto)
  items: GoodsCartItemDto[]

  @IsOptional()
  @IsString()
  @MinLength(8)
  @MaxLength(100)
  creationIdempotencyKey?: string
}
