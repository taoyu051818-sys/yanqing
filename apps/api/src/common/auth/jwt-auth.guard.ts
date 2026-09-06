import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Optional,
  UnauthorizedException,
} from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { Reflector } from '@nestjs/core'
import { AdminAuthService } from '../../admin-auth/admin-auth.service.js'
import type { Request } from 'express'
import { ConfigService } from '@nestjs/config'

import { PrismaService } from '../../database/prisma.service.js'
import { UserStatus } from '../../generated/prisma/enums.js'
import type { AuthUser } from './auth-user.js'
import { IS_PUBLIC_KEY } from './auth.decorators.js'
import { loginMethodAllowed } from './login-policy.js'

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    @Optional() private readonly adminAuth?: AdminAuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ])
    if (isPublic) return true

    const request = context
      .switchToHttp()
      .getRequest<{ headers: Record<string, string | string[] | undefined>; user?: AuthUser }>()
    const authorization = request.headers.authorization
    const header = Array.isArray(authorization) ? authorization[0] : authorization
    const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined
    if (!token && !header && this.adminAuth && this.config.get('ADMIN_CONSOLE_ORIGIN') && request.headers.cookie) {
      request.user = await this.adminAuth.authenticate(request as unknown as Request)
      return true
    }
    if (!token) throw new UnauthorizedException('缺少登录凭证')

    let claims: Partial<AuthUser> & { loginMethod?: unknown }
    try {
      claims = await this.jwt.verifyAsync<Partial<AuthUser>>(token)
    } catch {
      throw new UnauthorizedException('登录凭证无效或已过期')
    }
    if (!claims.sub || typeof claims.sub !== 'string') {
      throw new UnauthorizedException('登录凭证缺少用户标识')
    }
    if (!loginMethodAllowed(claims.loginMethod, this.config)) {
      throw new UnauthorizedException('此登录会话已停用，请重新微信登录')
    }

    // JWT 中的角色只是一份签发时快照，不能作为长期授权依据。每次受保护
    // 请求都读取一个窄字段身份快照，使停用、软删除和角色撤销立即生效。
    const user = await this.prisma.user.findUnique({
      where: { id: claims.sub },
      select: {
        id: true,
        displayName: true,
        status: true,
        deletedAt: true,
        primaryRole: true,
        roles: { select: { role: true } },
      },
    })
    if (!user || user.status !== UserStatus.ACTIVE || user.deletedAt) {
      throw new UnauthorizedException('用户不存在、已停用或已删除')
    }

    request.user = {
      loginMethod: claims.loginMethod === 'wechat' ? 'wechat' : 'development',
      sub: user.id,
      displayName: user.displayName,
      roles: [...new Set([user.primaryRole, ...user.roles.map(({ role }) => role)])],
    }
    return true
  }
}
