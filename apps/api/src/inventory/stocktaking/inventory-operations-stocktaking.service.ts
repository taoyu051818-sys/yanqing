import { Inject, Injectable } from '@nestjs/common';
import type { AuthUser } from '../../common/auth/auth-user.js';
import { PrismaService } from '../../database/prisma.service.js';
import type {
  CountStocktakeLineDto,
  CreateStocktakeDto,
  PostStocktakeDto,
} from '../inventory.dto.js';
import {
  stocktakes,
  createStocktake,
  startStocktake,
  countStocktakeLine,
  submitStocktake,
  postStocktake,
} from './inventory-operations-stocktaking.commands.js';

@Injectable()
export class InventoryStocktakingService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}
  stocktakes(actor: AuthUser) {
    return stocktakes(this.prisma, actor);
  }
  async createStocktake(dto: CreateStocktakeDto, actor: AuthUser) {
    return createStocktake(this.prisma, dto, actor);
  }
  startStocktake(id: string, actor: AuthUser) {
    return startStocktake(this.prisma, id, actor);
  }
  countStocktakeLine(
    id: string,
    lineId: string,
    dto: CountStocktakeLineDto,
    actor: AuthUser,
  ) {
    return countStocktakeLine(this.prisma, id, lineId, dto, actor);
  }
  submitStocktake(id: string, actor: AuthUser) {
    return submitStocktake(this.prisma, id, actor);
  }
  async postStocktake(id: string, dto: PostStocktakeDto, actor: AuthUser) {
    return postStocktake(this.prisma, id, dto, actor);
  }
}
