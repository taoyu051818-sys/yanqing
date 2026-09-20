import { Controller, Get, Inject, Query } from '@nestjs/common';
import { CurrentUser, Roles } from '../../common/auth/auth.decorators.js';
import type { AuthUser } from '../../common/auth/auth-user.js';
import { AppRole } from '../../generated/prisma/enums.js';
import { OrderTimelineService } from './timeline.service.js';
import { TimelineQuery, RefundTimelineQuery } from './query.js';
@Controller('orders/admin')
@Roles(AppRole.FRONT_DESK, AppRole.FINANCE, AppRole.ADMIN, AppRole.SUPER_ADMIN)
export class OrderTimelineController {
  constructor(
    @Inject(OrderTimelineService)
    private readonly timeline: OrderTimelineService,
  ) {}
  @Get('ledger') ledger(
    @CurrentUser() actor: AuthUser,
    @Query() query: TimelineQuery,
  ) {
    return this.timeline.ledger(actor, query);
  }
  @Get('refunds') refunds(@Query() query: RefundTimelineQuery) {
    return this.timeline.refunds(query);
  }
}
