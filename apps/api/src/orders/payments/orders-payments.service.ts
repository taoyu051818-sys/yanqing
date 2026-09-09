import { Inject } from '@nestjs/common';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AuthUser } from '../../common/auth/auth-user.js';
import { PrismaService } from '../../database/prisma.service.js';
import type { PayOrderDto } from '../orders.dto.js';
import { OrderFinalizerService } from '../../payments/order-finalizer.service.js';
import { WechatPayService } from '../../payments/wechat-pay.service.js';
import { paymentOptions, pay } from './orders-payments.commands.js';

@Injectable()
export class OrderPaymentsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ConfigService) private readonly config: ConfigService,
    @Inject(OrderFinalizerService)
    private readonly finalizer: OrderFinalizerService,
    @Inject(WechatPayService) private readonly wechatPay: WechatPayService,
  ) {}
  async paymentOptions(orderId: string, actor: AuthUser) {
    return paymentOptions(this.prisma, this.config, orderId, actor);
  }
  async pay(orderId: string, dto: PayOrderDto, actor: AuthUser) {
    return pay(
      this.prisma,
      this.config,
      this.finalizer,
      this.wechatPay,
      orderId,
      dto,
      actor,
    );
  }
}
