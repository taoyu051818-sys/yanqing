import { Inject, Injectable } from '@nestjs/common';
import type { AuthUser } from '../../../common/auth/auth-user.js';
import { PrismaService } from '../../../database/prisma.service.js';
import {
  ConsignmentSettlementActionDto,
  SettleConsignmentSettlementDto,
} from '../../consignment-settlement.dto.js';
import {
  submitSettlement,
  confirmSettlement,
  disputeSettlement,
  returnSettlement,
  settleSettlement,
  voidSettlement,
} from './consignment-settlement-workflow.commands.js';

@Injectable()
export class ConsignmentWorkflowService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}
  submitSettlement(
    id: string,
    dto: ConsignmentSettlementActionDto,
    actor: AuthUser,
  ) {
    return submitSettlement(this.prisma, id, dto, actor);
  }
  confirmSettlement(
    id: string,
    dto: ConsignmentSettlementActionDto,
    actor: AuthUser,
  ) {
    return confirmSettlement(this.prisma, id, dto, actor);
  }
  disputeSettlement(
    id: string,
    dto: ConsignmentSettlementActionDto,
    actor: AuthUser,
  ) {
    return disputeSettlement(this.prisma, id, dto, actor);
  }
  returnSettlement(
    id: string,
    dto: ConsignmentSettlementActionDto,
    actor: AuthUser,
  ) {
    return returnSettlement(this.prisma, id, dto, actor);
  }
  settleSettlement(
    id: string,
    dto: SettleConsignmentSettlementDto,
    actor: AuthUser,
  ) {
    return settleSettlement(this.prisma, id, dto, actor);
  }
  voidSettlement(
    id: string,
    dto: ConsignmentSettlementActionDto,
    actor: AuthUser,
  ) {
    return voidSettlement(this.prisma, id, dto, actor);
  }
}
