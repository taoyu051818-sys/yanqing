import { Inject, Injectable } from '@nestjs/common';
import type { AuthUser } from '../../../common/auth/auth-user.js';
import { PrismaService } from '../../../database/prisma.service.js';
import type {
  CreateTrainingTrialDto,
  TrainingTrialQueryDto,
} from '../../training-operations.dto.js';
import { list, create } from './training-trials-booking.commands.js';

@Injectable()
export class TrainingTrialBookingService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}
  async list(query: TrainingTrialQueryDto, actor: AuthUser, mine = false) {
    return list(this.prisma, query, actor, mine);
  }
  async create(dto: CreateTrainingTrialDto, actor: AuthUser) {
    return create(this.prisma, dto, actor);
  }
}
