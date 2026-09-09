import type { PrismaService } from '../../src/database/prisma.service.js';
import { TrainingTrialBookingService } from '../../src/training/trials/booking/training-trials-booking.service.js';
import { TrainingTrialFollowUpService } from '../../src/training/trials/follow-up/training-trials-follow-up.service.js';
/** Test-only composition of domain services; never loaded in production. */
export class TrainingTrialsService {
  private readonly domain0: TrainingTrialBookingService;
  private readonly domain1: TrainingTrialFollowUpService;
  constructor(prisma: PrismaService) {
    this.domain0 = new TrainingTrialBookingService(prisma);
    this.domain1 = new TrainingTrialFollowUpService(prisma);
  }
  list(...args: Parameters<TrainingTrialBookingService['list']>) {
    return this.domain0.list(...args);
  }
  create(...args: Parameters<TrainingTrialBookingService['create']>) {
    return this.domain0.create(...args);
  }
  checkIn(...args: Parameters<TrainingTrialFollowUpService['checkIn']>) {
    return this.domain1.checkIn(...args);
  }
  noShow(...args: Parameters<TrainingTrialFollowUpService['noShow']>) {
    return this.domain1.noShow(...args);
  }
  assess(...args: Parameters<TrainingTrialFollowUpService['assess']>) {
    return this.domain1.assess(...args);
  }
  convert(...args: Parameters<TrainingTrialFollowUpService['convert']>) {
    return this.domain1.convert(...args);
  }
  lost(...args: Parameters<TrainingTrialFollowUpService['lost']>) {
    return this.domain1.lost(...args);
  }
  cancel(...args: Parameters<TrainingTrialFollowUpService['cancel']>) {
    return this.domain1.cancel(...args);
  }
}
