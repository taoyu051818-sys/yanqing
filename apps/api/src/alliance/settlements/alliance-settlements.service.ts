import { reviseSettlement } from './alliance-settlement-revision.js';
import { Inject, Injectable } from '@nestjs/common';
import type { AuthUser } from '../../common/auth/auth-user.js';
import { PrismaService } from '../../database/prisma.service.js';
import type {
  AllianceSettlementDto,
  ReviseAllianceSettlementDto,
  SettlementActionDto,
} from '../alliance.dto.js';
import {
  createSettlement,
  listSettlements,
  submitSettlement,
  confirmSettlement,
  disputeSettlement,
  settleSettlement,
} from './alliance-settlements.commands.js';

@Injectable()
export class AllianceSettlementsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}
  async createSettlement(dto: AllianceSettlementDto, actor: AuthUser) {
    return createSettlement(this.prisma, dto, actor);
  }
  async listSettlements(actor: AuthUser) {
    return listSettlements(this.prisma, actor);
  }
  submitSettlement(id: string, actor: AuthUser) {
    return submitSettlement(this.prisma, id, actor);
  }
  confirmSettlement(id: string, actor: AuthUser) {
    return confirmSettlement(this.prisma, id, actor);
  }
  async disputeSettlement(
    id: string,
    dto: SettlementActionDto,
    actor: AuthUser,
  ) {
    return disputeSettlement(this.prisma, id, dto, actor);
  }
  reviseSettlement(
    id: string,
    dto: ReviseAllianceSettlementDto,
    actor: AuthUser,
  ) {
    return reviseSettlement(this.prisma, id, dto, actor);
  }
  settleSettlement(id: string, actor: AuthUser) {
    return settleSettlement(this.prisma, id, actor);
  }
}
