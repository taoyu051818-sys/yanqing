import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import {
  Global,
  Module,
  RequestMethod,
  type INestApplication,
  type Type,
} from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { NextFunction, Request, Response } from 'express';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PrismaService } from '../src/database/prisma.service.js';
import { EventsModule } from '../src/events/events.module.js';
import { TrainingModule } from '../src/training/training.module.js';
import { TrainingTrialsService } from '../src/training/training-trials.service.js';
import { YouthTrainingRulesService } from '../src/training/youth-training-rules.service.js';
import { RolesGuard } from '../src/common/auth/roles.guard.js';
import {
  IS_PUBLIC_KEY,
  ROLES_KEY,
} from '../src/common/auth/auth.decorators.js';
import { EventCatalogController } from '../src/events/catalog/event-catalog.controller.js';
import { EventInvitationsController } from '../src/events/invitations/event-invitations.controller.js';
import { EventRegistrationController } from '../src/events/registration/event-registration.controller.js';
import { EventCompetitionController } from '../src/events/competition/event-competition.controller.js';
import { EventPrizesController } from '../src/events/prizes/event-prizes.controller.js';
import { TrainingCatalogController } from '../src/training/catalog/training-catalog.controller.js';
import { TrainingStudentsController } from '../src/training/students/training-students.controller.js';
import { TrainingEnrollmentsController } from '../src/training/enrollments/training-enrollments.controller.js';
import { TrainingScheduleController } from '../src/training/schedule/training-schedule.controller.js';
import { TrainingAttendanceController } from '../src/training/attendance/training-attendance.controller.js';
import { TrainingConsumptionController } from '../src/training/consumption/training-consumption.controller.js';
import { TrainingCorrectionsController } from '../src/training/corrections/training-corrections.controller.js';
import { TrainingSettlementsController } from '../src/training/settlements/training-settlements.controller.js';
import { EventCatalogService } from '../src/events/catalog/event-catalog.service.js';
import { EventCancellationService } from '../src/events/catalog/event-cancellation.service.js';
import { EventInvitationsService } from '../src/events/invitations/event-invitations.service.js';
import { EventRegistrationService } from '../src/events/registration/event-registration.service.js';
import { EventParticipationService } from '../src/events/registration/event-participation.service.js';
import { EventWithdrawalService } from '../src/events/registration/event-withdrawal.service.js';
import { EventCompetitionService } from '../src/events/competition/event-competition.service.js';
import { EventPrizesService } from '../src/events/prizes/event-prizes.service.js';
import { TrainingCatalogService } from '../src/training/catalog/training-catalog.service.js';
import { TrainingStudentsService } from '../src/training/students/training-students.service.js';
import { TrainingEnrollmentsService } from '../src/training/enrollments/training-enrollments.service.js';
import { TrainingScheduleService } from '../src/training/schedule/training-schedule.service.js';
import { TrainingAttendanceService } from '../src/training/attendance/training-attendance.service.js';
import { TrainingConsumptionService } from '../src/training/consumption/training-consumption.service.js';
import { TrainingCorrectionsService } from '../src/training/corrections/training-corrections.service.js';
import { TrainingSettlementsService } from '../src/training/settlements/training-settlements.service.js';

const controllers: Record<string, Type> = {
  EventCatalogController,
  EventInvitationsController,
  EventRegistrationController,
  EventCompetitionController,
  EventPrizesController,
  TrainingCatalogController,
  TrainingStudentsController,
  TrainingEnrollmentsController,
  TrainingScheduleController,
  TrainingAttendanceController,
  TrainingConsumptionController,
  TrainingCorrectionsController,
  TrainingSettlementsController,
};
const providers: Record<string, Type> = {
  EventCatalogService,
  EventCancellationService,
  EventInvitationsService,
  EventRegistrationService,
  EventParticipationService,
  EventWithdrawalService,
  EventCompetitionService,
  EventPrizesService,
  TrainingCatalogService,
  TrainingStudentsService,
  TrainingEnrollmentsService,
  TrainingScheduleService,
  TrainingAttendanceService,
  TrainingConsumptionService,
  TrainingCorrectionsService,
  TrainingSettlementsService,
};

interface RouteContract {
  controller: string;
  method: string;
  verb: string;
  path: string;
  roles: string[];
  isPublic: boolean;
  provider: string;
  serviceMethod: string;
}
// Captured from the pre-split controllers: changes require explicit API review.
const routes: RouteContract[] = JSON.parse(
  readFileSync(
    new URL('./fixtures/domain-routes.json', import.meta.url),
    'utf8',
  ),
);
@Global()
@Module({
  providers: [{ provide: PrismaService, useValue: {} }],
  exports: [PrismaService],
})
class TestDatabaseModule {}

describe('functional domain module wiring and HTTP contracts', () => {
  let app: INestApplication;
  const spies = new Map<string, ReturnType<typeof vi.spyOn>>();
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [TestDatabaseModule, EventsModule, TrainingModule],
    })
      .overrideProvider(TrainingTrialsService)
      .useValue({})
      .overrideProvider(YouthTrainingRulesService)
      .useValue({})
      .compile();
    // Keep real domain providers and controllers; stub only command execution.
    // Database integration suites cover the actual commands and transactions.
    for (const route of routes) {
      const key = `${route.provider}.${route.serviceMethod}`;
      if (spies.has(key)) continue;
      const provider = module.get<
        Record<string, (...args: unknown[]) => unknown>
      >(providers[route.provider]);
      spies.set(
        key,
        vi
          .spyOn(provider, route.serviceMethod)
          .mockImplementation(() => ({ handledBy: key })),
      );
    }
    app = module.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.use(
      (
        req: Request & { user?: unknown },
        _res: Response,
        next: NextFunction,
      ) => {
        req.user = {
          sub: 'domain-test-actor',
          roles: [req.get('x-test-role') || 'SUPER_ADMIN'],
        };
        next();
      },
    );
    app.useGlobalGuards(new RolesGuard(new Reflector()));
    await app.init();
  });
  afterAll(async () => {
    await app?.close();
    vi.restoreAllMocks();
  });

  it('preserves all 56 route, role and public-access declarations with no additions or omissions', () => {
    const actual: object[] = [];
    for (const [name, controller] of Object.entries(controllers)) {
      for (const method of Object.getOwnPropertyNames(controller.prototype)) {
        if (method === 'constructor') continue;
        const handler = controller.prototype[method];
        const verb = Reflect.getMetadata(METHOD_METADATA, handler);
        if (verb === undefined) continue;
        actual.push({
          controller: name,
          method,
          verb: RequestMethod[verb],
          path: [
            '/api/v1',
            Reflect.getMetadata(PATH_METADATA, controller),
            Reflect.getMetadata(PATH_METADATA, handler),
          ]
            .join('/')
            .replace(/\/+/g, '/')
            .replace(/\/$/, ''),
          roles: Reflect.getMetadata(ROLES_KEY, handler) || [],
          isPublic: Reflect.getMetadata(IS_PUBLIC_KEY, handler) === true,
        });
      }
    }
    const expected = routes.map(
      ({ controller, method, verb, path, roles, isPublic }) => ({
        controller,
        method,
        verb,
        path,
        roles,
        isPublic,
      }),
    );
    const sort = (items: object[]) =>
      items.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
    expect(actual).toHaveLength(56);
    expect(sort(actual)).toEqual(sort(expected));
    expect(
      new Set(routes.map((route) => `${route.verb} ${route.path}`)).size,
    ).toBe(56);
  });

  it('dispatches every existing HTTP route to its owning domain provider, including static routes', async () => {
    for (const route of routes) {
      vi.clearAllMocks();
      const path = route.path
        .replace(/:round\b/g, '1')
        .replace(/:[a-zA-Z]+/g, 'fixture-id');
      const server = request(app.getHttpServer());
      const call =
        route.verb === 'GET'
          ? server.get(path)
          : route.verb === 'PATCH'
            ? server.patch(path)
            : server.post(path);
      const response = await call.send({
        partnerInviteCode: 'fixture-code',
        date: '2026-09-09',
      });
      const key = `${route.provider}.${route.serviceMethod}`;
      expect(response.status, `${route.verb} ${path}`).toBe(
        route.verb === 'POST' ? 201 : 200,
      );
      expect(response.body, `${route.verb} ${path}`).toEqual({
        handledBy: key,
      });
      expect(spies.get(key)).toHaveBeenCalledTimes(1);
    }
  });

  it('rejects ordinary members before invoking protected domain commands', async () => {
    for (const route of routes.filter(
      (route) => route.roles.length && !route.roles.includes('MEMBER'),
    )) {
      vi.clearAllMocks();
      const path = route.path
        .replace(/:round\b/g, '1')
        .replace(/:[a-zA-Z]+/g, 'fixture-id');
      const server = request(app.getHttpServer());
      const call =
        route.verb === 'GET'
          ? server.get(path)
          : route.verb === 'PATCH'
            ? server.patch(path)
            : server.post(path);
      const response = await call.set('x-test-role', 'MEMBER').send({});
      expect(response.status, `${route.verb} ${path}`).toBe(403);
      expect(
        spies.get(`${route.provider}.${route.serviceMethod}`),
      ).not.toHaveBeenCalled();
    }
  });
});
