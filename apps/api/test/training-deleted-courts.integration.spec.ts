import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/database/prisma.service.js';
import { VenueSettingsService } from '../src/venues/settings/venue-settings.service.js';
import { TrainingScheduleService } from '../src/training/schedule/training-schedule.service.js';
import type { AuthUser } from '../src/common/auth/auth-user.js';
import type { Prisma } from '../src/generated/prisma/client.js';

const url = process.env.TEST_DATABASE_URL;
function barrier() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
describe.skipIf(!url)('training scheduling and court deletion on PostgreSQL', () => {
  let db: PrismaService, settings: VenueSettingsService, training: TrainingScheduleService, admin: AuthUser;
  beforeAll(async () => {
    const target = new URL(url!);
    if (!['127.0.0.1', 'localhost'].includes(target.hostname) || !target.pathname.endsWith('_test')) throw new Error('Isolated local test database required');
    db = new PrismaService(new ConfigService({ DATABASE_URL: url })); await db.$connect();
    settings = new VenueSettingsService(db); training = new TrainingScheduleService(db);
    const user = await db.user.create({ data: { displayName: '排课测试管理员', primaryRole: 'ADMIN' } });
    admin = { sub: user.id, roles: ['ADMIN'], displayName: user.displayName };
  });
  afterAll(async () => { await db?.$disconnect(); });
  async function fixture() {
    const key = randomUUID().replaceAll('-', '').slice(0, 16);
    const court = await settings.createCourt({ code: 'TR_' + key.toUpperCase(), name: '排课测试场', zone: 'EAST', usage: 'TRAINING', enabled: true, sortOrder: 1 }, admin);
    const product = await db.trainingProduct.create({ data: { code: key, name: '测试课包', audience: 'ADULT', totalSessions: 1, validityDays: 30, priceCents: 100, unitRevenueCents: 100, refundRule: {} } });
    const cls = await db.trainingClass.create({ data: { code: key, name: '测试班级', productId: product.id, schedule: {}, capacity: 10 } });
    const dto = { classId: cls.id, courtIds: [court.id], startsAt: '2036-02-01T01:00:00Z', endsAt: '2036-02-01T02:00:00Z', creationIdempotencyKey: randomUUID() };
    return { court, cls, dto };
  }
  // Hold a real transaction after the service's work, before its commit, so
  // each ordering is deterministic rather than relying on a timing race.
  function heldClient(ready: ReturnType<typeof barrier>, release: ReturnType<typeof barrier>) {
    return {
      auditLog: db.auditLog,
      $transaction: (work: (tx: Prisma.TransactionClient) => Promise<unknown>, options?: object) => db.$transaction(async tx => {
        const value = await work(tx); ready.resolve(); await release.promise; return value;
      }, { ...options, timeout: 10000 }),
    } as unknown as PrismaService;
  }
  async function waitForCourtLockWaiter() {
    for (let attempt = 0; attempt < 150; attempt++) {
      const [{ count }] = await db.$queryRaw<{ count: number }[]>`SELECT COUNT(*)::int AS count FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE '%Court%'`;
      if (count > 0) return;
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    throw new Error('Expected scheduling/deletion to wait on the court lock');
  }
  it('rejects deleted and missing courts without partially creating a session', async () => {
    const f = await fixture(); await settings.deleteCourt(f.court.id, admin);
    for (const courtIds of [[f.court.id], ['missing-' + randomUUID()]]) {
      await expect(training.createSession({ ...f.dto, courtIds, creationIdempotencyKey: randomUUID() }, admin)).rejects.toThrow('不存在或已删除');
    }
    expect(await db.trainingSession.count({ where: { classId: f.cls.id } })).toBe(0);
    expect(await db.courtBooking.count({ where: { courtId: f.court.id } })).toBe(0);
  });
  it('preserves an existing session and its idempotent replay after deletion', async () => {
    const f = await fixture(); const created = await training.createSession(f.dto, admin);
    await settings.deleteCourt(f.court.id, admin);
    expect(await training.createSession(f.dto, admin)).toEqual(created);
    expect(await db.courtBooking.count({ where: { courtId: f.court.id, status: 'CONFIRMED' } })).toBe(1);
    await expect(training.createSession({ ...f.dto, startsAt: '2036-02-02T01:00:00Z', endsAt: '2036-02-02T02:00:00Z', creationIdempotencyKey: randomUUID() }, admin)).rejects.toThrow('已删除');
  });
  it('deletion first: blocks scheduling and returns a conflict with no new occupancy', async () => {
    const f = await fixture(), ready = barrier(), release = barrier();
    const deletion = new VenueSettingsService(heldClient(ready, release)).deleteCourt(f.court.id, admin);
    await ready.promise;
    const result = training.createSession(f.dto, admin).then(value => ({ value, error: null }), error => ({ value: null, error }));
    try { await waitForCourtLockWaiter(); } finally { release.resolve(); await deletion; }
    const outcome = await result;
    expect(outcome.error?.getStatus()).toBe(409);
    expect(await db.trainingSession.count({ where: { classId: f.cls.id } })).toBe(0);
    expect(await db.courtBooking.count({ where: { courtId: f.court.id } })).toBe(0);
  });
  it('scheduling first: deletion waits for the booking to commit and preserves it', async () => {
    const f = await fixture(), ready = barrier(), release = barrier();
    const creation = new TrainingScheduleService(heldClient(ready, release)).createSession(f.dto, admin);
    await ready.promise;
    const deletion = settings.deleteCourt(f.court.id, admin);
    try { await waitForCourtLockWaiter(); } finally { release.resolve(); }
    const created = await creation; await deletion;
    expect((await db.court.findUniqueOrThrow({ where: { id: f.court.id } })).deletedAt).not.toBeNull();
    expect((await db.trainingSession.findUniqueOrThrow({ where: { id: created.id } })).status).toBe('SCHEDULED');
    expect(await db.courtBooking.count({ where: { courtId: f.court.id, status: 'CONFIRMED' } })).toBe(1);
  });
});
