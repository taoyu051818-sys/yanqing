import { Inject, Injectable } from '@nestjs/common';
import type { AuthUser } from '../../common/auth/auth-user.js';
import { PrismaService } from '../../database/prisma.service.js';
import { grantMatured } from './games-rewards.commands.js';

@Injectable()
export class GameRewardsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}
  async grantMatured(actor: AuthUser) {
    return grantMatured(this.prisma, actor);
  }
}
