import { Inject, Injectable } from '@nestjs/common';
import type { AuthUser } from '../../common/auth/auth-user.js';
import { PrismaService } from '../../database/prisma.service.js';
import type {
  CreateCouponTemplateDto,
  SetCouponTemplateStatusDto,
} from '../alliance.dto.js';
import {
  listTemplates,
  createTemplate,
  setTemplateStatus,
} from './alliance-templates.commands.js';

@Injectable()
export class AllianceTemplatesService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}
  async listTemplates(actor: AuthUser) {
    return listTemplates(this.prisma, actor);
  }
  async createTemplate(dto: CreateCouponTemplateDto, actor: AuthUser) {
    return createTemplate(this.prisma, dto, actor);
  }
  async setTemplateStatus(
    templateId: string,
    dto: SetCouponTemplateStatusDto,
    actor: AuthUser,
  ) {
    return setTemplateStatus(this.prisma, templateId, dto, actor);
  }
}
