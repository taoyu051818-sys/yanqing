import { createHash, randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { PrismaService } from '../src/database/prisma.service.js';
import { BossService } from '../src/boss/boss.service.js';
import {
  BossBriefingService,
  briefingFacts,
  factualBriefing,
} from '../src/boss/briefing.service.js';

const url = process.env.TEST_DATABASE_URL;
describe.skipIf(!url)('owner exception visibility boundaries', () => {
  let db: PrismaService;
  let boss: BossService;
  beforeAll(async () => {
    const target = new URL(url!);
    if (
      target.hostname !== '127.0.0.1' ||
      target.pathname !== '/yanqing_boss_events_test'
    )
      throw new Error('Dedicated local boss events test database required');
    db = new PrismaService(new ConfigService({ DATABASE_URL: url }));
    await db.$connect();
  });
  beforeEach(async () => {
    await db.riskEvent.deleteMany();
    await db.bossBriefing.deleteMany();
    boss = new BossService(db, new ConfigService({ NODE_ENV: 'test' }));
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });
  afterAll(async () => {
    await db?.$disconnect();
  });

  it('includes the persisted recharge refund shortfall in the owner summary and AI facts', async () => {
    const shortfall = await db.riskEvent.create({
      data: {
        ruleCode: 'RECHARGE_REFUND_BALANCE_SHORTFALL',
        severity: 'HIGH',
        objectType: 'Refund',
        objectId: randomUUID(),
        summary: '微信退款已成功，充值账户余额不足，差额待追缴',
        evidence: {
          outstandingRecoveryCents: 100000,
          recoveryStatus: 'OUTSTANDING',
        },
      },
    });
    const control = await db.riskEvent.create({
      data: {
        ruleCode: 'BOSS_LATE_PAYMENT',
        severity: 'HIGH',
        objectType: 'Order',
        summary: '已取消订单收到付款',
      },
    });
    const result = await boss.summary();
    expect(await db.riskEvent.count()).toBe(2);
    expect(result.eventCount).toBe(2);
    expect(result.pendingEventCount).toBe(2);
    expect(result.handledEventCount).toBe(0);
    expect(result.events.map((event) => event.id)).toEqual(
      expect.arrayContaining([control.id, shortfall.id]),
    );
    expect(JSON.stringify(briefingFacts(result))).toContain(
      'RECHARGE_REFUND_BALANCE_SHORTFALL',
    );
  });

  async function handledBeforeOpen(count: number) {
    const now = new Date();
    const open = await db.riskEvent.create({
      data: {
        ruleCode: 'BOSS_PAYMENT_EXCEPTION',
        severity: 'HIGH',
        objectType: 'Payment',
        summary: '仍待核实的支付',
        status: 'OPEN',
        createdAt: new Date(+now - 1000),
      },
    });
    await db.riskEvent.createMany({
      data: Array.from({ length: count }, () => ({
        ruleCode: 'BOSS_PAYMENT_EXCEPTION',
        severity: 'HIGH' as const,
        objectType: 'Payment',
        summary: '已核实的支付',
        status: 'RESOLVED' as const,
        createdAt: now,
      })),
    });
    return open;
  }

  it('keeps an older open event ahead of 100 newer handled events', async () => {
    const open = await handledBeforeOpen(100);
    const result = await boss.summary();
    expect(result.eventCount).toBe(101);
    expect(result.eventsTruncated).toBe(true);
    expect(result.events).toHaveLength(100);
    expect(
      result.events
        .filter((event) => ['OPEN', 'REVIEWING'].includes(event.status))
        .map((event) => event.id),
    ).toEqual([open.id]);
    expect(result.events[0].id).toBe(open.id);
    expect(result.pendingEventCount).toBe(1);
    expect(result.handledEventCount).toBe(100);
    expect(factualBriefing(result)).toContain('请优先检查重要及紧急事件');
    const handled = await db.riskEvent.findFirstOrThrow({
      where: { status: 'RESOLVED' },
    });
    await db.riskEvent.delete({ where: { id: handled.id } });
    expect(
      (await boss.summary()).events.some((event) => event.id === open.id),
    ).toBe(true);
  });

  it('prioritizes the open event in AI input and reports the independent 30-event limit', async () => {
    const open = await handledBeforeOpen(30);
    const result = await boss.summary();
    expect(result.events.some((event) => event.id === open.id)).toBe(true);
    const facts = briefingFacts(result);
    expect(facts.eventCount).toBe(31);
    expect(result.eventsTruncated).toBe(false);
    expect(facts.eventsTruncated).toBe(true);
    expect(facts.events).toHaveLength(30);
    expect(facts.events[0].status).toBe('OPEN');
    expect(facts.pendingEventCount).toBe(1);
  });

  it('decorates cached AI text on scanner failure without another provider call, and clears the warning on recovery', async () => {
    await boss.scan();
    const summary = await boss.summary();
    const hash = createHash('sha256')
      .update(JSON.stringify({ ...briefingFacts(summary), monitor: undefined }))
      .digest('hex');
    await db.bossBriefing.create({
      data: {
        date: summary.date,
        text: '暂无需要跟进的异常',
        source: 'AI',
        model: 'test',
        summaryHash: hash,
        generatedAt: new Date(),
      },
    });
    vi.spyOn(boss, 'read').mockRejectedValueOnce(
      new Error('temporary scan failure'),
    );
    await boss.scan();
    expect((await boss.summary()).monitor.error).toContain('事件扫描失败');
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const service = new BossBriefingService(
      db,
      boss,
      new ConfigService({ BOSS_LLM_API_KEY: 'test-only' }),
    );
    const result = await service.generate();
    expect(result).toMatchObject({ source: 'AI', cached: true });
    expect(result.text).toContain('事件扫描失败');
    expect(result.warning).toContain('异常信息可能不完整');
    expect((await service.cached())?.text).toContain('事件扫描失败');
    expect(
      (
        await db.bossBriefing.findUniqueOrThrow({
          where: { date: summary.date },
        })
      ).text,
    ).toBe('暂无需要跟进的异常');
    expect(fetch).not.toHaveBeenCalled();
    await boss.scan();
    expect(await service.generate()).toMatchObject({
      cached: true,
      warning: null,
      text: '暂无需要跟进的异常',
    });
    expect((await service.cached())?.warning).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('keeps critical events under review ahead of lower-severity open events', async () => {
    await db.riskEvent.createMany({
      data: Array.from({ length: 100 }, () => ({
        ruleCode: 'BOSS_LARGE_ORDER',
        severity: 'LOW' as const,
        objectType: 'Order',
        summary: '大额订单',
      })),
    });
    const critical = await db.riskEvent.create({
      data: {
        ruleCode: 'BOSS_COURT_CONFLICT',
        severity: 'CRITICAL',
        status: 'REVIEWING',
        objectType: 'Court',
        summary: '场地冲突',
      },
    });
    const result = await boss.summary();
    expect(result.pendingEventCount).toBe(101);
    expect(result.handledEventCount).toBe(0);
    expect(result.events[0].id).toBe(critical.id);
    expect(result.eventsTruncated).toBe(true);
    expect(briefingFacts(result).events[0].severity).toBe('CRITICAL');
  });

  it.each(['cooldown', 'no-provider', 'provider-failed'] as const)(
    'includes the monitor warning in the %s factual fallback',
    async (mode) => {
      vi.spyOn(boss, 'read').mockRejectedValueOnce(new Error('scan failed'));
      await boss.scan();
      const summary = await boss.summary();
      if (mode === 'cooldown')
        await db.bossBriefing.create({
          data: {
            date: summary.date,
            text: '',
            source: 'PENDING',
            summaryHash: '',
            attemptedAt: new Date(),
            leaseUntil: new Date(Date.now() + 90000),
          },
        });
      const fetch = vi
        .fn()
        .mockRejectedValue(new Error('provider unavailable'));
      vi.stubGlobal('fetch', fetch);
      const service = new BossBriefingService(
        db,
        boss,
        new ConfigService(
          mode === 'no-provider' ? {} : { BOSS_LLM_API_KEY: 'test-only' },
        ),
      );
      const result = await service.generate();
      expect(result.source).toBe('FACTS');
      expect(result.text).toContain('异常信息可能不完整');
      expect(result.warning).toContain('事件扫描失败');
      expect(fetch).toHaveBeenCalledTimes(mode === 'provider-failed' ? 1 : 0);
    },
  );
});
