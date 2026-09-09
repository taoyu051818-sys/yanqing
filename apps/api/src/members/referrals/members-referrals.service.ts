import { Inject, Injectable } from '@nestjs/common';
import type { AuthUser } from '../../common/auth/auth-user.js';
import { PrismaService } from '../../database/prisma.service.js';
import type { BindReferralDto } from '../members.dto.js';
import { bindReferral } from './members-referrals.commands.js';

@Injectable()
export class MemberReferralsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}
  async bindReferral(dto: BindReferralDto, actor: AuthUser) {
    return bindReferral(this.prisma, dto, actor);
  }
}
