import { Inject } from '@nestjs/common';
import { VenueAvailabilityService } from './availability/venues-availability.service.js';
import { VenueClosuresService } from './closures/venues-closures.service.js';
import { VenueBookingService } from './booking/venues-booking.service.js';
import { VenueFulfillmentService } from './fulfillment/venues-fulfillment.service.js';
import { VenuePricingService } from './pricing/venues-pricing.service.js';
import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import { CurrentUser, Roles } from '../common/auth/auth.decorators.js';
import type { AuthUser } from '../common/auth/auth-user.js';
import { AppRole } from '../generated/prisma/enums.js';
import {
  AvailabilityQueryDto,
  CancelCourtClosureDto,
  CompleteVenueBookingDto,
  CreateCourtClosureDto,
  CreatePriceRuleDto,
  CreatePriceRuleVersionDto,
  CreateVenueBookingDto,
  ListCourtClosuresQueryDto,
  SetPriceRuleStatusDto,
  UpdateCourtDto,
  VenueCheckInDto,
} from './venues.dto.js';

@ApiTags('场地')
@ApiBearerAuth()
@Controller('venues')
export class VenuesController {
  constructor(
    @Inject(VenueAvailabilityService)
    private readonly venuesVenueAvailability: VenueAvailabilityService,
    @Inject(VenueClosuresService)
    private readonly venuesVenueClosures: VenueClosuresService,
    @Inject(VenueBookingService)
    private readonly venuesVenueBooking: VenueBookingService,
    @Inject(VenueFulfillmentService)
    private readonly venuesVenueFulfillment: VenueFulfillmentService,
    @Inject(VenuePricingService)
    private readonly venuesVenuePricing: VenuePricingService,
  ) {}

  @Get('availability')
  availability(@Query() query: AvailabilityQueryDto) {
    return this.venuesVenueAvailability.availability(query.date);
  }

  @Get('availability/assisted')
  @Roles(AppRole.FRONT_DESK, AppRole.ADMIN, AppRole.SUPER_ADMIN)
  assistedAvailability(@Query() query: AvailabilityQueryDto) {
    return this.venuesVenueAvailability.availability(query.date, true);
  }

  @Post('bookings')
  book(@Body() dto: CreateVenueBookingDto, @CurrentUser() actor: AuthUser) {
    return this.venuesVenueBooking.createBooking(dto, actor);
  }

  @Get('closures')
  @Roles(AppRole.FRONT_DESK, AppRole.ADMIN, AppRole.SUPER_ADMIN)
  closures(
    @Query() query: ListCourtClosuresQueryDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.venuesVenueClosures.listClosures(query, actor);
  }

  @Post('closures')
  @Roles(AppRole.ADMIN, AppRole.SUPER_ADMIN)
  createClosure(
    @Body() dto: CreateCourtClosureDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.venuesVenueClosures.createClosure(dto, actor);
  }

  @Post('closures/:id/cancel')
  @Roles(AppRole.ADMIN, AppRole.SUPER_ADMIN)
  cancelClosure(
    @Param('id') id: string,
    @Body() dto: CancelCourtClosureDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.venuesVenueClosures.cancelClosure(id, dto, actor);
  }

  @Post('orders/:orderId/check-in')
  @Roles(AppRole.FRONT_DESK, AppRole.ADMIN, AppRole.SUPER_ADMIN)
  checkIn(
    @Param('orderId') orderId: string,
    @Body() dto: VenueCheckInDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.venuesVenueFulfillment.checkIn(orderId, actor, dto);
  }

  @Post('orders/:orderId/fulfillment')
  @Roles(AppRole.FRONT_DESK, AppRole.ADMIN, AppRole.SUPER_ADMIN)
  fulfill(
    @Param('orderId') orderId: string,
    @Body() dto: CompleteVenueBookingDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.venuesVenueFulfillment.completeBooking(orderId, dto, actor);
  }

  @Patch('courts/:id')
  @Roles(AppRole.ADMIN, AppRole.SUPER_ADMIN)
  updateCourt(
    @Param('id') id: string,
    @Body() dto: UpdateCourtDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.venuesVenuePricing.updateCourt(id, dto, actor);
  }

  @Get('time-slots/manage')
  @Roles(AppRole.FRONT_DESK, AppRole.ADMIN, AppRole.SUPER_ADMIN)
  timeSlots(@CurrentUser() actor: AuthUser) {
    return this.venuesVenuePricing.listTimeSlots(actor);
  }

  @Get('price-rules/manage')
  @Roles(AppRole.FRONT_DESK, AppRole.ADMIN, AppRole.SUPER_ADMIN)
  priceRules(@CurrentUser() actor: AuthUser) {
    return this.venuesVenuePricing.listPriceRules(actor);
  }

  @Post('price-rules')
  @Roles(AppRole.ADMIN, AppRole.SUPER_ADMIN)
  createPriceRule(
    @Body() dto: CreatePriceRuleDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.venuesVenuePricing.createPriceRule(dto, actor);
  }

  @Post('price-rules/:id/versions')
  @Roles(AppRole.ADMIN, AppRole.SUPER_ADMIN)
  createPriceRuleVersion(
    @Param('id') id: string,
    @Body() dto: CreatePriceRuleVersionDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.venuesVenuePricing.createPriceRuleVersion(id, dto, actor);
  }

  @Post('price-rules/:id/status')
  @Roles(AppRole.ADMIN, AppRole.SUPER_ADMIN)
  setPriceRuleStatus(
    @Param('id') id: string,
    @Body() dto: SetPriceRuleStatusDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.venuesVenuePricing.setPriceRuleStatus(id, dto, actor);
  }
}
