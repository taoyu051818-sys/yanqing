import { ForbiddenException, Inject } from '@nestjs/common';
import { Injectable } from '@nestjs/common';
import type { AuthUser } from '../../common/auth/auth-user.js';
import { PrismaService } from '../../database/prisma.service.js';
import type { RequestRefundDto } from '../orders.dto.js';
import { requestRefund } from './orders-refund-requests.commands.js';
import { OrderRefundReviewService } from '../refund-review/orders-refund-review.service.js';
import { AppRole } from '../../generated/prisma/enums.js';

@Injectable()
export class OrderRefundRequestsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(OrderRefundReviewService) private readonly review: OrderRefundReviewService,
  ) {}
  async requestRefund(orderId: string, dto: RequestRefundDto, actor: AuthUser) {
    return requestRefund(this.prisma, orderId, dto, actor);
  }
  async directRefund(orderId: string, dto: RequestRefundDto, actor: AuthUser) {
    if (!actor.roles.some(role => role === AppRole.ADMIN || role === AppRole.SUPER_ADMIN))
      throw new ForbiddenException('仅管理员或超级管理员可直接退款');
    // Reuse the durable request and approval commands. Retrying the same key
    // resumes a request interrupted before approval, never creates another refund.
    const refund = await requestRefund(this.prisma, orderId, dto, actor);
    return this.review.approveRefund(refund.id, { reason: dto.reason.trim() }, actor);
  }
}
