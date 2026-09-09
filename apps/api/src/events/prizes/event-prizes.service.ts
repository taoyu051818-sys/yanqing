import { listPrizeAwards, issuePrize, receivePrize } from './event-prizes.js';
import { Inject, Injectable } from '@nestjs/common';
import type { AuthUser } from '../../common/auth/auth-user.js';
import { PrismaService } from '../../database/prisma.service.js';
import type {
  IssueEventPrizeDto,
  ReceiveEventPrizeDto,
} from '../events.dto.js';

@Injectable()
export class EventPrizesService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async listPrizeAwards(eventId: string) {
    return listPrizeAwards(this.prisma, eventId);
  }

  async issuePrize(eventId: string, dto: IssueEventPrizeDto, actor: AuthUser) {
    return issuePrize(this.prisma, eventId, dto, actor);
  }

  async receivePrize(
    eventId: string,
    awardId: string,
    dto: ReceiveEventPrizeDto,
    actor: AuthUser,
  ) {
    return receivePrize(this.prisma, eventId, awardId, dto, actor);
  }
}
