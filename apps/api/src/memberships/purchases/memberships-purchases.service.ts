import { Inject, Injectable } from '@nestjs/common';
import type { AuthUser } from '../../common/auth/auth-user.js';
import { PrismaService } from '../../database/prisma.service.js';
import type {
  CreateRechargeDto,
  PurchaseMembershipDto,
} from '../memberships.dto.js';
import { purchase, recharge } from './memberships-purchases.commands.js';

@Injectable()
export class MembershipPurchasesService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}
  async purchase(dto: PurchaseMembershipDto, actor: AuthUser) {
    return purchase(this.prisma, dto, actor);
  }
  async recharge(dto: CreateRechargeDto, actor: AuthUser) {
    return recharge(this.prisma, dto, actor);
  }
}
