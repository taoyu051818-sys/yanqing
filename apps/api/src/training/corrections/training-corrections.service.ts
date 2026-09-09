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
    return requestConsumeCorrection(this.prisma, dto, actor);
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
