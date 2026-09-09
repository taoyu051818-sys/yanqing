import { Inject } from '@nestjs/common';
import { Injectable } from '@nestjs/common';
import type { AuthUser } from '../../common/auth/auth-user.js';
import { PrismaService } from '../../database/prisma.service.js';
import type { RequestRefundDto } from '../orders.dto.js';
import { requestRefund } from './orders-refund-requests.commands.js';

@Injectable()
export class OrderRefundRequestsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}
  async requestRefund(orderId: string, dto: RequestRefundDto, actor: AuthUser) {
    return requestRefund(this.prisma, orderId, dto, actor);
  }
}
