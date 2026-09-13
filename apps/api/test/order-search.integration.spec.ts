import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/database/prisma.service.js';
import { list } from '../src/orders/queries/orders-queries.commands.js';
import { OrderQueryDto } from '../src/orders/orders.dto.js';
import type { AuthUser } from '../src/common/auth/auth-user.js';

const url = process.env.TEST_DATABASE_URL;
describe.skipIf(!url)('order keyword search and scope (PostgreSQL)', () => {
  let db: PrismaService;
  let actor: AuthUser;
  const keyword = `search-${randomUUID()}`;
  const orderIds = [randomUUID(), randomUUID(), randomUUID()];
  beforeAll(async () => {
    const target = new URL(url!);
    if (
      !['localhost', '127.0.0.1'].includes(target.hostname) ||
      !target.pathname.endsWith('_test')
    )
      throw new Error('Only an explicit local *_test database is allowed');
    db = new PrismaService(new ConfigService({ DATABASE_URL: url }));
    await db.$connect();
    const owner = await db.user.create({
      data: { displayName: '订单搜索会员' },
    });
    const other = await db.user.create({ data: { displayName: keyword } });
    actor = { sub: owner.id, roles: ['MEMBER'] } as AuthUser;
    await db.order.createMany({
      data: [
        {
          orderNo: `${keyword}-1`,
          memberId: owner.id,
          title: '订单号匹配',
          status: 'PENDING' as const,
        },
        {
          orderNo: randomUUID(),
          memberId: owner.id,
          title: keyword,
          status: 'PAID' as const,
        },
        {
          orderNo: randomUUID(),
          memberId: other.id,
          title: '会员名称匹配',
          status: 'PAID' as const,
        },
      ].map((row, index) => ({
        ...row,
        id: orderIds[index],
        businessType: 'VENUE' as const,
        subjectAccount: 'VENUE' as const,
        sourceChannel: 'MINI_PROGRAM' as const,
        listAmountCents: 100,
        payableCents: 100,
        parameterSnapshot: {},
        createdAt: new Date(`2010-01-0${index + 1}T00:00:00Z`),
      })),
    });
  });
  afterAll(async () => {
    await db?.$disconnect();
  });
  const query = (page: number, pageSize: number) =>
    Object.assign(new OrderQueryDto(), {
      keyword: keyword.toUpperCase(),
      page,
      pageSize,
    });
  it('search never expands a member scope and intersects the selected status', async () => {
    const result = await list(db, actor, query(1, 20));
    expect(result.total).toBe(2);
    expect(result.items.map(item => item.id).sort()).toEqual(orderIds.slice(0, 2).sort());
    const paid = await list(
      db,
      actor,
      Object.assign(query(1, 20), { status: 'PAID' as const }),
    );
    expect(paid.total).toBe(1);
    expect(paid.items[0].status).toBe('PAID');
  });
  it('staff searches order number, title and member name across stable pages', async () => {
    const first = await list(db, actor, query(1, 2), true);
    const second = await list(db, actor, query(2, 2), true);
    expect(first.total).toBe(3);
    expect(second.total).toBe(3);
    expect(first.items).toHaveLength(2);
    expect(second.items).toHaveLength(1);
    expect(
      new Set([...first.items, ...second.items].map((item) => item.id)).size,
    ).toBe(3);
  });
});
