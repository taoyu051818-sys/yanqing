import { Inject, Injectable } from '@nestjs/common';
import type { AuthUser } from '../../../common/auth/auth-user.js';
import { PrismaService } from '../../../database/prisma.service.js';
import {
  ConsignmentPayableQueryDto,
  ConsignmentSettlementQueryDto,
} from '../../consignment-settlement.dto.js';
import {
  supplierOptions,
  listPayables,
  listSettlements,
  detail,
} from './consignment-settlement-queries.commands.js';

@Injectable()
export class ConsignmentQueriesService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}
  async supplierOptions(actor: AuthUser) {
    return supplierOptions(this.prisma, actor);
  }
  async listPayables(query: ConsignmentPayableQueryDto, actor: AuthUser) {
    return listPayables(this.prisma, query, actor);
  }
  async listSettlements(query: ConsignmentSettlementQueryDto, actor: AuthUser) {
    return listSettlements(this.prisma, query, actor);
  }
  async detail(id: string, actor: AuthUser) {
    return detail(this.prisma, id, actor);
  }
}
