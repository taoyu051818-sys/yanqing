import { Inject, Injectable } from '@nestjs/common';
import type { AuthUser } from '../../common/auth/auth-user.js';
import { PrismaService } from '../../database/prisma.service.js';
import type {
  ReviewRiskEventDto,
  RiskEventQueryDto,
} from '../governance.dto.js';
import { RiskAction } from '../shared/governance-support.js';
import { riskEvents, transitionRisk } from './governance-risks.commands.js';

@Injectable()
export class GovernanceRisksService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}
  async riskEvents(query: RiskEventQueryDto, actor: AuthUser) {
    return riskEvents(this.prisma, query, actor);
  }
  async transitionRisk(
    riskId: string,
    action: RiskAction,
    dto: ReviewRiskEventDto,
    actor: AuthUser,
  ) {
    return transitionRisk(this.prisma, riskId, action, dto, actor);
  }
}
