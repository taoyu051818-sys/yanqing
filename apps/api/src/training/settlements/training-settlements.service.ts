import {
  financialSummary,
  createSettlement,
  listSettlements,
  submitSettlement,
  confirmSettlement,
  settleSettlement,
  returnSettlement,
  voidSettlement,
} from './training-settlements.js';
import { Inject, Injectable } from '@nestjs/common';
import type { AuthUser } from '../../common/auth/auth-user.js';
import { PrismaService } from '../../database/prisma.service.js';
import type {
  CreateTrainingSettlementDto,
  ListTrainingSettlementsDto,
  TrainingSettlementActionDto,
} from '../training.dto.js';

@Injectable()
export class TrainingSettlementsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async financialSummary(periodStart: Date, periodEnd: Date) {
    return financialSummary(this.prisma, periodStart, periodEnd);
  }

  async createSettlement(dto: CreateTrainingSettlementDto, actor: AuthUser) {
    return createSettlement(this.prisma, dto, actor);
  }

  async listSettlements(query: ListTrainingSettlementsDto, actor: AuthUser) {
    return listSettlements(this.prisma, query, actor);
  }

  submitSettlement(
    id: string,
    dto: TrainingSettlementActionDto,
    actor: AuthUser,
  ) {
    return submitSettlement(this.prisma, id, dto, actor);
  }

  confirmSettlement(
    id: string,
    dto: TrainingSettlementActionDto,
    actor: AuthUser,
  ) {
    return confirmSettlement(this.prisma, id, dto, actor);
  }

  settleSettlement(
    id: string,
    dto: TrainingSettlementActionDto,
    actor: AuthUser,
  ) {
    return settleSettlement(this.prisma, id, dto, actor);
  }

  returnSettlement(
    id: string,
    dto: TrainingSettlementActionDto,
    actor: AuthUser,
  ) {
    return returnSettlement(this.prisma, id, dto, actor);
  }

  voidSettlement(
    id: string,
    dto: TrainingSettlementActionDto,
    actor: AuthUser,
  ) {
    return voidSettlement(this.prisma, id, dto, actor);
  }
}
