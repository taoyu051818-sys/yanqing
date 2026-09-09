import { Inject, Injectable } from '@nestjs/common';
import type { AuthUser } from '../../../common/auth/auth-user.js';
import { PrismaService } from '../../../database/prisma.service.js';
import { CreateConsignmentSettlementDto } from '../../consignment-settlement.dto.js';
import { createSettlement } from './consignment-settlement-statements.commands.js';

@Injectable()
export class ConsignmentStatementsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}
  async createSettlement(dto: CreateConsignmentSettlementDto, actor: AuthUser) {
    return createSettlement(this.prisma, dto, actor);
  }
}
