import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/database/prisma.service.js';
import { VenueSettingsService } from '../src/venues/settings/venue-settings.service.js';
import { BossService } from '../src/boss/boss.service.js';
import { loadCapacity } from '../src/dashboard/domains/venue-queries.js';
import { updateCourt } from '../src/venues/pricing/venues-pricing.commands.js';
import type { AuthUser } from '../src/common/auth/auth-user.js';
const url = process.env.TEST_DATABASE_URL;
describe.skipIf(!url)('transactional business availability history', () => {
  let db: PrismaService, settings: VenueSettingsService, admin: AuthUser;
  beforeAll(async () => {
    const target = new URL(url!);
    if (
      !['127.0.0.1', 'localhost'].includes(target.hostname) ||
      !target.pathname.endsWith('_test')
    )
      throw new Error('Local isolated database required');
    db = new PrismaService(new ConfigService({ DATABASE_URL: url }));
    await db.$connect();
    settings = new VenueSettingsService(db);
    const user = await db.user.create({
      data: { displayName: '历史口径验收', primaryRole: 'ADMIN' },
    });
    admin = { sub: user.id, displayName: user.displayName, roles: ['ADMIN'] };
  });
  afterAll(async () => {
    await db?.$disconnect();
  });
  it('preserves yesterday’s utilization after hours changes, court deletion and audit cleanup', async () => {
    const date = new Date(Date.now() - 86400000 + 8 * 3600000)
      .toISOString()
      .slice(0, 10);
    const start = new Date(date + 'T09:00:00+08:00'),
      end = new Date(+start + 3600000);
    const court = await db.court.create({
      data: {
        code: randomUUID(),
        name: '历史场地',
        zone: 'EAST',
        sortOrder: 1,
        createdAt: new Date(+start - 86400000),
      },
    });
    const slot = await db.timeSlot.create({
      data: {
        code: randomUUID(),
        label: '09–10',
        startMinutes: 540,
        endMinutes: 600,
        period: 'DAYTIME',
        sortOrder: 540,
        createdAt: new Date(+start - 86400000),
      },
    });
    await db.courtBooking.create({
      data: {
        courtId: court.id,
        startsAt: start,
        endsAt: end,
        status: 'COMPLETED',
      },
    });
    const before = await loadCapacity(db, start, end);
    const boss = new BossService(db, new ConfigService({ NODE_ENV: 'test' }));
    const bossBefore = (await boss.summary(date)).venue;
    expect(before.bookingCount).toBeGreaterThan(0);
    expect(
      before.rows.reduce((sum, r) => sum + r.occupiedMinutes, 0),
    ).toBeGreaterThanOrEqual(60);
    const current = await settings.settings(admin);
    await settings.save(
      {
        ...current,
        name: '测试球馆',
        address: '测试地址',
        contactPhone: '',
        opensAtHour: 10,
        closesAtHour: 11,
      },
      admin,
    );
    expect(
      (await db.timeSlot.findUniqueOrThrow({ where: { id: slot.id } })).enabled,
    ).toBe(false);
    await settings.deleteCourt(court.id, admin);
    await db.auditLog.deleteMany({ where: { actorId: admin.sub } });
    expect(await loadCapacity(db, start, end)).toEqual(before);
    expect((await boss.summary(date)).venue).toEqual(bossBefore);
  });
  it('rolls back history with the original write and ignores metadata-only edits', async () => {
    const court = await settings.createCourt(
      {
        code: 'ATOMIC_' + randomUUID().slice(0, 8).toUpperCase(),
        name: '原名称',
        zone: 'EAST',
        usage: 'RETAIL',
        enabled: true,
        sortOrder: 1,
      },
      admin,
    );
    const count = () =>
      db.courtAvailability.count({ where: { courtId: court.id } });
    expect(await count()).toBe(1);
    await expect(
      db.$transaction(async (tx) => {
        await tx.court.update({
          where: { id: court.id },
          data: { enabled: false },
        });
        expect(
          await tx.courtAvailability.count({ where: { courtId: court.id } }),
        ).toBe(2);
        throw new Error('后续写入失败');
      }),
    ).rejects.toThrow('后续写入失败');
    expect(await count()).toBe(1);
    const renamed = await updateCourt(
      db,
      court.id,
      { revision: court.updatedAt.toISOString(), name: '新名称' },
      admin,
    );
    expect(await count()).toBe(1);
    await updateCourt(
      db,
      court.id,
      { revision: renamed.updatedAt.toISOString(), enabled: false },
      admin,
    );
    expect(await count()).toBe(2);
    const versions = await db.courtAvailability.findMany({
      where: { courtId: court.id },
      orderBy: { validFrom: 'asc' },
    });
    expect(versions[0].validTo).toEqual(versions[1].validFrom);
    expect(versions.map((v) => v.enabled)).toEqual([true, false]);
  });
  it('does not create fake hour transitions when only contact information changes', async () => {
    const before = await settings.settings(admin),
      historyCount = await db.timeSlotAvailability.count();
    await settings.save(
      {
        ...before,
        contactPhone: '010-12345678',
        opensAtHour: before.opensAtHour!,
        closesAtHour: before.closesAtHour!,
      },
      admin,
    );
    expect(await db.timeSlotAvailability.count()).toBe(historyCount);
  });
  it('retains a backdated booking even before any operating schedule existed', async () => {
    const start = new Date('2001-01-01T10:00:00+08:00'),
      end = new Date(+start + 3600000);
    const baseline = await loadCapacity(db, start, end);
    const court = await db.court.create({
      data: {
        code: randomUUID(),
        name: '补录场地',
        zone: 'EAST',
        sortOrder: 2,
      },
    });
    await db.courtBooking.create({
      data: {
        court: { connect: { id: court.id } },
        startsAt: start,
        endsAt: end,
        status: 'CONFIRMED',
        operatorOverride: true,
        overrideReason: '管理员补录历史预约',
        order: {
          create: {
            orderNo: randomUUID(),
            memberId: admin.sub,
            businessType: 'VENUE',
            subjectAccount: 'VENUE',
            sourceChannel: 'MINI_PROGRAM',
            title: '历史补录',
            parameterSnapshot: {},
            listAmountCents: 0,
            payableCents: 0,
            status: 'PAID',
            createdAt: start,
            paidAt: start,
          },
        },
      },
    });
    const result = await loadCapacity(db, start, end);
    expect(result.bookingCount - baseline.bookingCount).toBe(1);
    expect(
      result.rows.reduce((sum, r) => sum + r.occupiedMinutes, 0) -
        baseline.rows.reduce((sum, r) => sum + r.occupiedMinutes, 0),
    ).toBe(60);
    expect(result.rows.reduce((sum, r) => sum + r.emptyMinutes, 0)).toBe(0);
    expect(result.rows.some((r) => r.id === 'unconfigured:10')).toBe(true);
  });
});
