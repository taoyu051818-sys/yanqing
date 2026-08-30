import type { AppRole } from '../../generated/prisma/enums.js'

export interface AuthUser {
  sub: string
  roles: AppRole[]
  displayName: string
}
