import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/database/prisma.service.js';
import { applyVenuePrice } from '../src/venues/pricing/apply-venue-price.js';
import { resolvePrice } from '../src/venues/shared/venues-policy.js';
import type { AuthUser } from '../src/common/auth/auth-user.js';

const url = process.env.TEST_DATABASE_URL;
describe.skipIf(!url)('confirmed price changes on PostgreSQL', () => {
  let db: PrismaService, admin: AuthUser;
  beforeAll(async () => {
    const target = new URL(url!);
    if (
      !['localhost', '127.0.0.1'].includes(target.hostname) ||
      !target.pathname.endsWith('_test')
    )
      throw new Error('Local test database required');
    db = new PrismaService(new ConfigService({ DATABASE_URL: url }));
    await db.$connect();
    const user = await db.user.create({
      data: { displayName: '价格交互验收管理员', primaryRole: 'ADMIN' },
    });
    admin = { sub: user.id, displayName: user.displayName, roles: ['ADMIN'] };
  });
  afterAll(async () => {
    await db?.$disconnect();
  });
  async function fixture() {
    const slot = await db.timeSlot.create({
      data: {
        code: randomUUID().toUpperCase(),
        label: '18:00–19:00',
        startMinutes: 1080,
        endMinutes: 1140,
        period: 'PRIME',
        sortOrder: 1,
      },
    });
    const source = await db.priceRule.create({
      data: {
        code: randomUUID().toUpperCase(),
        name: '原晚场价',
        version: 1,
        timeSlotId: slot.id,
        weekdayMask: 127,
        priceCents: 6000,
        effectiveFrom: new Date('2027-01-01T00:00:00+08:00'),
        effectiveTo: new Date('2028-01-01T00:00:00+08:00'),
        enabled: true,
        createdById: admin.sub,
        creationIdempotencyKey: randomUUID(),
        creationCommandHash: 'a'.repeat(64),
      },
    });
    const dto = {
      sourceRuleId: source.id,
      sourceRevision: source.updatedAt.toISOString(),
      name: source.name,
      timeSlotId: slot.id,
      weekdayMask: 127,
      priceCents: 7000,
      effectiveFrom: '2027-02-01T00:00:00+08:00',
      effectiveTo: source.effectiveTo!.toISOString(),
      reason: '调整晚场价格',
      idempotencyKey: randomUUID(),
    };
    return { slot, source, dto };
  }
  it('keeps the old tariff before the chosen date, switches exactly at the boundary, and records both versions', async () => {
    const { slot, source, dto } = await fixture();
    const changed = await applyVenuePrice(db, dto, admin);
    expect(changed.enabled).toBe(true);
    expect(changed.version).toBe(2);
    expect(await resolvePrice(db, slot.id, '2027-01-31', 1080)).toMatchObject({
      priceCents: 6000,
    });
    expect(await resolvePrice(db, slot.id, '2027-02-01', 1080)).toMatchObject({
      priceCents: 7000,
    });
    expect(
      await db.priceRule.findUnique({ where: { id: source.id } }),
    ).toMatchObject({
      enabled: true,
      priceCents: 6000,
      effectiveTo: new Date(dto.effectiveFrom),
    });
    const audit = await db.auditLog.findFirst({
      where: { objectId: changed.id, action: 'PRICE_CHANGE_APPLIED' },
    });
    expect(audit?.oldValue).toMatchObject({ priceCents: 6000 });
  });
  it('replays a lost response once and rejects a changed command with the same key', async () => {
    const { dto } = await fixture();
    const first = await applyVenuePrice(db, dto, admin);
    expect((await applyVenuePrice(db, dto, admin)).id).toBe(first.id);
    expect(await db.priceRule.count({ where: { code: first.code } })).toBe(2);
    await expect(
      applyVenuePrice(db, { ...dto, priceCents: 8000 }, admin),
    ).rejects.toThrow('幂等键');
  });
  it('allows only one concurrent replacement from the same revision', async () => {
    const { source, dto } = await fixture();
    const results = await Promise.allSettled([
      applyVenuePrice(db, dto, admin),
      applyVenuePrice(
        db,
        { ...dto, priceCents: 8000, idempotencyKey: randomUUID() },
        admin,
      ),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await db.priceRule.count({ where: { code: source.code } })).toBe(2);
  });
  it('rejects competing schedules and changed scope without shortening the old price', async () => {
    const { source, dto } = await fixture();
    await expect(
      applyVenuePrice(db, { ...dto, weekdayMask: 62 }, admin),
    ).rejects.toThrow('保留原');
    await db.priceRule.create({
      data: {
        code: randomUUID().toUpperCase(),
        name: '已有预定价格',
        version: 1,
        timeSlotId: source.timeSlotId,
        weekdayMask: 127,
        priceCents: 5000,
        effectiveFrom: new Date(dto.effectiveFrom),
        enabled: true,
        createdById: admin.sub,
        creationIdempotencyKey: randomUUID(),
        creationCommandHash: 'b'.repeat(64),
      },
    });
    await expect(applyVenuePrice(db, dto, admin)).rejects.toThrow(
      '适用范围重叠',
    );
    expect(
      (await db.priceRule.findUnique({ where: { id: source.id } }))
        ?.effectiveTo,
    ).toEqual(source.effectiveTo);
  });
  it('rolls back both versions when writing the audit record fails', async () => {
    const { source, dto } = await fixture();
    const failing = {
      $transaction: (work: any, options: any) =>
        db.$transaction(
          (tx) =>
            work(
              new Proxy(tx, {
                get(target, key) {
                  if (key === 'auditLog')
                    return {
                      create: () => {
                        throw new Error('audit unavailable');
                      },
                    };
                  return Reflect.get(target, key);
                },
              }),
            ),
          options,
        ),
    } as unknown as PrismaService;
    await expect(applyVenuePrice(failing, dto, admin)).rejects.toThrow(
      'audit unavailable',
    );
    expect(await db.priceRule.count({ where: { code: source.code } })).toBe(1);
    expect(
      (await db.priceRule.findUnique({ where: { id: source.id } }))
        ?.effectiveTo,
    ).toEqual(source.effectiveTo);
  });
  it('replaces from the first day without keeping two active copies and preserves role checks', async () => {
    const { source, dto } = await fixture();
    await expect(
      applyVenuePrice(db, dto, { ...admin, roles: ['FRONT_DESK'] }),
    ).rejects.toThrow('仅管理员');
    const created = await applyVenuePrice(
      db,
      { ...dto, effectiveFrom: source.effectiveFrom.toISOString() },
      admin,
    );
    expect(created.enabled).toBe(true);
    expect(
      (await db.priceRule.findUnique({ where: { id: source.id } }))?.enabled,
    ).toBe(false);
  });
  it('creates an immediately enabled new schedule without a user-supplied code', async () => {
    const { source, dto } = await fixture();
    await db.priceRule.update({
      where: { id: source.id },
      data: { enabled: false },
    });
    const created = await applyVenuePrice(
      db,
      { ...dto, sourceRuleId: undefined, sourceRevision: undefined },
      admin,
    );
    expect(created).toMatchObject({ enabled: true, version: 1 });
    expect(created.code).toMatch(/^PRICE_[A-Z0-9]+$/);
  });
});
