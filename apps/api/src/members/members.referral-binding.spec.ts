import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import type { AuthUser } from '../common/auth/auth-user.js';
import { AppRole, UserStatus } from '../generated/prisma/enums.js';
import { MembersController } from './members.controller.js';
import { MembersService } from './members.service.js';

const member: AuthUser = {
  sub: 'member-1',
  displayName: '绑定会员',
  roles: [AppRole.MEMBER],
};
const activeMember = (id: string, referrerId: string | null = null) => ({
  id,
  referrerId,
  status: UserStatus.ACTIVE,
  deletedAt: null,
  memberProfile: { id: `profile-${id}` },
});

describe('MembersService direct referral binding', () => {
  it('derives the target from the authenticated actor and audits the immutable write in one transaction', async () => {
    const findUnique = vi
      .fn()
      .mockResolvedValueOnce(activeMember('member-1'))
      .mockResolvedValueOnce(activeMember('member-2'));
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const auditCreate = vi.fn().mockResolvedValue({});
    const tx = {
      user: { findUnique, updateMany },
      auditLog: { create: auditCreate },
    };
    const prisma = {
      $transaction: vi.fn(async (work: (client: typeof tx) => unknown) =>
        work(tx),
      ),
    };
    const service = new MembersService(prisma as never);

    await expect(
      service.bindReferral({ referrerId: 'member-2' }, member),
    ).resolves.toEqual({ id: 'member-1', referrerId: 'member-2' });
    expect(updateMany).toHaveBeenCalledWith({
      where: {
        id: 'member-1',
        referrerId: null,
        status: UserStatus.ACTIVE,
        deletedAt: null,
      },
      data: { referrerId: 'member-2' },
    });
    expect(auditCreate).toHaveBeenCalledOnce();
    expect(auditCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorId: member.sub,
        actorRole: AppRole.MEMBER,
        action: 'DIRECT_REFERRAL_BOUND',
        objectType: 'User',
        objectId: member.sub,
        oldValue: { referrerId: null },
        newValue: { referrerId: 'member-2' },
      }),
    });
  });

  it('replays the same binding without adding another audit record', async () => {
    const findUnique = vi
      .fn()
      .mockResolvedValueOnce(activeMember('member-1', 'member-2'))
      .mockResolvedValueOnce(activeMember('member-2'))
      .mockResolvedValueOnce({ id: 'member-1', referrerId: 'member-2' });
    const updateMany = vi.fn().mockResolvedValue({ count: 0 });
    const auditCreate = vi.fn();
    const tx = {
      user: { findUnique, updateMany },
      auditLog: { create: auditCreate },
    };
    const prisma = {
      $transaction: vi.fn(async (work: (client: typeof tx) => unknown) =>
        work(tx),
      ),
    };
    const service = new MembersService(prisma as never);

    await expect(
      service.bindReferral({ referrerId: 'member-2' }, member),
    ).resolves.toEqual({ id: 'member-1', referrerId: 'member-2' });
    expect(auditCreate).not.toHaveBeenCalled();
  });

  it('rejects inactive or non-member referrers before the conditional write', async () => {
    const updateMany = vi.fn();
    const tx = {
      user: {
        findUnique: vi
          .fn()
          .mockResolvedValueOnce(activeMember('member-1'))
          .mockResolvedValueOnce({
            ...activeMember('employee-2'),
            memberProfile: null,
          }),
        updateMany,
      },
      auditLog: { create: vi.fn() },
    };
    const prisma = {
      $transaction: vi.fn(async (work: (client: typeof tx) => unknown) =>
        work(tx),
      ),
    };

    await expect(
      new MembersService(prisma as never).bindReferral(
        { referrerId: 'employee-2' },
        member,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('rejects a referral cycle longer than two levels', async () => {
    const updateMany = vi.fn();
    const tx = {
      user: {
        findUnique: vi
          .fn()
          .mockResolvedValueOnce(activeMember('member-1'))
          .mockResolvedValueOnce(activeMember('member-2', 'member-3'))
          .mockResolvedValueOnce({ id: 'member-3', referrerId: 'member-1' })
          .mockResolvedValueOnce({ id: 'member-1', referrerId: null }),
        updateMany,
      },
      auditLog: { create: vi.fn() },
    };
    const prisma = {
      $transaction: vi.fn(async (work: (client: typeof tx) => unknown) =>
        work(tx),
      ),
    };

    await expect(
      new MembersService(prisma as never).bindReferral(
        { referrerId: 'member-2' },
        member,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('surfaces a different concurrent winner as an immutable-binding conflict', async () => {
    const tx = {
      user: {
        findUnique: vi
          .fn()
          .mockResolvedValueOnce(activeMember('member-1'))
          .mockResolvedValueOnce(activeMember('member-2'))
          .mockResolvedValueOnce({ id: 'member-1', referrerId: 'member-3' }),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
      auditLog: { create: vi.fn() },
    };
    const prisma = {
      $transaction: vi.fn(async (work: (client: typeof tx) => unknown) =>
        work(tx),
      ),
    };

    await expect(
      new MembersService(prisma as never).bindReferral(
        { referrerId: 'member-2' },
        member,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('recovers an exact serialization retry but rejects a different committed winner', async () => {
    const exactPrisma = {
      $transaction: vi.fn().mockRejectedValue({ code: 'P2034' }),
      user: {
        findUnique: vi
          .fn()
          .mockResolvedValue({ id: 'member-1', referrerId: 'member-2' }),
      },
    };
    await expect(
      new MembersService(exactPrisma as never).bindReferral(
        { referrerId: 'member-2' },
        member,
      ),
    ).resolves.toEqual({ id: 'member-1', referrerId: 'member-2' });

    const conflictPrisma = {
      $transaction: vi.fn().mockRejectedValue({ code: 'P2034' }),
      user: {
        findUnique: vi
          .fn()
          .mockResolvedValue({ id: 'member-1', referrerId: 'member-3' }),
      },
    };
    await expect(
      new MembersService(conflictPrisma as never).bindReferral(
        { referrerId: 'member-2' },
        member,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('MembersController direct referral binding', () => {
  it('delegates the command with the full authenticated actor and no caller-supplied target id', async () => {
    const members = {
      bindReferral: vi.fn().mockResolvedValue({ id: member.sub }),
    };
    const controller = new MembersController(members as never);
    const dto = { referrerId: 'member-2' };

    await controller.bindReferral(dto, member);

    expect(members.bindReferral).toHaveBeenCalledWith(dto, member);
  });
});
