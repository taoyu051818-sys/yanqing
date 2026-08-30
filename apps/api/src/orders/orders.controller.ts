import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common'
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger'

import { CurrentUser, Roles } from '../common/auth/auth.decorators.js'
import type { AuthUser } from '../common/auth/auth-user.js'
import { AppRole } from '../generated/prisma/enums.js'
import { OrderQueryDto, PayOrderDto, RequestRefundDto, ReviewRefundDto } from './orders.dto.js'
import { OrdersService } from './orders.service.js'

@ApiTags('订单支付退款')
@ApiBearerAuth()
@Controller('orders')
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Get()
  myOrders(@CurrentUser() actor: AuthUser, @Query() query: OrderQueryDto) {
    return this.orders.list(actor, query)
  }

  @Get('admin/all')
  @Roles(AppRole.FRONT_DESK, AppRole.FINANCE, AppRole.ADMIN, AppRole.SUPER_ADMIN)
  all(@CurrentUser() actor: AuthUser, @Query() query: OrderQueryDto) {
    return this.orders.list(actor, query, true)
  }

  @Get(':id')
  detail(@Param('id') id: string, @CurrentUser() actor: AuthUser) {
    return this.orders.detail(id, actor)
  }

  @Post(':id/pay')
  pay(@Param('id') id: string, @Body() dto: PayOrderDto, @CurrentUser() actor: AuthUser) {
    return this.orders.pay(id, dto, actor)
  }

  @Post(':id/refunds')
  requestRefund(
    @Param('id') id: string,
    @Body() dto: RequestRefundDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.orders.requestRefund(id, dto, actor)
  }

  @Post('refunds/:refundId/approve')
  @Roles(AppRole.FINANCE, AppRole.ADMIN, AppRole.SUPER_ADMIN)
  approveRefund(
    @Param('refundId') refundId: string,
    @Body() dto: ReviewRefundDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.orders.approveRefund(refundId, dto, actor)
  }

  @Post('refunds/:refundId/reject')
  @Roles(AppRole.FINANCE, AppRole.ADMIN, AppRole.SUPER_ADMIN)
  rejectRefund(
    @Param('refundId') refundId: string,
    @Body() dto: ReviewRefundDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.orders.rejectRefund(refundId, dto, actor)
  }
}
