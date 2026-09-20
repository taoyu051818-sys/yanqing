import { MemberTimelineController } from './timeline/member-timeline.controller.js';
import { OrderTimelineController } from './timeline/timeline.controller.js';
import { OrderTimelineService } from './timeline/timeline.service.js';
import { ActivityRefundExecutionService } from './refund-review/activity-refund-execution.service.js';
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
  controllers: [
    MemberTimelineController,
    OrderTimelineController,
    OrdersController,
  ],
  providers: [
    OrderTimelineService,
    OrderQueriesService,
    OrderPaymentsService,
    OrderRefundRequestsService,
    OrderRefundReviewService,
    ActivityRefundExecutionService,
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
