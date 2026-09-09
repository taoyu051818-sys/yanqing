import type { PrismaService } from '../../src/database/prisma.service.js';
import { VenueAvailabilityService } from '../../src/venues/availability/venues-availability.service.js';
import { VenueClosuresService } from '../../src/venues/closures/venues-closures.service.js';
import { VenueBookingService } from '../../src/venues/booking/venues-booking.service.js';
import { VenueFulfillmentService } from '../../src/venues/fulfillment/venues-fulfillment.service.js';
import { VenuePricingService } from '../../src/venues/pricing/venues-pricing.service.js';
/** Test-only composition of domain services; never loaded in production. */
export class VenuesService {
  private readonly domain0: VenueAvailabilityService;
  private readonly domain1: VenueClosuresService;
  private readonly domain2: VenueBookingService;
  private readonly domain3: VenueFulfillmentService;
  private readonly domain4: VenuePricingService;
  constructor(prisma: PrismaService) {
    this.domain0 = new VenueAvailabilityService(prisma);
    this.domain1 = new VenueClosuresService(prisma);
    this.domain2 = new VenueBookingService(prisma);
    this.domain3 = new VenueFulfillmentService(prisma);
    this.domain4 = new VenuePricingService(prisma);
  }
  availability(...args: Parameters<VenueAvailabilityService['availability']>) {
    return this.domain0.availability(...args);
  }
  listClosures(...args: Parameters<VenueClosuresService['listClosures']>) {
    return this.domain1.listClosures(...args);
  }
  createClosure(...args: Parameters<VenueClosuresService['createClosure']>) {
    return this.domain1.createClosure(...args);
  }
  cancelClosure(...args: Parameters<VenueClosuresService['cancelClosure']>) {
    return this.domain1.cancelClosure(...args);
  }
  createBooking(...args: Parameters<VenueBookingService['createBooking']>) {
    return this.domain2.createBooking(...args);
  }
  checkIn(...args: Parameters<VenueFulfillmentService['checkIn']>) {
    return this.domain3.checkIn(...args);
  }
  completeBooking(
    ...args: Parameters<VenueFulfillmentService['completeBooking']>
  ) {
    return this.domain3.completeBooking(...args);
  }
  updateCourt(...args: Parameters<VenuePricingService['updateCourt']>) {
    return this.domain4.updateCourt(...args);
  }
  listTimeSlots(...args: Parameters<VenuePricingService['listTimeSlots']>) {
    return this.domain4.listTimeSlots(...args);
  }
  listPriceRules(...args: Parameters<VenuePricingService['listPriceRules']>) {
    return this.domain4.listPriceRules(...args);
  }
  createPriceRule(...args: Parameters<VenuePricingService['createPriceRule']>) {
    return this.domain4.createPriceRule(...args);
  }
  createPriceRuleVersion(
    ...args: Parameters<VenuePricingService['createPriceRuleVersion']>
  ) {
    return this.domain4.createPriceRuleVersion(...args);
  }
  setPriceRuleStatus(
    ...args: Parameters<VenuePricingService['setPriceRuleStatus']>
  ) {
    return this.domain4.setPriceRuleStatus(...args);
  }
}
