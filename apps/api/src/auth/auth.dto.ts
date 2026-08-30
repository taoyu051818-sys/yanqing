import { IsEnum, IsOptional, IsString, Length, MaxLength } from 'class-validator'

import { AppRole } from '../generated/prisma/enums.js'

export class WechatLoginDto {
  @IsString()
  @Length(3, 256)
  code: string

  @IsOptional()
  @IsString()
  @MaxLength(40)
  displayName?: string

  @IsOptional()
  @IsString()
  @MaxLength(500)
  avatarUrl?: string
}

export class DevLoginDto {
  @IsOptional()
  @IsString()
  userId?: string

  @IsOptional()
  @IsEnum(AppRole)
  role?: AppRole
}
