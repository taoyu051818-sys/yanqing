import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common'

import type { AppRole } from '../../generated/prisma/enums.js'
import type { AuthUser } from './auth-user.js'

export const IS_PUBLIC_KEY = 'isPublic'
export const ROLES_KEY = 'roles'

export const Public = () => SetMetadata(IS_PUBLIC_KEY, true)
export const Roles = (...roles: AppRole[]) => SetMetadata(ROLES_KEY, roles)

export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthUser =>
    context.switchToHttp().getRequest<{ user: AuthUser }>().user,
)
