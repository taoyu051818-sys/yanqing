import { Inject, Injectable } from '@nestjs/common';
import type { AuthUser } from '../../common/auth/auth-user.js';
import { PrismaService } from '../../database/prisma.service.js';
import type {
  CreateMerchantDto,
  SetMerchantStatusDto,
} from '../alliance.dto.js';
import {
  listMerchants,
  createMerchant,
  setMerchantStatus,
} from './alliance-merchants.commands.js';

@Injectable()
export class AllianceMerchantsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}
  async listMerchants(actor: AuthUser) {
    return listMerchants(this.prisma, actor);
  }
  async createMerchant(dto: CreateMerchantDto, actor: AuthUser) {
    return createMerchant(this.prisma, dto, actor);
  }
  async setMerchantStatus(
    merchantId: string,
    dto: SetMerchantStatusDto,
    actor: AuthUser,
  ) {
    return setMerchantStatus(this.prisma, merchantId, dto, actor);
  }
}
