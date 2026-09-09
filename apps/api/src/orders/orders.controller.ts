import { Inject } from '@nestjs/common';
import { OrderQueriesService } from './queries/orders-queries.service.js';
import { OrderPaymentsService } from './payments/orders-payments.service.js';
import { OrderRefundRequestsService } from './refund-requests/orders-refund-requests.service.js';
import { OrderRefundReviewService } from './refund-review/orders-refund-review.service.js';
import { PendingOrdersService } from './pending/orders-pending.service.js';
import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import { CurrentUser, Roles } from '../common/auth/auth.decorators.js';
import type { AuthUser } from '../common/auth/auth-user.js';
import { AppRole } from '../generated/prisma/enums.js';
import {
  CancelPendingOrderDto,
  OrderQueryDto,
  PayOrderDto,
  RequestRefundDto,
  ReviewRefundDto,
} from './orders.dto.js';

@ApiTags('订单支付退款')
@ApiBearerAuth()
@Controller('orders')
export class OrdersController {
  constructor(
    @Inject(OrderQueriesService)
    private readonly ordersOrderQueries: OrderQueriesService,
    @Inject(OrderPaymentsService)
    private readonly ordersOrderPayments: OrderPaymentsService,
    @Inject(OrderRefundRequestsService)
    private readonly ordersOrderRefundRequests: OrderRefundRequestsService,
    @Inject(OrderRefundReviewService)
    private readonly ordersOrderRefundReview: OrderRefundReviewService,
    @Inject(PendingOrdersService)
    private readonly ordersPendingOrders: PendingOrdersService,
  ) {}

  @Get()
  myOrders(@CurrentUser() actor: AuthUser, @Query() query: OrderQueryDto) {
    return this.ordersOrderQueries.list(actor, query);
  }

  @Get('admin/all')
  @Roles(
    AppRole.FRONT_DESK,
    AppRole.FINANCE,
    AppRole.ADMIN,
    AppRole.SUPER_ADMIN,
  )
  all(@CurrentUser() actor: AuthUser, @Query() query: OrderQueryDto) {
    return this.ordersOrderQueries.list(actor, query, true);
  }

  @Get(':id')
  detail(@Param('id') id: string, @CurrentUser() actor: AuthUser) {
    return this.ordersOrderQueries.detail(id, actor);
  }

  @Get(':id/payment-options')
  paymentOptions(@Param('id') id: string, @CurrentUser() actor: AuthUser) {
    return this.ordersOrderPayments.paymentOptions(id, actor);
  }

  @Post(':id/pay')
  pay(
    @Param('id') id: string,
    @Body() dto: PayOrderDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.ordersOrderPayments.pay(id, dto, actor);
  }

  @Post(':id/cancel')
  cancelPending(
    @Param('id') id: string,
    @Body() dto: CancelPendingOrderDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.ordersPendingOrders.cancelPending(id, dto, actor);
  }

  @Post(':id/refunds')
  requestRefund(
    @Param('id') id: string,
    @Body() dto: RequestRefundDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.ordersOrderRefundRequests.requestRefund(id, dto, actor);
  }

  @Post('refunds/:refundId/approve')
  @Roles(AppRole.FINANCE, AppRole.ADMIN, AppRole.SUPER_ADMIN)
  approveRefund(
    @Param('refundId') refundId: string,
    @Body() dto: ReviewRefundDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.ordersOrderRefundReview.approveRefund(refundId, dto, actor);
  }

  @Post('refunds/:refundId/reject')
  @Roles(AppRole.FINANCE, AppRole.ADMIN, AppRole.SUPER_ADMIN)
  rejectRefund(
    @Param('refundId') refundId: string,
    @Body() dto: ReviewRefundDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.ordersOrderRefundReview.rejectRefund(refundId, dto, actor);
  }
}
