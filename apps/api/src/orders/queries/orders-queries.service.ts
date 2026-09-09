import { Inject } from '@nestjs/common';
import { Injectable } from '@nestjs/common';
import type { AuthUser } from '../../common/auth/auth-user.js';
import { PrismaService } from '../../database/prisma.service.js';
import type { OrderQueryDto } from '../orders.dto.js';
import { list, detail } from './orders-queries.commands.js';

@Injectable()
export class OrderQueriesService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}
  async list(actor: AuthUser, query: OrderQueryDto, all = false) {
    return list(this.prisma, actor, query, all);
  }
  async detail(orderId: string, actor: AuthUser) {
    return detail(this.prisma, orderId, actor);
  }
}
