import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';
import type { LeadFunnelQueryDto } from '../members.dto.js';
import { leadFunnel } from './members-lead-reporting.commands.js';

@Injectable()
export class MemberLeadReportingService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}
  async leadFunnel(query: LeadFunnelQueryDto) {
    return leadFunnel(this.prisma, query);
  }
}
