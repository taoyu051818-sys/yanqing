import 'reflect-metadata';
import { type INestApplication } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { JwtAuthGuard } from '../src/common/auth/jwt-auth.guard.js';
import { RolesGuard } from '../src/common/auth/roles.guard.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { GamesController } from '../src/games/games.controller.js';
import { GameCatalogService } from '../src/games/catalog/games-catalog.service.js';
import { GameHostsService } from '../src/games/hosts/games-hosts.service.js';
import { GameCancellationService } from '../src/games/cancellation/games-cancellation.service.js';
import { GameRegistrationService } from '../src/games/registration/games-registration.service.js';
import { GameCompletionService } from '../src/games/completion/games-completion.service.js';
import { GameRewardsService } from '../src/games/rewards/games-rewards.service.js';
import { EventCatalogController } from '../src/events/catalog/event-catalog.controller.js';
import { EventCatalogService } from '../src/events/catalog/event-catalog.service.js';
import { EventCancellationService } from '../src/events/catalog/event-cancellation.service.js';
import { EventRegistrationController } from '../src/events/registration/event-registration.controller.js';
import { EventRegistrationService } from '../src/events/registration/event-registration.service.js';
import { EventParticipationService } from '../src/events/registration/event-participation.service.js';
import { EventWithdrawalService } from '../src/events/registration/event-withdrawal.service.js';

// Real controllers, public queries and auth/role guards; only database transport is stubbed.
// The projection adapter models select/where so an accidental broad query exposes fixture secrets.
const rows = {
  game: [
    {
      id: 'game-open',
      title: '公开球局',
      status: 'OPEN',
      capacity: 8,
      host: { displayName: '主理人', avatarUrl: null, phone: 'private-phone' },
      _count: { registrations: 2 },
      registrations: [{ userId: 'private-member', orderId: 'private-order' }],
      cancelReason: 'private-note',
    },
    { id: 'game-draft', status: 'DRAFT' },
  ],
  event: [
    {
      id: 'event-open',
      name: '公开赛事',
      status: 'OPEN',
      capacityPeople: 32,
      contactPhone: 'private-phone',
      teams: [{ captainId: 'private-member' }],
    },
    { id: 'event-draft', status: 'DRAFT' },
  ],
};
function project(row: any, select: any): any {
  if (!select) return row;
  return Object.fromEntries(
    Object.entries(select).map(([key, shape]: [string, any]) => [
      key,
      shape === true
        ? row[key]
        : row[key] == null
          ? null
          : project(row[key], shape.select),
    ]),
  );
}
function query(kind: keyof typeof rows) {
  return vi.fn(async (args: any) =>
    rows[kind]
      .filter(
        (row) =>
          !args.where?.status?.in || args.where.status.in.includes(row.status),
      )
      .map((row) => project(row, args.select)),
  );
}
const prisma = {
  game: { findMany: query('game') },
  event: { findMany: query('event') },
  user: { findUnique: vi.fn() },
};
const commands = { register: vi.fn(), create: vi.fn(), managedList: vi.fn() };
let app: INestApplication;

describe('guest activity browsing through real authentication guards', () => {
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [
        GamesController,
        EventCatalogController,
        EventRegistrationController,
      ],
      providers: [
        GameCatalogService,
        EventCatalogService,
        { provide: PrismaService, useValue: prisma },
        ...[
          GameHostsService,
          GameCancellationService,
          GameRegistrationService,
          GameCompletionService,
          GameRewardsService,
          EventCancellationService,
          EventRegistrationService,
          EventParticipationService,
          EventWithdrawalService,
        ].map((provide) => ({ provide, useValue: commands })),
      ],
    }).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api/v1');
    const reflector = new Reflector();
    app.useGlobalGuards(
      new JwtAuthGuard(
        new JwtService(),
        reflector,
        prisma as unknown as PrismaService,
        new ConfigService(),
      ),
      new RolesGuard(reflector),
    );
    await app.init();
  });
  afterAll(async () => {
    await app?.close();
  });

  it('serves only published game metadata/counts, without an account or personal registration', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/games/public')
      .expect(200);
    expect(response.body).toHaveLength(1);
    expect(response.body[0]).toMatchObject({
      id: 'game-open',
      title: '公开球局',
      myRegistration: null,
      _count: { registrations: 2 },
    });
    expect(JSON.stringify(response.body)).not.toMatch(/private-|game-draft/);
    expect(prisma.game.findMany.mock.calls[0][0].select).not.toHaveProperty(
      'registrations',
    );
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });
  it('serves published event metadata even with an expired token and no personal/team fields', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/events')
      .set('Authorization', 'Bearer expired')
      .expect(200);
    expect(response.body).toEqual([
      {
        id: 'event-open',
        name: '公开赛事',
        status: 'OPEN',
        capacityPeople: 32,
      },
    ]);
    expect(JSON.stringify(response.body)).not.toMatch(/private-|event-draft/);
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });
  it.each([
    '/games',
    '/games/managed',
    '/games/game-open/participants',
    '/events/managed',
    '/events/event-open/registration/me',
  ])('still requires login for private GET %s', async (path) => {
    await request(app.getHttpServer())
      .get('/api/v1' + path)
      .expect(401);
  });
  it.each([
    '/games/game-open/register',
    '/events/event-open/register',
    '/games',
    '/events',
  ])(
    'still requires login for POST %s before any business command',
    async (path) => {
      await request(app.getHttpServer())
        .post('/api/v1' + path)
        .send({})
        .expect(401);
      expect(commands.register).not.toHaveBeenCalled();
      expect(commands.create).not.toHaveBeenCalled();
    },
  );
});
