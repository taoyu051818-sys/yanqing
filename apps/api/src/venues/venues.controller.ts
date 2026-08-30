import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common'
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger'

import { CurrentUser, Roles } from '../common/auth/auth.decorators.js'
import type { AuthUser } from '../common/auth/auth-user.js'
import { AppRole } from '../generated/prisma/enums.js'
import {
  AvailabilityQueryDto,
  CancelCourtClosureDto,
  CreateCourtClosureDto,
  CreatePriceRuleDto,
  CreateVenueBookingDto,
  ListCourtClosuresQueryDto,
  UpdateCourtDto,
} from './venues.dto.js'
import { VenuesService } from './venues.service.js'

@ApiTags('场地')
@ApiBearerAuth()
@Controller('venues')
export class VenuesController {
  constructor(private readonly venues: VenuesService) {}

  @Get('availability')
  availability(@Query() query: AvailabilityQueryDto) {
    return this.venues.availability(query.date)
  }

  @Post('bookings')
  book(@Body() dto: CreateVenueBookingDto, @CurrentUser() actor: AuthUser) {
    return this.venues.createBooking(dto, actor)
  }

  @Get('closures')
  @Roles(AppRole.FRONT_DESK, AppRole.ADMIN, AppRole.SUPER_ADMIN)
  closures(
    @Query() query: ListCourtClosuresQueryDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.venues.listClosures(query, actor)
  }

  @Post('closures')
  @Roles(AppRole.ADMIN, AppRole.SUPER_ADMIN)
  createClosure(
    @Body() dto: CreateCourtClosureDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.venues.createClosure(dto, actor)
  }

  @Post('closures/:id/cancel')
  @Roles(AppRole.ADMIN, AppRole.SUPER_ADMIN)
  cancelClosure(
    @Param('id') id: string,
    @Body() dto: CancelCourtClosureDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.venues.cancelClosure(id, dto, actor)
  }

  @Post('orders/:orderId/check-in')
  @Roles(AppRole.FRONT_DESK, AppRole.ADMIN, AppRole.SUPER_ADMIN)
  checkIn(@Param('orderId') orderId: string, @CurrentUser() actor: AuthUser) {
    return this.venues.checkIn(orderId, actor)
  }

  @Patch('courts/:id')
  @Roles(AppRole.ADMIN, AppRole.SUPER_ADMIN)
  updateCourt(
    @Param('id') id: string,
    @Body() dto: UpdateCourtDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.venues.updateCourt(id, dto, actor)
  }

  @Post('price-rules')
  @Roles(AppRole.ADMIN, AppRole.SUPER_ADMIN)
  createPriceRule(@Body() dto: CreatePriceRuleDto, @CurrentUser() actor: AuthUser) {
    return this.venues.createPriceRule(dto, actor)
  }
}
