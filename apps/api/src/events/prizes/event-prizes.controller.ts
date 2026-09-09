import { Inject, Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser, Roles } from '../../common/auth/auth.decorators.js';
import type { AuthUser } from '../../common/auth/auth-user.js';
import { AppRole } from '../../generated/prisma/enums.js';
import { IssueEventPrizeDto, ReceiveEventPrizeDto } from '../events.dto.js';
import { EventPrizesService } from './event-prizes.service.js';

@ApiTags('瑞士积分赛事')
@ApiBearerAuth()
@Controller('events')
export class EventPrizesController {
  constructor(
    @Inject(EventPrizesService)
    private readonly prizesService: EventPrizesService,
  ) {}

  @Get(':id/prizes')
  @Roles(
    AppRole.EVENT_MANAGER,
    AppRole.FRONT_DESK,
    AppRole.ADMIN,
    AppRole.SUPER_ADMIN,
  )
  prizes(@Param('id') id: string) {
    return this.prizesService.listPrizeAwards(id);
  }

  @Post(':id/prizes')
  @Roles(
    AppRole.EVENT_MANAGER,
    AppRole.FRONT_DESK,
    AppRole.ADMIN,
    AppRole.SUPER_ADMIN,
  )
  issuePrize(
    @Param('id') id: string,
    @Body() dto: IssueEventPrizeDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.prizesService.issuePrize(id, dto, actor);
  }

  @Post(':id/prizes/:awardId/receive')
  @Roles(
    AppRole.EVENT_MANAGER,
    AppRole.FRONT_DESK,
    AppRole.ADMIN,
    AppRole.SUPER_ADMIN,
  )
  receivePrize(
    @Param('id') id: string,
    @Param('awardId') awardId: string,
    @Body() dto: ReceiveEventPrizeDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.prizesService.receivePrize(id, awardId, dto, actor);
  }
}
