import { VenueSettingsController } from './settings/venue-settings.controller.js';
import { VenueSettingsService } from './settings/venue-settings.service.js';
import { VenueAvailabilityService } from './availability/venues-availability.service.js';
import { VenueClosuresService } from './closures/venues-closures.service.js';
import { VenueBookingService } from './booking/venues-booking.service.js';
import { VenueFulfillmentService } from './fulfillment/venues-fulfillment.service.js';
import { VenuePricingService } from './pricing/venues-pricing.service.js';
import { Module } from '@nestjs/common';

import { VenuesController } from './venues.controller.js';

@Module({
  controllers: [VenuesController, VenueSettingsController],
  providers: [
    VenueSettingsService,
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
