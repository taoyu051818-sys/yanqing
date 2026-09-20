import { describe, expect, it, vi } from 'vitest';
import { ActivityRefundExecutionService } from './activity-refund-execution.service.js';

function fixture(role = 'ADMIN', kind = 'GAME') {
  const job = {
    id: 'job',
    activityId: 'activity',
    actorId: 'operator',
    actorRoles: [role],
    reason: '场馆停电',
    attempts: 0,
    kind,
  };
  const prisma = {
    activityRefundJob: {
      findMany: vi.fn().mockResolvedValue([job]),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    refund: {
      findMany: vi.fn().mockResolvedValue([{ id: 'refund' }]),
      count: vi.fn().mockResolvedValue(0),
    },
  };
  const approveRefund = vi.fn().mockResolvedValue({ status: 'APPROVED' });
  return {
    prisma,
    approveRefund,
    service: new ActivityRefundExecutionService(
      prisma as never,
      { approveRefund } as never,
    ),
  };
}

describe('Activity refund worker lease and scheduling boundaries', () => {
  it.each(['GAME', 'EVENT'])(
    'scopes %s rows and bounds each database batch',
    async (kind) => {
      const f = fixture('ADMIN', kind);
      await f.service.sweep();
      expect(f.prisma.activityRefundJob.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 4 }),
      );
      expect(f.prisma.refund.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          take: 8,
          where: {
            cancellationRequired: true,
            status: 'REQUESTED',
            order:
              kind === 'GAME'
                ? { gameRegistration: { gameId: 'activity' } }
                : { eventTeam: { eventId: 'activity' } },
          },
        }),
      );
      expect(f.approveRefund).toHaveBeenCalledWith(
        'refund',
        expect.anything(),
        expect.objectContaining({ sub: 'operator', roles: ['ADMIN'] }),
      );
    },
  );
  it('does not submit when a competing worker owns the claim', async () => {
    const f = fixture();
    f.prisma.activityRefundJob.updateMany.mockResolvedValue({ count: 0 });
    expect(await f.service.sweep()).toBe(0);
    expect(f.approveRefund).not.toHaveBeenCalled();
  });
  it('stops before approving when the lease was replaced', async () => {
    const f = fixture();
    f.prisma.activityRefundJob.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });
    await f.service.sweep();
    expect(f.approveRefund).not.toHaveBeenCalled();
    expect(f.prisma.activityRefundJob.updateMany).toHaveBeenCalledTimes(2);
  });
  it.each(['HOST', 'EVENT_MANAGER', 'FINANCE', 'FRONT_DESK', 'MEMBER'])(
    'does not execute a persisted task without administrator authorization (%s)',
    async (role) => {
      const f = fixture(role);
      await f.service.sweep();
      expect(f.approveRefund).not.toHaveBeenCalled();
      expect(f.prisma.activityRefundJob.updateMany).toHaveBeenLastCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'QUEUED',
            lastError: expect.stringContaining('管理员授权'),
          }),
        }),
      );
    },
  );
  it('coalesces concurrent sweeps in one process', async () => {
    const f = fixture();
    const first = f.service.sweep(),
      second = f.service.sweep();
    expect(first).toBe(second);
    await first;
    expect(f.approveRefund).toHaveBeenCalledOnce();
  });
});
