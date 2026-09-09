import { Inject, Injectable } from '@nestjs/common';
import type { AuthUser } from '../../common/auth/auth-user.js';
import { PrismaService } from '../../database/prisma.service.js';
import type { CreateVenueBookingDto } from '../venues.dto.js';
import { createBooking } from './venues-booking.commands.js';

@Injectable()
export class VenueBookingService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}
  async createBooking(dto: CreateVenueBookingDto, actor: AuthUser) {
    return createBooking(this.prisma, dto, actor);
  }
}
