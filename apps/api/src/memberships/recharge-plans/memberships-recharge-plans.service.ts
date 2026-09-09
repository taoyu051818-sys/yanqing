import { Inject, Injectable } from '@nestjs/common';
import type { AuthUser } from '../../common/auth/auth-user.js';
import { PrismaService } from '../../database/prisma.service.js';
import type {
  CreateRechargePlanDto,
  SetRechargePlanStatusDto,
} from '../memberships.dto.js';
import {
  rechargePlans,
  manageRechargePlans,
  createRechargePlan,
  setRechargePlanStatus,
} from './memberships-recharge-plans.commands.js';

@Injectable()
export class MembershipRechargePlansService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}
  rechargePlans() {
    return rechargePlans(this.prisma);
  }
  manageRechargePlans(actor: AuthUser) {
    return manageRechargePlans(this.prisma, actor);
  }
  async createRechargePlan(dto: CreateRechargePlanDto, actor: AuthUser) {
    return createRechargePlan(this.prisma, dto, actor);
  }
  async setRechargePlanStatus(
    planId: string,
    dto: SetRechargePlanStatusDto,
    actor: AuthUser,
  ) {
    return setRechargePlanStatus(this.prisma, planId, dto, actor);
  }
}
