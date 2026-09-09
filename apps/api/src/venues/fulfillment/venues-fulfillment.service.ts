import { Inject, Injectable } from '@nestjs/common';
import type { AuthUser } from '../../common/auth/auth-user.js';
import { PrismaService } from '../../database/prisma.service.js';
import type {
  CompleteVenueBookingDto,
  VenueCheckInDto,
} from '../venues.dto.js';
import { checkIn, completeBooking } from './venues-fulfillment.commands.js';

@Injectable()
export class VenueFulfillmentService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}
  async checkIn(orderId: string, actor: AuthUser, dto: VenueCheckInDto = {}) {
    return checkIn(this.prisma, orderId, actor, dto);
  }
  async completeBooking(
    orderId: string,
    dto: CompleteVenueBookingDto,
    actor: AuthUser,
  ) {
    return completeBooking(this.prisma, orderId, dto, actor);
  }
}
