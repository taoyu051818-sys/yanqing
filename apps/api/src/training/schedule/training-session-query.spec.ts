import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { TrainingScheduleService } from './training-schedule.service.js';
import { TrainingSessionQueryDto } from './training-session-query.dto.js';
import { AppRole } from '../../generated/prisma/enums.js';
import type { AuthUser } from '../../common/auth/auth-user.js';
const actor = { sub: 'coach-1', roles: [AppRole.COACH] } as AuthUser;
const row = (id: string) => ({
  id,
  classId: 'class',
  startsAt: new Date('2026-09-26T02:00:00Z'),
  endsAt: new Date('2026-09-26T03:00:00Z'),
  class: {
    id: 'class',
    name: '测试班',
    product: { id: 'p', name: '课', audience: 'ALL' },
  },
  attendances: [],
});
function fixture() {
  const findMany = vi.fn().mockResolvedValue([]);
  const service = new TrainingScheduleService({
    trainingSession: { findMany },
    systemParameter: { findFirst: vi.fn().mockResolvedValue(null) },
  } as never);
  return { service, findMany };
}
describe('training session searches and details', () => {
  it('filters the Shanghai day and class name before pagination, preserving coach ownership', async () => {
    const f = fixture();
    await f.service.searchSessions(
      { page: 1, pageSize: 50, date: '2026-09-26', search: ' 羽毛球 ' },
      actor,
    );
    expect(f.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          AND: [
            {
              class: {
                OR: [{ coachId: 'coach-1' }, { assistantId: 'coach-1' }],
              },
            },
            {
              AND: [
                {
                  startsAt: {
                    gte: new Date('2026-09-25T16:00:00Z'),
                    lt: new Date('2026-09-26T16:00:00Z'),
                  },
                },
                {
                  class: { name: { contains: '羽毛球', mode: 'insensitive' } },
                },
              ],
            },
          ],
        },
        take: 51,
        skip: 0,
        orderBy: [{ startsAt: 'desc' }, { id: 'desc' }],
      }),
    );
  });
  it('allows traversing 101 records, with no hidden final page', async () => {
    const f = fixture();
    const rows = Array.from({ length: 101 }, (_, i) => row(String(i)));
    f.findMany.mockImplementation(async ({ skip, take }) =>
      rows.slice(skip, skip + take),
    );
    const pages = await Promise.all(
      [1, 2, 3].map((page) =>
        f.service.searchSessions({ page, pageSize: 50 }, actor),
      ),
    );
    expect(pages.map((page) => page.hasMore)).toEqual([true, true, false]);
    expect(
      new Set(pages.flatMap((page) => page.items.map((item) => item.id))).size,
    ).toBe(101);
  });
  it('resolves a session directly even outside a list page and keeps the ownership filter', async () => {
    const f = fixture();
    f.findMany.mockResolvedValue([row('older-than-100')]);
    expect((await f.service.getSession('older-than-100', actor)).id).toBe(
      'older-than-100',
    );
    expect(f.findMany.mock.calls[0][0].where.AND).toEqual([
      { class: { OR: [{ coachId: 'coach-1' }, { assistantId: 'coach-1' }] } },
      { id: 'older-than-100' },
    ]);
    f.findMany.mockResolvedValue([]);
    await expect(f.service.getSession('other-coach', actor)).rejects.toThrow(
      '无权查看',
    );
  });
  it('looks up an attendance deep link without relying on the enrollment or session list limit', async () => {
    const f = fixture();
    await f.service.searchSessions(
      { page: 1, pageSize: 50, attendanceId: 'att-old' },
      actor,
    );
    expect(f.findMany.mock.calls[0][0].where.AND[1]).toEqual({
      AND: [{ attendances: { some: { id: 'att-old' } } }],
    });
  });
  it('keeps the legacy list as an array', async () => {
    const f = fixture();
    f.findMany.mockResolvedValue([row('legacy')]);
    expect(await f.service.listSessions(actor)).toEqual([
      expect.objectContaining({ id: 'legacy' }),
    ]);
  });
  it('rejects invalid calendar dates, oversized pages and unbounded search input', async () => {
    for (const query of [
      { date: '2026-02-30' },
      { date: '2026-09-26T00:00:00Z' },
      { page: 0 },
      { pageSize: 101 },
      { search: 'a'.repeat(101) },
    ]) {
      expect(
        (await validate(plainToInstance(TrainingSessionQueryDto, query)))
          .length,
      ).toBeGreaterThan(0);
    }
    expect(
      await validate(
        plainToInstance(TrainingSessionQueryDto, {
          date: '2026-09-26',
          page: '2',
          pageSize: '50',
        }),
      ),
    ).toEqual([]);
  });
});
