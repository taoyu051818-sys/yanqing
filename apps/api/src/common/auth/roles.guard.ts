import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common'
import { Reflector } from '@nestjs/core'

import type { AppRole } from '../../generated/prisma/enums.js'
import type { AuthUser } from './auth-user.js'
import { ROLES_KEY } from './auth.decorators.js'

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<AppRole[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ])
    if (!required?.length) return true
    const user = context.switchToHttp().getRequest<{ user: AuthUser }>().user
    if (required.some((role) => user.roles.includes(role))) return true
    throw new ForbiddenException('当前角色无权执行此操作')
  }
}
