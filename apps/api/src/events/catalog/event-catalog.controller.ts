import { Inject, Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  CurrentUser,
  Public,
  Roles,
} from '../../common/auth/auth.decorators.js';
import type { AuthUser } from '../../common/auth/auth-user.js';
import { AppRole } from '../../generated/prisma/enums.js';
import {
  CancelEventDto,
  CreateEventDto,
  PublishEventDto,
} from '../events.dto.js';
import { EventCatalogService } from './event-catalog.service.js';
import { EventCancellationService } from './event-cancellation.service.js';

@ApiTags('瑞士积分赛事')
@ApiBearerAuth()
@Controller('events')
export class EventCatalogController {
  constructor(
    @Inject(EventCatalogService) private readonly catalog: EventCatalogService,
    @Inject(EventCancellationService)
    private readonly cancellation: EventCancellationService,
  ) {}

  @Get()
  list() {
    return this.catalog.list();
  }

  @Get('managed')
  @Roles(
    AppRole.EVENT_MANAGER,
    AppRole.FRONT_DESK,
    AppRole.ADMIN,
    AppRole.SUPER_ADMIN,
  )
  managedList() {
    return this.catalog.managedList();
  }

  @Get('managed/:id')
  @Roles(
    AppRole.EVENT_MANAGER,
    AppRole.FRONT_DESK,
    AppRole.ADMIN,
    AppRole.SUPER_ADMIN,
  )
  managedDetail(@Param('id') id: string) {
    return this.catalog.managedDetail(id);
  }

  // Shared cards expose the existing public field projection, never registration details.
  @Public()
  @Get(':id')
  detail(@Param('id') id: string) {
    return this.catalog.detail(id);
  }

  @Post()
  @Roles(AppRole.EVENT_MANAGER, AppRole.ADMIN, AppRole.SUPER_ADMIN)
  create(@Body() dto: CreateEventDto, @CurrentUser() actor: AuthUser) {
    return this.catalog.create(dto, actor);
  }

  @Post(':id/publish')
  @Roles(AppRole.EVENT_MANAGER, AppRole.ADMIN, AppRole.SUPER_ADMIN)
  publish(
    @Param('id') id: string,
    @Body() dto: PublishEventDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.catalog.publish(id, dto, actor);
  }

  @Post(':id/cancel')
  @Roles(AppRole.EVENT_MANAGER, AppRole.ADMIN, AppRole.SUPER_ADMIN)
  cancel(
    @Param('id') id: string,
    @Body() dto: CancelEventDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.cancellation.cancel(id, dto, actor);
  }
}
