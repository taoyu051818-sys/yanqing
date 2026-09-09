import { Inject, Injectable } from '@nestjs/common';
import type { AuthUser } from '../../common/auth/auth-user.js';
import { PrismaService } from '../../database/prisma.service.js';
import type {
  CreateInventoryItemDto,
  SetMasterDataStatusDto,
  UpdateInventoryItemDto,
} from '../inventory.dto.js';
import {
  list,
  detail,
  lowStock,
  awardOptions,
} from './inventory-catalog.queries.js';
import { create, update, setStatus } from './inventory-catalog.commands.js';

@Injectable()
export class InventoryCatalogService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}
  list(actor: AuthUser) {
    return list(this.prisma, actor);
  }
  async detail(id: string, actor: AuthUser) {
    return detail(this.prisma, id, actor);
  }
  lowStock(actor: AuthUser) {
    return lowStock(this.prisma, actor);
  }
  awardOptions(actor: AuthUser) {
    return awardOptions(this.prisma, actor);
  }
  async create(dto: CreateInventoryItemDto, actor: AuthUser) {
    return create(this.prisma, dto, actor);
  }
  async update(id: string, dto: UpdateInventoryItemDto, actor: AuthUser) {
    return update(this.prisma, id, dto, actor);
  }
  async setStatus(id: string, dto: SetMasterDataStatusDto, actor: AuthUser) {
    return setStatus(this.prisma, id, dto, actor);
  }
}
