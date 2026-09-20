import { beforeEach, expect, it, vi } from 'vitest';
import { OrderRefundRequestsService } from './orders-refund-requests.service.js';
import { requestRefund } from './orders-refund-requests.commands.js';
import { AppRole } from '../../generated/prisma/enums.js';
import type { AuthUser } from '../../common/auth/auth-user.js';
vi.mock('./orders-refund-requests.commands.js', () => ({ requestRefund: vi.fn() }));
const dto = { amountCents: 5000, reason: '会员取消预约', idempotencyKey: 'direct-refund-same-key' };
const actor = (role: AppRole): AuthUser => ({ sub:'operator', roles:[AppRole.MEMBER, role], displayName:'管理员' });
beforeEach(() => vi.resetAllMocks());
it.each([AppRole.ADMIN, AppRole.SUPER_ADMIN])('%s executes the request and original-channel refund in one command', async role => {
  vi.mocked(requestRefund).mockResolvedValue({id:'refund-a'} as never);
  const approveRefund = vi.fn().mockResolvedValue({id:'refund-a',status:'PROCESSING'});
  const service = new OrderRefundRequestsService({} as never, {approveRefund} as never);
  expect(await service.directRefund('order-a', dto, actor(role))).toEqual({id:'refund-a',status:'PROCESSING'});
  expect(requestRefund).toHaveBeenCalledWith(expect.anything(),'order-a',dto,actor(role));
  expect(approveRefund).toHaveBeenCalledWith('refund-a',{reason:dto.reason},actor(role));
});
it.each([AppRole.MEMBER, AppRole.FRONT_DESK, AppRole.FINANCE])('%s cannot call direct refund even without controller guards', async role => {
  const approveRefund = vi.fn();
  const service = new OrderRefundRequestsService({} as never,{approveRefund} as never);
  await expect(service.directRefund('order-a',dto,actor(role))).rejects.toThrow('仅管理员');
  expect(requestRefund).not.toHaveBeenCalled(); expect(approveRefund).not.toHaveBeenCalled();
});
it('resumes the durable request on retry after approval failed, preserving the same refund identity', async () => {
  vi.mocked(requestRefund).mockResolvedValue({id:'refund-a',status:'REQUESTED'} as never);
  const approveRefund=vi.fn().mockRejectedValueOnce(new Error('连接中断')).mockResolvedValue({id:'refund-a',status:'SUCCEEDED'});
  const service=new OrderRefundRequestsService({} as never,{approveRefund} as never);
  await expect(service.directRefund('order-a',dto,actor(AppRole.ADMIN))).rejects.toThrow('连接中断');
  expect(await service.directRefund('order-a',dto,actor(AppRole.ADMIN))).toMatchObject({status:'SUCCEEDED'});
  expect(approveRefund.mock.calls.map(call=>call[0])).toEqual(['refund-a','refund-a']);
  expect(vi.mocked(requestRefund).mock.calls.every(call=>call[2].idempotencyKey===dto.idempotencyKey)).toBe(true);
});
it('never approves when the refund amount or request state is rejected', async () => {
  vi.mocked(requestRefund).mockRejectedValue(new Error('退款金额超过可退金额'));
  const approveRefund=vi.fn();
  const service=new OrderRefundRequestsService({} as never,{approveRefund} as never);
  await expect(service.directRefund('order-a',dto,actor(AppRole.ADMIN))).rejects.toThrow('超过可退金额');
  expect(approveRefund).not.toHaveBeenCalled();
});
