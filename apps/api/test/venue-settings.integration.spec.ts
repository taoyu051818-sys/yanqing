import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/database/prisma.service.js';
import { VenueSettingsService } from '../src/venues/settings/venue-settings.service.js';
import { VenueAvailabilityService } from '../src/venues/availability/venues-availability.service.js';
import { VenueBookingService } from '../src/venues/booking/venues-booking.service.js';
import { updateCourt } from '../src/venues/pricing/venues-pricing.commands.js';
import type { AuthUser } from '../src/common/auth/auth-user.js';
const url = process.env.TEST_DATABASE_URL;
describe.skipIf(!url)('venue configuration on isolated PostgreSQL', () => {
  let db: PrismaService, settings: VenueSettingsService, availability: VenueAvailabilityService, booking: VenueBookingService, admin: AuthUser;
  beforeAll(async () => {
    const target = new URL(url!);
    if (!['127.0.0.1', 'localhost'].includes(target.hostname) || !target.pathname.endsWith('_test')) throw new Error('Isolated local test database required');
    db = new PrismaService(new ConfigService({ DATABASE_URL: url })); await db.$connect();
    settings = new VenueSettingsService(db); availability = new VenueAvailabilityService(db); booking = new VenueBookingService(db);
    const user = await db.user.create({ data: { displayName: '设置管理员', primaryRole: 'ADMIN' } });
    admin = { sub: user.id, displayName: user.displayName, roles: ['ADMIN'] };
  });
  afterAll(async () => { await db?.$disconnect(); });
  it('updates public info, real bookable hours and courts while preserving existing reservations', async () => {
    const court = await settings.createCourt({ code: 'SETTINGS_TEST', name: '原场地', zone: 'EAST', usage: 'RETAIL', enabled: true, sortOrder: 1 }, admin);
    const early = await db.timeSlot.create({ data: { code: 'H08', label: '08:00–09:00', startMinutes: 480, endMinutes: 540, period: 'EARLY', sortOrder: 480 } });
    const retained = await db.timeSlot.create({ data: { code: 'H09', label: '09:00–10:00', startMinutes: 540, endMinutes: 600, period: 'DAYTIME', sortOrder: 540 } });
    await db.priceRule.create({ data: { code: 'SETTINGS_PRICE', version: 1, creationIdempotencyKey: randomUUID(), creationCommandHash: 'a'.repeat(64), createdById: admin.sub, name: '价格', timeSlotId: retained.id, weekdayMask: 127, priceCents: 6800, enabled: true, effectiveFrom: new Date('2020-01-01') } });
    const reserved = await db.courtBooking.create({ data: { courtId: court.id, status: 'CONFIRMED', startsAt: new Date('2035-01-01T00:00:00Z'), endsAt: new Date('2035-01-01T01:00:00Z') } });
    const before = await settings.settings(admin);
    const command = { revision: before.revision, name: '金羽测试球馆', address: '测试路1号', contactPhone: '010-12345678', latitude: 40.4, longitude: 116.1, opensAtHour: 9, closesAtHour: 11 };
    await settings.save(command, admin);
    expect(await settings.publicProfile()).toMatchObject({ name: command.name, address: command.address, opensAtHour: 9, closesAtHour: 11 });
    expect(await settings.publicProfile()).not.toHaveProperty('revision');
    const calendar = await availability.availability('2035-01-01');
    expect(calendar.slots.map(slot => slot.startMinutes)).toEqual([540, 600]);
    expect(calendar.slots[0]).toMatchObject({ id: retained.id, price: { priceCents: 6800 } });
    expect(calendar.slots[1].price).toBeUndefined();
    await expect(booking.createBooking({ date: '2035-01-01', courtId: court.id, slotId: early.id, sourceChannel: 'MINI_PROGRAM', creationIdempotencyKey: randomUUID() }, { ...admin, roles: ['MEMBER'] })).rejects.toThrow('场地或时段不存在');
    await expect(settings.save(command, admin)).rejects.toThrow('已被修改');
    expect((await db.courtBooking.findUniqueOrThrow({ where: { id: reserved.id } })).status).toBe('CONFIRMED');
    await updateCourt(db, court.id, { revision: court.updatedAt.toISOString(), name: '新名称', enabled: false }, admin);
    expect((await availability.availability('2035-01-01')).courts.some(c => c.id === court.id)).toBe(false);
    expect((await availability.availability('2035-01-01', true)).courts.find(c => c.id === court.id)).toMatchObject({ name: '新名称', enabled: false });
    expect(await db.auditLog.count({ where: { action: 'VENUE_SETTINGS_UPDATED', actorId: admin.sub } })).toBe(1);
    await expect(settings.createCourt({ code: court.code, name: '重复', zone: 'EAST', usage: 'RETAIL', enabled: true, sortOrder: 2 }, admin)).rejects.toThrow('已存在');
  });
  it('edits court metadata and deletes without cancelling orders, including retry and stale client protection', async () => {
    const court = await settings.createCourt({ code: 'DELETE_TEST', name: '可删除场地', zone: 'EAST', usage: 'RETAIL', enabled: true, sortOrder: 2 }, admin);
    const order = await db.order.create({ data: { orderNo: 'COURT_DELETE_' + randomUUID(), businessType: 'VENUE', memberId: admin.sub, subjectAccount: 'VENUE', sourceChannel: 'MINI_PROGRAM', title: '场地订单', parameterSnapshot: {}, listAmountCents: 6800, payableCents: 6800, paidCents: 6800, status: 'PAID' } });
    const reserved = await db.courtBooking.create({ data: { courtId: court.id, orderId: order.id, status: 'CONFIRMED', startsAt: new Date('2035-01-02T01:00:00Z'), endsAt: new Date('2035-01-02T02:00:00Z') } });
    const changed = await updateCourt(db, court.id, { revision: court.updatedAt.toISOString(), code: 'DELETE_CHANGED', name: '已编辑场地', zone: 'WEST', sortOrder: 8 }, admin);
    expect(changed).toMatchObject({ code: 'DELETE_CHANGED', name: '已编辑场地', zone: 'WEST', sortOrder: 8 });
    await expect(updateCourt(db, court.id, { revision: changed.updatedAt.toISOString(), code: 'SETTINGS_TEST' }, admin)).rejects.toThrow('已存在');
    await expect(settings.deleteCourt(court.id, { ...admin, roles: ['FRONT_DESK'] })).rejects.toThrow('仅管理员');
    await expect(updateCourt(db, court.id, { revision: changed.updatedAt.toISOString(), name: '越权修改' }, { ...admin, roles: ['MEMBER'] })).rejects.toThrow('仅管理员');
    expect((await settings.settings(admin)).courts.some(c => c.id === court.id)).toBe(true);
    await settings.deleteCourt(court.id, admin);
    await settings.deleteCourt(court.id, admin);
    expect((await settings.settings(admin)).courts.some(c => c.id === court.id)).toBe(false);
    for (const assisted of [false, true]) expect((await availability.availability('2035-01-02', assisted)).courts.some(c => c.id === court.id)).toBe(false);
    expect((await db.courtBooking.findUniqueOrThrow({ where: { id: reserved.id }, include: { order: true } }))).toMatchObject({ status: 'CONFIRMED', order: { status: 'PAID', paidCents: 6800 } });
    await expect(updateCourt(db, court.id, { revision: changed.updatedAt.toISOString(), enabled: true }, admin)).rejects.toThrow('已删除');
    const slot = await db.timeSlot.findFirstOrThrow({ where: { enabled: true } });
    const member = await db.user.create({ data: { displayName: '订场会员', memberProfile: { create: {} } } });
    for (const overrideReason of [undefined, '管理员特殊代订']) {
      await expect(booking.createBooking({ date: '2035-01-03', courtId: court.id, slotId: slot.id, memberId: member.id, sourceChannel: 'MINI_PROGRAM', creationIdempotencyKey: randomUUID(), overrideReason }, admin)).rejects.toThrow('场地或时段不存在');
    }
    expect(await db.auditLog.count({ where: { action: 'COURT_DELETED', objectId: court.id } })).toBe(1);
  });
  it('rejects non-admin access and invalid hours or coordinate pairs', async () => {
    await expect(settings.settings({ ...admin, roles: ['FRONT_DESK'] })).rejects.toThrow('仅管理员');
    const before = await settings.settings(admin);
    const dto = { revision: before.revision, name: '测试球馆', address: '', contactPhone: '', opensAtHour: 12, closesAtHour: 10 };
    await expect(settings.save(dto, admin)).rejects.toThrow('结束时间');
    await expect(settings.save({ ...dto, closesAtHour: 22, latitude: 40 }, admin)).rejects.toThrow('经纬度');
    expect((await settings.settings(admin)).revision).toBe(before.revision);
  });
});
