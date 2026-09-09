import { startNextRound, correctPairings } from './event-rounds.js';
import { submitScore, correctScore } from './event-scoring.js';
import { finish } from './event-completion.js';
import { Inject, Injectable } from '@nestjs/common';
import type { AuthUser } from '../../common/auth/auth-user.js';
import { PrismaService } from '../../database/prisma.service.js';
import type {
  CorrectScoreDto,
  CorrectEventPairingsDto,
  SubmitScoreDto,
} from '../events.dto.js';

@Injectable()
export class EventCompetitionService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async startNextRound(eventId: string, actor: AuthUser) {
    return startNextRound(this.prisma, eventId, actor);
  }

  async correctPairings(
    eventId: string,
    round: number,
    dto: CorrectEventPairingsDto,
    actor: AuthUser,
  ) {
    return correctPairings(this.prisma, eventId, round, dto, actor);
  }

  async submitScore(matchId: string, dto: SubmitScoreDto, actor: AuthUser) {
    return submitScore(this.prisma, matchId, dto, actor);
  }

  async correctScore(matchId: string, dto: CorrectScoreDto, actor: AuthUser) {
    return correctScore(this.prisma, matchId, dto, actor);
  }

  async finish(eventId: string, actor: AuthUser) {
    return finish(this.prisma, eventId, actor);
  }
}
