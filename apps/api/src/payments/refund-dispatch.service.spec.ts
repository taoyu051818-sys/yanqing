import { afterEach, describe, expect, it, vi } from 'vitest';
import { RefundDispatchService } from './refund-dispatch.service.js';
import { dispatchWechatRefund } from './wechat/refund-dispatch.js';

vi.mock('./wechat/refund-dispatch.js', () => ({
  dispatchWechatRefund: vi.fn().mockResolvedValue({ status: 'PROCESSING' }),
}));
afterEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
});

function fixture(count = 1, provider = 'wechat') {
  const now = new Date('2026-09-12T00:00:00Z');
  const rows = Array.from({ length: count }, (_, i) => ({
    id: String(i).padStart(3, '0'),
    status: 'APPROVED',
    approvedAt: new Date(now.getTime() - 180 * 60_000),
  }));
  const findMany = vi.fn(async ({ where, take }) =>
    rows.filter((row) => !where.id || row.id > where.id.gt).slice(0, take),
  );
  const service = new RefundDispatchService(
    { refund: { findMany } } as never,
    { get: () => provider } as never,
    {} as never,
    {} as never,
  );
  return { service, findMany, now };
}

describe('durable refund retry scheduling', () => {
  it('never starts provider recovery in mock mode', async () => {
    const f = fixture(1, 'mock');
    f.service.onApplicationBootstrap();
    expect(await f.service.sweep(f.now)).toBe(0);
    expect(f.findMany).not.toHaveBeenCalled();
    expect(dispatchWechatRefund).not.toHaveBeenCalled();
  });

  it('shares overlapping sweeps so the same process does not double-dispatch', async () => {
    const f = fixture();
    let release!: () => void;
    vi.mocked(dispatchWechatRefund).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () => resolve({} as never);
        }),
    );
    const first = f.service.sweep(f.now);
    const second = f.service.sweep(f.now);
    expect(first).toBe(second);
    await vi.waitFor(() => expect(dispatchWechatRefund).toHaveBeenCalledOnce());
    release();
    expect(await first).toBe(1);
    expect(f.findMany).toHaveBeenCalledOnce();
  });

  it('visits later pages and retries old rows without epoch/modulo starvation', async () => {
    const f = fixture(51);
    for (let minute = 0; minute <= 35; minute++)
      await f.service.sweep(new Date(f.now.getTime() + minute * 60_000));
    const ids = vi
      .mocked(dispatchWechatRefund)
      .mock.calls.map((call) => call[3]);
    for (let index = 0; index < 51; index++)
      expect(
        ids.filter((id) => id === String(index).padStart(3, '0')),
      ).toHaveLength(2);
    expect(f.findMany.mock.calls[1][0].where.id).toEqual({ gt: '024' });
  });

  it('stops scheduled work on shutdown', async () => {
    vi.useFakeTimers();
    const f = fixture();
    f.service.onApplicationBootstrap();
    await f.service.sweep();
    expect(f.findMany).toHaveBeenCalledOnce();
    f.service.onModuleDestroy();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(f.findMany).toHaveBeenCalledOnce();
  });
});
