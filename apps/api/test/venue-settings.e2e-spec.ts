import 'reflect-metadata';
import { type INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { JwtAuthGuard } from '../src/common/auth/jwt-auth.guard.js';
import { RolesGuard } from '../src/common/auth/roles.guard.js';
import { VenueSettingsController } from '../src/venues/settings/venue-settings.controller.js';
import { VenueSettingsService } from '../src/venues/settings/venue-settings.service.js';
const service = { publicProfile: vi.fn(() => ({ name: '金羽', address: '测试路1号', courtCount: 10 })), settings: vi.fn(), save: vi.fn(), createCourt: vi.fn(), deleteCourt: vi.fn() };
let app: INestApplication;
describe('venue profile and settings authentication boundary', () => {
  beforeAll(async () => {
    const module = await Test.createTestingModule({ controllers: [VenueSettingsController], providers: [{ provide: VenueSettingsService, useValue: service }] }).compile();
    app = module.createNestApplication();
    const reflector = new Reflector();
    app.useGlobalGuards(new JwtAuthGuard(new JwtService(), reflector, {} as never, new ConfigService()), new RolesGuard(reflector));
    await app.init();
  });
  afterAll(async () => { await app?.close(); });
  it.each(['', 'expired'])('serves public profile with session %j', async token => {
    const req = request(app.getHttpServer()).get('/venues/profile'); if (token) req.set('Authorization', 'Bearer ' + token);
    expect((await req.expect(200)).body).toMatchObject({ name: '金羽', courtCount: 10 });
  });
  it('does not load settings or execute writes without authentication', async () => {
    await request(app.getHttpServer()).get('/venues/settings').expect(401);
    await request(app.getHttpServer()).post('/venues/settings').send({}).expect(401);
    await request(app.getHttpServer()).post('/venues/courts').send({}).expect(401);
    await request(app.getHttpServer()).delete('/venues/courts/court-1').expect(401);
    expect(service.deleteCourt).not.toHaveBeenCalled();
    expect(service.settings).not.toHaveBeenCalled(); expect(service.save).not.toHaveBeenCalled(); expect(service.createCourt).not.toHaveBeenCalled();
  });
});
