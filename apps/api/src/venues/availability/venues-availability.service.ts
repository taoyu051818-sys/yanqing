import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';
import { availability } from './venues-availability.commands.js';

@Injectable()
export class VenueAvailabilityService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}
  async availability(date: string, includeUnavailable = false) {
    return availability(this.prisma, date, includeUnavailable);
  }
}
