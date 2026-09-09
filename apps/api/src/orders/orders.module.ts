import { OrderQueriesService } from './queries/orders-queries.service.js';
import { OrderPaymentsService } from './payments/orders-payments.service.js';
import { OrderRefundRequestsService } from './refund-requests/orders-refund-requests.service.js';
import { OrderRefundReviewService } from './refund-review/orders-refund-review.service.js';
import { PendingOrdersService } from './pending/orders-pending.service.js';
import { Module } from '@nestjs/common';

import { OrdersController } from './orders.controller.js';

import { PaymentsModule } from '../payments/payments.module.js';

@Module({
  imports: [PaymentsModule],
  controllers: [OrdersController],
  providers: [
    OrderQueriesService,
    OrderPaymentsService,
    OrderRefundRequestsService,
    OrderRefundReviewService,
    PendingOrdersService,
  ],
  exports: [
    OrderQueriesService,
    OrderPaymentsService,
    OrderRefundRequestsService,
    OrderRefundReviewService,
    PendingOrdersService,
  ],
})
export class OrdersModule {}
