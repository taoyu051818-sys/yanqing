import { Transform, Type } from 'class-transformer'
import {
  IsBoolean,
  IsDateString,
  IsDefined,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator'

import { ParameterType } from '../generated/prisma/enums.js'

export class ParameterQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  prefix?: string

  @IsOptional()
  @IsDateString()
  at?: string
}

export class CreateParameterDto {
  @IsString()
  @MaxLength(120)
  key: string

  @IsDefined()
  value: unknown

  @IsEnum(ParameterType)
  type: ParameterType

  @IsString()
  @MaxLength(300)
  description: string

  @IsString()
  @MinLength(2)
  @MaxLength(300)
  reason: string

  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  locked = false

  @IsDateString()
  effectiveFrom: string
}

export class PaginationDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 20
}
