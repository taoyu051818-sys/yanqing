import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/database/prisma.service.js';
import { VenueSettingsService } from '../src/venues/settings/venue-settings.service.js';
import { updateCourt } from '../src/venues/pricing/venues-pricing.commands.js';
import { loadCapacity } from '../src/dashboard/domains/venue-queries.js';
import { BossService } from '../src/boss/boss.service.js';
import type { AuthUser } from '../src/common/auth/auth-user.js';
const url = process.env.TEST_DATABASE_URL;
describe.skipIf(!url)('court edit revisions and deletion history on PostgreSQL', () => {
  let db: PrismaService, settings: VenueSettingsService, admin: AuthUser;
  beforeAll(async () => {
    const target = new URL(url!);
    if (!['127.0.0.1', 'localhost'].includes(target.hostname) || !target.pathname.endsWith('_test')) throw new Error('Local isolated test database required');
    db = new PrismaService(new ConfigService({ DATABASE_URL: url })); await db.$connect(); settings = new VenueSettingsService(db);
    const user = await db.user.create({ data: { displayName: '场地回归管理员', primaryRole: 'ADMIN' } });
    admin = { sub: user.id, displayName: user.displayName, roles: ['ADMIN'] };
  });
  afterAll(async () => { await db?.$disconnect(); });
  const create = () => settings.createCourt({ code: 'R2_' + randomUUID().replaceAll('-', '').slice(0, 16).toUpperCase(), name: '测试场地', zone: 'EAST', usage: 'RETAIL', enabled: true, sortOrder: 100 }, admin);
  it('rejects a stale full form and accepts a freshly read revision', async () => {
    const court = await create();
    const first = await updateCourt(db, court.id, { revision: court.updatedAt.toISOString(), enabled: false, usage: 'MAINTENANCE' }, admin);
    await expect(updateCourt(db, court.id, { revision: court.updatedAt.toISOString(), name: '乙改名', enabled: court.enabled, usage: court.usage }, admin)).rejects.toMatchObject({ status: 409 });
    await expect(updateCourt(db, court.id, { name: '缺少版本' } as never, admin)).rejects.toMatchObject({ status: 409 });
    expect(await db.court.findUniqueOrThrow({ where: { id: court.id } })).toMatchObject({ enabled: false, usage: 'MAINTENANCE', name: court.name });
    expect(await db.auditLog.count({ where: { objectId: court.id, action: 'COURT_UPDATED' } })).toBe(1);
    const fresh = (await settings.settings(admin)).courts.find(c => c.id === court.id)!;
    expect(fresh.updatedAt).toEqual(first.updatedAt);
    const second = await updateCourt(db, court.id, { revision: fresh.updatedAt.toISOString(), name: '重新核对后改名' }, admin);
    expect(+second.updatedAt).toBeGreaterThan(+first.updatedAt);
    expect(second).toMatchObject({ enabled: false, usage: 'MAINTENANCE' });
  });
  it('allows exactly one of two concurrent saves using the same revision', async () => {
    const court = await create(), revision = court.updatedAt.toISOString();
    const results = await Promise.allSettled([
      updateCourt(db, court.id, { revision, enabled: false }, admin),
      updateCourt(db, court.id, { revision, name: '并发改名' }, admin),
    ]);
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    const failed = results.find(r => r.status === 'rejected') as PromiseRejectedResult;
    expect(failed.reason).toMatchObject({ status: 409 });
    expect(await db.auditLog.count({ where: { objectId: court.id, action: 'COURT_UPDATED' } })).toBe(1);
  });
  it('keeps historical counts and occupied minutes identical after deletion in dashboard and boss summary', async () => {
    const date = new Date(Date.now() - 86400000 + 8 * 3600000).toISOString().slice(0, 10);
    const start = new Date(date + 'T09:00:00+08:00'), end = new Date(+start + 3600000);
    const court = await db.court.create({ data: { code: 'HIST_' + randomUUID(), name: '历史场地', zone: 'EAST', sortOrder: 100, createdAt: new Date(+start - 86400000) } });
    // Use one existing matching slot if available; this suite also runs on a fresh database.
    if (!await db.timeSlot.findFirst({ where: { enabled: true, startMinutes: 540, endMinutes: 600 } })) await db.timeSlot.create({ data: { createdAt: new Date(+start - 86400000), code: 'R2_' + randomUUID(), label: '09:00-10:00', startMinutes: 540, endMinutes: 600, period: 'DAYTIME', sortOrder: 540 } });
    const booking = await db.courtBooking.create({ data: { courtId: court.id, startsAt: start, endsAt: end, status: 'COMPLETED' } });
    const boss = new BossService(db, new ConfigService({ NODE_ENV: 'test' }));
    const before = await loadCapacity(db, start, end), bossBefore = await boss.summary(date);
    expect(before.bookingCount).toBeGreaterThan(0); expect(before.rows.reduce((n, r) => n + r.occupiedMinutes, 0)).toBeGreaterThanOrEqual(60);
    await settings.deleteCourt(court.id, admin);
    expect(await loadCapacity(db, start, end)).toEqual(before);
    expect((await boss.summary(date)).venue).toEqual(bossBefore.venue);
    expect(await db.courtBooking.findUnique({ where: { id: booking.id } })).toMatchObject({ status: 'COMPLETED' });
    expect((await settings.settings(admin)).courts.some(c => c.id === court.id)).toBe(false);
    // Future retained bookings still contribute actual utilization after removal.
    const future = new Date(+start + 7 * 86400000), futureEnd = new Date(+future + 3600000);
    const empty = await loadCapacity(db, future, futureEnd);
    await db.courtBooking.create({ data: { courtId: court.id, startsAt: future, endsAt: futureEnd, status: 'CONFIRMED' } });
    const retained = await loadCapacity(db, future, futureEnd);
    expect(retained.bookingCount - empty.bookingCount).toBe(1);
    expect(retained.rows.reduce((n, r) => n + r.occupiedMinutes, 0) - empty.rows.reduce((n, r) => n + r.occupiedMinutes, 0)).toBe(60);
    expect(retained.rows.reduce((n, r) => n + r.emptyMinutes, 0)).toBe(empty.rows.reduce((n, r) => n + r.emptyMinutes, 0));
  });
});
