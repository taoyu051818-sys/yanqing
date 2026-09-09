import { VenueAvailabilityService } from './availability/venues-availability.service.js';
import { VenueClosuresService } from './closures/venues-closures.service.js';
import { VenueBookingService } from './booking/venues-booking.service.js';
import { VenueFulfillmentService } from './fulfillment/venues-fulfillment.service.js';
import { VenuePricingService } from './pricing/venues-pricing.service.js';
import { Module } from '@nestjs/common';

import { VenuesController } from './venues.controller.js';

@Module({
  controllers: [VenuesController],
  providers: [
    VenueAvailabilityService,
    VenueClosuresService,
    VenueBookingService,
    VenueFulfillmentService,
    VenuePricingService,
  ],
  exports: [
    VenueAvailabilityService,
    VenueClosuresService,
    VenueBookingService,
    VenueFulfillmentService,
    VenuePricingService,
  ],
})
export class VenuesModule {}
