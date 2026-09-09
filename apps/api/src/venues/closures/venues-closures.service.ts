import { Inject, Injectable } from '@nestjs/common';
import type { AuthUser } from '../../common/auth/auth-user.js';
import { PrismaService } from '../../database/prisma.service.js';
import type {
  CancelCourtClosureDto,
  CreateCourtClosureDto,
  ListCourtClosuresQueryDto,
} from '../venues.dto.js';
import {
  listClosures,
  createClosure,
  cancelClosure,
} from './venues-closures.commands.js';

@Injectable()
export class VenueClosuresService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}
  async listClosures(query: ListCourtClosuresQueryDto, actor: AuthUser) {
    return listClosures(this.prisma, query, actor);
  }
  async createClosure(dto: CreateCourtClosureDto, actor: AuthUser) {
    return createClosure(this.prisma, dto, actor);
  }
  async cancelClosure(id: string, dto: CancelCourtClosureDto, actor: AuthUser) {
    return cancelClosure(this.prisma, id, dto, actor);
  }
}
