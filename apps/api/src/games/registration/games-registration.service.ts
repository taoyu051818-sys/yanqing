import { Inject, Injectable } from '@nestjs/common';
import type { AuthUser } from '../../common/auth/auth-user.js';
import { PrismaService } from '../../database/prisma.service.js';
import { type GameCheckInDto, type RegisterGameDto } from '../games.dto.js';
import {
  register,
  promoteWaitlist,
  checkIn,
} from './games-registration.commands.js';

@Injectable()
export class GameRegistrationService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}
  async register(gameId: string, dto: RegisterGameDto, actor: AuthUser) {
    return register(this.prisma, gameId, dto, actor);
  }
  async promoteWaitlist(gameId: string, actor: AuthUser) {
    return promoteWaitlist(this.prisma, gameId, actor);
  }
  async checkIn(
    gameId: string,
    userId: string,
    actor: AuthUser,
    dto: GameCheckInDto = {},
  ) {
    return checkIn(this.prisma, gameId, userId, actor, dto);
  }
}
