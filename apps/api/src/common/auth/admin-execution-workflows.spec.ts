import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemberAccountsService } from '../../members/accounts/members-accounts.service.js';
import { TrainingCorrectionsService } from '../../training/corrections/training-corrections.service.js';
import { InventoryStocktakingService } from '../../inventory/stocktaking/inventory-operations-stocktaking.service.js';
import * as accounts from '../../members/accounts/members-accounts.commands.js';
import * as corrections from '../../training/corrections/training-consume-corrections.js';
import * as stocktaking from '../../inventory/stocktaking/inventory-operations-stocktaking.commands.js';
import type { AuthUser } from './auth-user.js';
vi.mock('../../members/accounts/members-accounts.commands.js');
vi.mock('../../training/corrections/training-consume-corrections.js');
vi.mock(
  '../../inventory/stocktaking/inventory-operations-stocktaking.commands.js',
);
const actor = (role: string) =>
  ({ sub: 'operator', roles: [role], displayName: '操作人' }) as AuthUser;
const prisma = {} as never;
beforeEach(() => vi.resetAllMocks());
describe('administrator workflow composition', () => {
  it.each(['ADMIN', 'SUPER_ADMIN'])(
    '%s resumes an account adjustment after posting failure without creating another request',
    async (role) => {
      const request = { id: 'adjustment', status: 'REQUESTED' };
      vi.mocked(accounts.adjustAccount).mockResolvedValue(request as never);
      vi.mocked(accounts.approveAccountAdjustment)
        .mockRejectedValueOnce(new Error('retry'))
        .mockResolvedValueOnce({ ...request, status: 'POSTED' } as never);
      const service = new MemberAccountsService(prisma);
      const dto = { reason: '凭证一致', idempotencyKey: 'original' } as never;
      await expect(
        service.adjustAccount('member', dto, actor(role)),
      ).rejects.toThrow('retry');
      await expect(
        service.adjustAccount('member', dto, actor(role)),
      ).resolves.toMatchObject({ id: request.id, status: 'POSTED' });
      expect(accounts.approveAccountAdjustment).toHaveBeenCalledTimes(2);
      for (const call of vi.mocked(accounts.approveAccountAdjustment).mock
        .calls)
        expect(call[1]).toBe(request.id);
      request.status = 'POSTED';
      await service.adjustAccount('member', dto, actor(role));
      expect(accounts.approveAccountAdjustment).toHaveBeenCalledTimes(2);
    },
  );
  it('keeps finance account adjustments as applications', async () => {
    vi.mocked(accounts.adjustAccount).mockResolvedValue({
      id: 'a',
      status: 'REQUESTED',
    } as never);
    await new MemberAccountsService(prisma).adjustAccount(
      'member',
      {} as never,
      actor('FINANCE'),
    );
    expect(accounts.approveAccountAdjustment).not.toHaveBeenCalled();
  });
  it.each(['ADMIN', 'SUPER_ADMIN'])(
    '%s executes a correction using a stable recovery key',
    async (role) => {
      vi.mocked(corrections.requestConsumeCorrection).mockResolvedValue({
        id: 'c',
        status: 'REQUESTED',
      } as never);
      vi.mocked(corrections.approveConsumeCorrection)
        .mockRejectedValueOnce(new Error('retry'))
        .mockResolvedValueOnce({ id: 'c', status: 'APPROVED' } as never);
      const service = new TrainingCorrectionsService(prisma);
      const dto = {
        reason: '误消课纠正',
        idempotencyKey: 'correction-key',
      } as never;
      await expect(
        service.requestConsumeCorrection(dto, actor(role)),
      ).rejects.toThrow('retry');
      await expect(
        service.requestConsumeCorrection(dto, actor(role)),
      ).resolves.toMatchObject({ status: 'APPROVED' });
      expect(
        vi.mocked(corrections.approveConsumeCorrection).mock.calls[0][2],
      ).toEqual(
        vi.mocked(corrections.approveConsumeCorrection).mock.calls[1][2],
      );
    },
  );
  it('retains coach correction applications', async () => {
    vi.mocked(corrections.requestConsumeCorrection).mockResolvedValue({
      id: 'c',
      status: 'REQUESTED',
    } as never);
    await new TrainingCorrectionsService(prisma).requestConsumeCorrection(
      {} as never,
      actor('COACH'),
    );
    expect(corrections.approveConsumeCorrection).not.toHaveBeenCalled();
  });
  it.each(['ADMIN', 'SUPER_ADMIN'])(
    '%s submits and posts a counted stocktake; posted replay has no new mutation',
    async (role) => {
      vi.mocked(stocktaking.submitStocktake)
        .mockResolvedValueOnce({ status: 'REVIEW' } as never)
        .mockResolvedValueOnce({ status: 'POSTED' } as never);
      vi.mocked(stocktaking.postStocktake).mockResolvedValue({
        status: 'POSTED',
      } as never);
      const service = new InventoryStocktakingService(prisma);
      await expect(
        service.submitStocktake('s', actor(role)),
      ).resolves.toMatchObject({ status: 'POSTED' });
      await service.submitStocktake('s', actor(role));
      expect(stocktaking.postStocktake).toHaveBeenCalledOnce();
    },
  );
});
