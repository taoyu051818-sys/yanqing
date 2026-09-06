import type { AppRole } from '../../generated/prisma/enums.js'

export interface AuthUser {
  loginMethod?: 'wechat' | 'development' | 'admin'
  adminSessionId?: string
  sub: string
  roles: AppRole[]
  displayName: string
}
