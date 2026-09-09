import { Inject, Injectable } from '@nestjs/common';
import type { AuthUser } from '../../common/auth/auth-user.js';
import { PrismaService } from '../../database/prisma.service.js';
import { type CancelGameDto } from '../games.dto.js';
import { cancel } from './games-cancellation.commands.js';

@Injectable()
export class GameCancellationService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}
  async cancel(gameId: string, dto: CancelGameDto, actor: AuthUser) {
    return cancel(this.prisma, gameId, dto, actor);
  }
}
