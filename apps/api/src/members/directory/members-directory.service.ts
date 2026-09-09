import { Inject, Injectable } from '@nestjs/common';
import type { AuthUser } from '../../common/auth/auth-user.js';
import { PrismaService } from '../../database/prisma.service.js';
import type { MemberQueryDto } from '../members.dto.js';
import { list } from './members-directory.commands.js';
import { profile } from './member-profile.query.js';
import { customer360 } from './customer-profile.query.js';

@Injectable()
export class MemberDirectoryService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}
  async list(query: MemberQueryDto, actor: AuthUser) {
    return list(this.prisma, query, actor);
  }
  async profile(userId: string, actor: AuthUser) {
    return profile(this.prisma, userId, actor);
  }
  async customer360(userId: string, actor: AuthUser) {
    return customer360(this.prisma, userId, actor);
  }
}
