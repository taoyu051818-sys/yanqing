import { Inject, Injectable } from '@nestjs/common';
import type { AuthUser } from '../../common/auth/auth-user.js';
import { PrismaService } from '../../database/prisma.service.js';
import { complete } from './games-completion.commands.js';

@Injectable()
export class GameCompletionService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}
  async complete(gameId: string, actor: AuthUser) {
    return complete(this.prisma, gameId, actor);
  }
}
