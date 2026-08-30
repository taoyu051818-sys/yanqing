import { Body, Controller, Get, Post } from '@nestjs/common'
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger'

import { CurrentUser, Public } from '../common/auth/auth.decorators.js'
import type { AuthUser } from '../common/auth/auth-user.js'
import { AuthService } from './auth.service.js'
import { DevLoginDto, WechatLoginDto } from './auth.dto.js'

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
}
