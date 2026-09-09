import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../src/database/prisma.service.js';
import { OrderFinalizerService } from '../../src/payments/order-finalizer.service.js';
import { WechatPayService } from '../../src/payments/wechat-pay.service.js';
import { OrderQueriesService } from '../../src/orders/queries/orders-queries.service.js';
import { OrderPaymentsService } from '../../src/orders/payments/orders-payments.service.js';
import { OrderRefundRequestsService } from '../../src/orders/refund-requests/orders-refund-requests.service.js';
import { OrderRefundReviewService } from '../../src/orders/refund-review/orders-refund-review.service.js';
import { PendingOrdersService } from '../../src/orders/pending/orders-pending.service.js';

export class OrdersService {
  private readonly domain0: OrderQueriesService;
  private readonly domain1: OrderPaymentsService;
  private readonly domain2: OrderRefundRequestsService;
  private readonly domain3: OrderRefundReviewService;
  private readonly domain4: PendingOrdersService;
  constructor(
    prisma: PrismaService,
    config: ConfigService,
    finalizer: OrderFinalizerService,
    wechatPay: WechatPayService,
  ) {
    this.domain0 = new OrderQueriesService(prisma);
    this.domain1 = new OrderPaymentsService(
      prisma,
      config,
      finalizer,
      wechatPay,
    );
    this.domain2 = new OrderRefundRequestsService(prisma);
    this.domain3 = new OrderRefundReviewService(
      prisma,
      config,
      finalizer,
      wechatPay,
    );
    this.domain4 = new PendingOrdersService(prisma, config, wechatPay);
  }
  list(...args: Parameters<OrderQueriesService['list']>) {
    return this.domain0.list(...args);
  }
  detail(...args: Parameters<OrderQueriesService['detail']>) {
    return this.domain0.detail(...args);
  }
  paymentOptions(...args: Parameters<OrderPaymentsService['paymentOptions']>) {
    return this.domain1.paymentOptions(...args);
  }
  pay(...args: Parameters<OrderPaymentsService['pay']>) {
    return this.domain1.pay(...args);
  }
  requestRefund(
    ...args: Parameters<OrderRefundRequestsService['requestRefund']>
  ) {
    return this.domain2.requestRefund(...args);
  }
  rejectRefund(...args: Parameters<OrderRefundReviewService['rejectRefund']>) {
    return this.domain3.rejectRefund(...args);
  }
  approveRefund(
    ...args: Parameters<OrderRefundReviewService['approveRefund']>
  ) {
    return this.domain3.approveRefund(...args);
  }
  cancelPending(...args: Parameters<PendingOrdersService['cancelPending']>) {
    return this.domain4.cancelPending(...args);
  }
  expirePendingOrders(
    ...args: Parameters<PendingOrdersService['expirePendingOrders']>
  ) {
    return this.domain4.expirePendingOrders(...args);
  }
  expirePendingVenueOrders(
    ...args: Parameters<PendingOrdersService['expirePendingVenueOrders']>
  ) {
    return this.domain4.expirePendingVenueOrders(...args);
  }
  onApplicationBootstrap(
    ...args: Parameters<PendingOrdersService['onApplicationBootstrap']>
  ) {
    return this.domain4.onApplicationBootstrap(...args);
  }
  onModuleDestroy(
    ...args: Parameters<PendingOrdersService['onModuleDestroy']>
  ) {
    return this.domain4.onModuleDestroy(...args);
  }
}
