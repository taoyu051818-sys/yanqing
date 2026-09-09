import { Inject, Injectable } from '@nestjs/common';
import type { AuthUser } from '../../common/auth/auth-user.js';
import { PrismaService } from '../../database/prisma.service.js';
import { type RejectHostDto, type ReviewHostDto } from '../games.dto.js';
import {
  applyHost,
  hostApplications,
  approveHost,
  rejectHost,
} from './games-hosts.commands.js';

@Injectable()
export class GameHostsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}
  async applyHost(actor: AuthUser) {
    return applyHost(this.prisma, actor);
  }
  hostApplications() {
    return hostApplications(this.prisma);
  }
  async approveHost(userId: string, dto: ReviewHostDto, actor: AuthUser) {
    return approveHost(this.prisma, userId, dto, actor);
  }
  async rejectHost(userId: string, dto: RejectHostDto, actor: AuthUser) {
    return rejectHost(this.prisma, userId, dto, actor);
  }
}
