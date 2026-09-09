import { describe, expect, it, vi } from 'vitest';
import { OrdersService } from '../../test/support/orders-fixture.js';
import { AppRole } from '../generated/prisma/enums.js';

describe('order detail visibility', () => {
  it.each([AppRole.MEMBER, AppRole.SUPER_ADMIN])(
    'returns 404 for an unavailable order queried by %s',
    async (role) => {
      const findFirst = vi.fn().mockResolvedValue(null);
      const service = new OrdersService(
        { order: { findFirst } } as never,
        {} as never,
        {} as never,
        {} as never,
      );
      await expect(
        service.detail('unavailable-order', {
          sub: 'member-1',
          roles: [role],
          displayName: '测试',
        }),
      ).rejects.toMatchObject({ status: 404, message: '订单不存在' });
      expect(findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where:
            role === AppRole.MEMBER
              ? { id: 'unavailable-order', memberId: 'member-1' }
              : { id: 'unavailable-order' },
        }),
      );
    },
  );
});
