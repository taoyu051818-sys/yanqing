import { Inject, Injectable } from '@nestjs/common';
import type { AuthUser } from '../../common/auth/auth-user.js';
import { PrismaService } from '../../database/prisma.service.js';
import type {
  GovernanceUserQueryDto,
  SetUserRolesDto,
  SetUserStatusDto,
} from '../governance.dto.js';
import {
  users,
  setUserRoles,
  setUserStatus,
} from './governance-users.commands.js';

@Injectable()
export class GovernanceUsersService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}
  async users(query: GovernanceUserQueryDto, actor: AuthUser) {
    return users(this.prisma, query, actor);
  }
  async setUserRoles(userId: string, dto: SetUserRolesDto, actor: AuthUser) {
    return setUserRoles(this.prisma, userId, dto, actor);
  }
  async setUserStatus(userId: string, dto: SetUserStatusDto, actor: AuthUser) {
    return setUserStatus(this.prisma, userId, dto, actor);
  }
}
