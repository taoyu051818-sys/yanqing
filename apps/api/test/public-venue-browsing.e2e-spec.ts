import 'reflect-metadata';
import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { JwtAuthGuard } from '../src/common/auth/jwt-auth.guard.js';
import { RolesGuard } from '../src/common/auth/roles.guard.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { VenuesController } from '../src/venues/venues.controller.js';
import { VenueAvailabilityService } from '../src/venues/availability/venues-availability.service.js';
import { VenueBookingService } from '../src/venues/booking/venues-booking.service.js';
import { VenueClosuresService } from '../src/venues/closures/venues-closures.service.js';
import { VenueFulfillmentService } from '../src/venues/fulfillment/venues-fulfillment.service.js';
import { VenuePricingService } from '../src/venues/pricing/venues-pricing.service.js';

// Real controller, availability query/projection and guards; only SQL is replaced.
const startsAt = new Date('2030-01-01T10:00:00+08:00');
const endsAt = new Date('2030-01-01T11:00:00+08:00');
const prisma = {
  user: { findUnique: vi.fn() },
  court: { findMany: vi.fn(async () => [{ id: 'court', name: '1号场', enabled: true, usage: 'NORMAL', internalNote: 'private' }]) },
  timeSlot: { findMany: vi.fn(async () => [{ id: 'slot', label: '10:00', startMinutes: 600, endMinutes: 660, period: 'DAY', enabled: true }]) },
  courtBooking: {
    updateMany: vi.fn(async () => ({ count: 0 })),
    findMany: vi.fn(async () => [{ courtId: 'court', startsAt, endsAt, status: 'CONFIRMED', usage: 'NORMAL', orderId: 'private-order', userId: 'private-user', phone: 'private-phone' }]),
  },
  courtClosure: { findMany: vi.fn(async () => [{ courtId: 'court', startsAt, endsAt, status: 'ACTIVE', reason: 'private-reason', createdById: 'private-staff' }]) },
  priceRule: { findMany: vi.fn(async () => [{ weekdayMask: 127, timeSlotId: 'slot', priceCents: 6000, newcomerPriceCents: 5000 }]) },
};
const commands = { createBooking: vi.fn() };
let app: INestApplication;

describe('guest court availability through real authentication guards', () => {
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [VenuesController],
      providers: [VenueAvailabilityService,
        { provide: PrismaService, useValue: prisma },
        { provide: VenueBookingService, useValue: commands },
        ...[VenueClosuresService, VenueFulfillmentService, VenuePricingService].map(provide => ({ provide, useValue: {} })),
      ],
    }).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
    const reflector = new Reflector();
    app.useGlobalGuards(new JwtAuthGuard(new JwtService(), reflector, prisma as unknown as PrismaService, new ConfigService()), new RolesGuard(reflector));
    await app.init();
  });
  afterAll(async () => { await app?.close(); });

  it.each(['', 'expired'])('shows schedule, occupancy, closures and prices with token %j', async token => {
    const req = request(app.getHttpServer()).get('/api/v1/venues/availability?date=2030-01-01');
    if (token) req.set('Authorization', 'Bearer ' + token);
    const { body } = await req.expect(200);
    expect(body.date).toBe('2030-01-01');
    expect(body.courts[0]).toEqual({ id: 'court', name: '1号场', enabled: true, usage: 'NORMAL' });
    expect(body.slots[0].price).toEqual({ priceCents: 6000, newcomerPriceCents: 5000 });
    expect(body.bookings).toEqual([{ courtId: 'court', startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString(), status: 'CONFIRMED', usage: 'NORMAL' }]);
    expect(body.closures).toEqual([{ courtId: 'court', startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString(), status: 'ACTIVE' }]);
    expect(JSON.stringify(body)).not.toMatch(/private|orderId|userId|phone|createdById/);
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
    expect(prisma.court.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { enabled: true, deletedAt: null } }));
  });

  it.each(['/availability/assisted', '/closures', '/time-slots/manage', '/price-rules/manage'])('keeps staff query %s authenticated', async path => {
    await request(app.getHttpServer()).get('/api/v1/venues' + path + '?date=2030-01-01').expect(401);
  });
  it('requires login before creating a booking', async () => {
    await request(app.getHttpServer()).post('/api/v1/venues/bookings').send({ date: '2030-01-01', courtId: 'court', slotId: 'slot' }).expect(401);
    expect(commands.createBooking).not.toHaveBeenCalled();
  });
});
