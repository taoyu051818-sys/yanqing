import { Inject, Injectable } from '@nestjs/common';
import type { AuthUser } from '../../common/auth/auth-user.js';
import { PrismaService } from '../../database/prisma.service.js';
import type {
  AddLeadFollowUpDto,
  ArchiveLeadDto,
  AssignLeadDto,
  ConvertLeadDto,
  CreateLeadDto,
  LeadQueryDto,
  LeadOwnerQueryDto,
  LoseLeadDto,
} from '../members.dto.js';
import {
  listLeads,
  createLead,
  claimLead,
  assignLead,
  addLeadFollowUp,
  convertLead,
  loseLead,
  archiveLead,
  leadOwners,
} from './members-leads.commands.js';

@Injectable()
export class MemberLeadsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}
  async listLeads(query: LeadQueryDto, actor: AuthUser) {
    return listLeads(this.prisma, query, actor);
  }
  async createLead(dto: CreateLeadDto, actor: AuthUser) {
    return createLead(this.prisma, dto, actor);
  }
  async claimLead(id: string, actor: AuthUser) {
    return claimLead(this.prisma, id, actor);
  }
  async assignLead(id: string, dto: AssignLeadDto, actor: AuthUser) {
    return assignLead(this.prisma, id, dto, actor);
  }
  async addLeadFollowUp(id: string, dto: AddLeadFollowUpDto, actor: AuthUser) {
    return addLeadFollowUp(this.prisma, id, dto, actor);
  }
  async convertLead(id: string, dto: ConvertLeadDto, actor: AuthUser) {
    return convertLead(this.prisma, id, dto, actor);
  }
  async loseLead(id: string, dto: LoseLeadDto, actor: AuthUser) {
    return loseLead(this.prisma, id, dto, actor);
  }
  async archiveLead(id: string, dto: ArchiveLeadDto, actor: AuthUser) {
    return archiveLead(this.prisma, id, dto, actor);
  }
  async leadOwners(query: LeadOwnerQueryDto, actor: AuthUser) {
    return leadOwners(this.prisma, query, actor);
  }
}
