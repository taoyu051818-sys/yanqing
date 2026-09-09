import { Inject, Injectable } from '@nestjs/common';
import type { AuthUser } from '../../../common/auth/auth-user.js';
import { PrismaService } from '../../../database/prisma.service.js';
import type {
  AssessTrainingTrialDto,
  ConvertTrainingTrialDto,
  TrainingTrialActionDto,
} from '../../training-operations.dto.js';
import {
  checkIn,
  noShow,
  assess,
  convert,
  lost,
  cancel,
} from './training-trials-follow-up.commands.js';

@Injectable()
export class TrainingTrialFollowUpService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}
  checkIn(id: string, dto: TrainingTrialActionDto, actor: AuthUser) {
    return checkIn(this.prisma, id, dto, actor);
  }
  noShow(id: string, dto: TrainingTrialActionDto, actor: AuthUser) {
    return noShow(this.prisma, id, dto, actor);
  }
  async assess(id: string, dto: AssessTrainingTrialDto, actor: AuthUser) {
    return assess(this.prisma, id, dto, actor);
  }
  async convert(id: string, dto: ConvertTrainingTrialDto, actor: AuthUser) {
    return convert(this.prisma, id, dto, actor);
  }
  lost(id: string, dto: TrainingTrialActionDto, actor: AuthUser) {
    return lost(this.prisma, id, dto, actor);
  }
  cancel(id: string, dto: TrainingTrialActionDto, actor: AuthUser) {
    return cancel(this.prisma, id, dto, actor);
  }
}
