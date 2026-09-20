import { Controller, Get, Inject, Query } from '@nestjs/common';
import { CurrentUser } from '../../common/auth/auth.decorators.js';
import type { AuthUser } from '../../common/auth/auth-user.js';
import { OrderTimelineService } from './timeline.service.js';
import { TimelineQuery } from './query.js';
@Controller('orders/me')
export class MemberTimelineController {
  constructor(
    @Inject(OrderTimelineService)
    private readonly timeline: OrderTimelineService,
  ) {}
  @Get('ledger') ledger(
    @CurrentUser() actor: AuthUser,
    @Query() query: TimelineQuery,
  ) {
    return this.timeline.ledger(actor, { ...query, scope: 'ACCOUNTS' }, true);
  }
  @Get('next') next(@CurrentUser() actor: AuthUser) {
    return this.timeline.next(actor);
  }
}
