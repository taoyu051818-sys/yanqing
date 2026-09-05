import { IsEnum, IsOptional, IsString, Length, MaxLength, MinLength } from 'class-validator'

import { AppRole } from '../generated/prisma/enums.js'

export class WechatLoginDto {
  @IsString()
  @Length(3, 256)
  code: string
}

export class DevLoginDto {
  @IsOptional()
  @IsString()
  userId?: string

  @IsOptional()
  @IsEnum(AppRole)
  role?: AppRole
}

export class UpdateMyProfileDto {
  @IsString()
  @MinLength(1)
  @MaxLength(40)
  displayName: string
}
