import {
  canExecuteDirectly,
  directExecutionKey,
} from '../../common/auth/admin-execution.js';
import {
  listConsumeCorrections,
  requestConsumeCorrection,
  approveConsumeCorrection,
  rejectConsumeCorrection,
} from './training-consume-corrections.js';
import { Inject, Injectable } from '@nestjs/common';
import type { AuthUser } from '../../common/auth/auth-user.js';
import { PrismaService } from '../../database/prisma.service.js';
import type {
  CreateTrainingConsumeCorrectionDto,
  DecideTrainingConsumeCorrectionDto,
} from '../training.dto.js';

@Injectable()
export class TrainingCorrectionsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async listConsumeCorrections(actor: AuthUser) {
    return listConsumeCorrections(this.prisma, actor);
  }

  async requestConsumeCorrection(
    dto: CreateTrainingConsumeCorrectionDto,
    actor: AuthUser,
  ) {
    const result = await requestConsumeCorrection(this.prisma, dto, actor);
    if (!canExecuteDirectly(actor) || result.status !== 'REQUESTED')
      return result;
    return approveConsumeCorrection(
      this.prisma,
      result.id,
      {
        reason: dto.reason,
        idempotencyKey: directExecutionKey(
          'consume-correction',
          dto.idempotencyKey,
        ),
      },
      actor,
    );
  }

  async approveConsumeCorrection(
    id: string,
    dto: DecideTrainingConsumeCorrectionDto,
    actor: AuthUser,
  ) {
    return approveConsumeCorrection(this.prisma, id, dto, actor);
  }

  async rejectConsumeCorrection(
    id: string,
    dto: DecideTrainingConsumeCorrectionDto,
    actor: AuthUser,
  ) {
    return rejectConsumeCorrection(this.prisma, id, dto, actor);
  }
}
