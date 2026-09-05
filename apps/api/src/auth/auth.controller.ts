import { Body, Controller, Get, Patch, Post, UploadedFile, UseInterceptors } from '@nestjs/common'
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger'
import { FileInterceptor } from '@nestjs/platform-express'
import { memoryStorage } from 'multer'

import { CurrentUser, Public } from '../common/auth/auth.decorators.js'
import type { AuthUser } from '../common/auth/auth-user.js'
import { AuthService } from './auth.service.js'
import { DevLoginDto, UpdateMyProfileDto, WechatLoginDto } from './auth.dto.js'

@ApiTags('认证')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('wechat-login')
  wechatLogin(@Body() dto: WechatLoginDto) {
    return this.auth.wechatLogin(dto)
  }

  @Public()
  @Post('dev-login')
  devLogin(@Body() dto: DevLoginDto) {
    return this.auth.devLogin(dto)
  }

  @ApiBearerAuth()
  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return this.auth.me(user.sub)
  }

  @ApiBearerAuth()
  @Patch('profile')
  updateProfile(@Body() dto: UpdateMyProfileDto, @CurrentUser() user: AuthUser) {
    return this.auth.updateProfile(user.sub, dto)
  }

  @ApiBearerAuth()
  @Post('profile/avatar')
  @UseInterceptors(FileInterceptor('avatar', {
    storage: memoryStorage(),
    limits: { fileSize: 1_500_000, files: 1 },
  }))
  uploadAvatar(@UploadedFile() file: Express.Multer.File, @CurrentUser() user: AuthUser) {
    return this.auth.updateAvatar(user.sub, file)
  }
}
