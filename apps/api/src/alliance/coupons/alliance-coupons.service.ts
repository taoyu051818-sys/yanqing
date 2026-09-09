import { Inject, Injectable } from '@nestjs/common';
import type { AuthUser } from '../../common/auth/auth-user.js';
import { PrismaService } from '../../database/prisma.service.js';
import type {
  GenerateCouponCodesDto,
  RedeemCouponDto,
} from '../alliance.dto.js';
import {
  listMyCoupons,
  generateCodes,
  claim,
  redeem,
  qr,
} from './alliance-coupons.commands.js';

@Injectable()
export class AllianceCouponsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}
  async listMyCoupons(actor: AuthUser) {
    return listMyCoupons(this.prisma, actor);
  }
  async generateCodes(
    templateId: string,
    dto: GenerateCouponCodesDto,
    actor: AuthUser,
  ) {
    return generateCodes(this.prisma, templateId, dto, actor);
  }
  async claim(code: string, actor: AuthUser) {
    return claim(this.prisma, code, actor);
  }
  async redeem(dto: RedeemCouponDto, actor: AuthUser) {
    return redeem(this.prisma, dto, actor);
  }
  async qr(code: string, actor: AuthUser) {
    return qr(this.prisma, code, actor);
  }
}
