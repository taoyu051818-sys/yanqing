import { Inject } from '@nestjs/common';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AuthUser } from '../../common/auth/auth-user.js';
import { PrismaService } from '../../database/prisma.service.js';
import type { ReviewRefundDto } from '../orders.dto.js';
import { OrderFinalizerService } from '../../payments/order-finalizer.service.js';
import { WechatPayService } from '../../payments/wechat-pay.service.js';
import {
  rejectRefund,
  approveRefund,
} from './orders-refund-review.commands.js';

@Injectable()
export class OrderRefundReviewService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ConfigService) private readonly config: ConfigService,
    @Inject(OrderFinalizerService)
    private readonly finalizer: OrderFinalizerService,
    @Inject(WechatPayService) private readonly wechatPay: WechatPayService,
  ) {}
  async rejectRefund(refundId: string, dto: ReviewRefundDto, actor: AuthUser) {
    return rejectRefund(this.prisma, refundId, dto, actor);
  }
  async approveRefund(refundId: string, dto: ReviewRefundDto, actor: AuthUser) {
    return approveRefund(
      this.prisma,
      this.config,
      this.finalizer,
      this.wechatPay,
      refundId,
      dto,
      actor,
    );
  }
}
