import { Inject, Injectable } from '@nestjs/common';
import type { AuthUser } from '../../common/auth/auth-user.js';
import { PrismaService } from '../../database/prisma.service.js';
import type {
  CreatePriceRuleDto,
  CreatePriceRuleVersionDto,
  SetPriceRuleStatusDto,
  UpdateCourtDto,
} from '../venues.dto.js';
import {
  updateCourt,
  listTimeSlots,
  listPriceRules,
  createPriceRule,
  createPriceRuleVersion,
  setPriceRuleStatus,
} from './venues-pricing.commands.js';

@Injectable()
export class VenuePricingService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}
  updateCourt(id: string, dto: UpdateCourtDto, actor: AuthUser) {
    return updateCourt(this.prisma, id, dto, actor);
  }
  listTimeSlots(actor: AuthUser) {
    return listTimeSlots(this.prisma, actor);
  }
  listPriceRules(actor: AuthUser) {
    return listPriceRules(this.prisma, actor);
  }
  createPriceRule(dto: CreatePriceRuleDto, actor: AuthUser) {
    return createPriceRule(this.prisma, dto, actor);
  }
  async createPriceRuleVersion(
    sourceRuleId: string,
    dto: CreatePriceRuleVersionDto,
    actor: AuthUser,
  ) {
    return createPriceRuleVersion(this.prisma, sourceRuleId, dto, actor);
  }
  async setPriceRuleStatus(
    priceRuleId: string,
    dto: SetPriceRuleStatusDto,
    actor: AuthUser,
  ) {
    return setPriceRuleStatus(this.prisma, priceRuleId, dto, actor);
  }
}
