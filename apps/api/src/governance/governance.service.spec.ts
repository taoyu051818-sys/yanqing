import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import type { AuthUser } from '../common/auth/auth-user.js';
import {
  AppRole,
  RiskSeverity,
  RiskStatus,
  UserStatus,
} from '../generated/prisma/enums.js';
import { GovernanceService } from './governance.service.js';

const superAdmin: AuthUser = {
  sub: 'super-1',
  displayName: '超级管理员',
  roles: [AppRole.SUPER_ADMIN],
};
const otherSuperAdmin: AuthUser = {
  sub: 'super-2',
  displayName: '复核超管',
  roles: [AppRole.SUPER_ADMIN],
};
const finance: AuthUser = {
  sub: 'finance-1',
  displayName: '财务',
  roles: [AppRole.FINANCE],
};
const merchantActor: AuthUser = {
  sub: 'merchant-user-1',
  displayName: '商户操作员',
  roles: [AppRole.MERCHANT],
};
const updatedAt = new Date('2099-01-01T00:00:00.000Z');

const baseUser = (overrides: Record<string, unknown> = {}) => ({
  id: 'member-1',
  displayName: '新员工',
  phone: '13800009999',
  status: UserStatus.ACTIVE,
  primaryRole: AppRole.MEMBER,
  openId: 'openid-bound',
  deletedAt: null,
  updatedAt,
  roles: [{ role: AppRole.MEMBER, merchantId: null }],
  ...overrides,
});

describe('GovernanceService permissions and sensitive responses', () => {
  it('enforces service-layer permissions for global user and risk lists', async () => {
    const service = new GovernanceService({} as never);
    await expect(
      service.users({ page: 1, pageSize: 20 }, finance),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      service.riskEvents({ page: 1, pageSize: 20 }, merchantActor),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('never returns raw WeChat identifiers and redacts secret evidence recursively', async () => {
    const user = {
      ...baseUser(),
      unionId: 'union-secret',
      createdAt: updatedAt,
      roles: [],
    };
    const risk = {
      id: 'risk-1',
      status: RiskStatus.OPEN,
      severity: RiskSeverity.HIGH,
      evidence: {
        refundNo: 'RF-1',
        accessToken: 'token-secret',
        nested: { openId: 'openid-secret', amountCents: 100 },
      },
    };
    const prisma = {
      user: {
        findMany: vi.fn().mockResolvedValue([user]),
        count: vi.fn().mockResolvedValue(1),
      },
      riskEvent: {
        findMany: vi.fn().mockResolvedValue([risk]),
        count: vi.fn().mockResolvedValue(1),
      },
      $transaction: vi.fn(async (operations: Promise<unknown>[]) =>
        Promise.all(operations),
      ),
    };
    const service = new GovernanceService(prisma as never);

    const users = await service.users({ page: 1, pageSize: 20 }, superAdmin);
    expect(users.items[0]).toMatchObject({
      wechatBound: true,
      unionBound: true,
    });
    expect(users.items[0]).not.toHaveProperty('openId');
    expect(users.items[0]).not.toHaveProperty('unionId');

    const risks = await service.riskEvents({ page: 1, pageSize: 20 }, finance);
    expect(risks.items[0].evidence).toEqual({
      refundNo: 'RF-1',
      accessToken: '[REDACTED]',
      nested: { openId: '[REDACTED]', amountCents: 100 },
    });
  });
});

describe('GovernanceService role governance', () => {
  it('does not allow a super admin to remove their own super-admin role', async () => {
    const service = new GovernanceService({} as never);
    await expect(
      service.setUserRoles(
        'super-1',
        {
          primaryRole: AppRole.MEMBER,
          roles: [AppRole.MEMBER],
          reason: '错误操作',
        },
        superAdmin,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('requires a merchant association when granting the merchant role', async () => {
    const service = new GovernanceService({} as never);
    await expect(
      service.setUserRoles(
        'member-1',
        {
          primaryRole: AppRole.MERCHANT,
          roles: [AppRole.MEMBER, AppRole.MERCHANT],
          reason: '商户员工入职',
        },
        superAdmin,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('validates the active merchant, CAS-locks the active target, replaces roles and audits in one transaction', async () => {
    const before = baseUser();
    const auditCreate = vi.fn().mockResolvedValue({});
    const deleteMany = vi.fn().mockResolvedValue({ count: 1 });
    const createMany = vi.fn().mockResolvedValue({ count: 2 });
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const merchantFind = vi
      .fn()
      .mockResolvedValue({ id: 'merchant-1', status: UserStatus.ACTIVE });
    const view = {
      ...before,
      primaryRole: AppRole.MERCHANT,
      roles: [
        { role: AppRole.MEMBER, merchantId: null, merchant: null },
        {
          role: AppRole.MERCHANT,
          merchantId: 'merchant-1',
          merchant: { id: 'merchant-1', name: '联盟商户' },
        },
      ],
    };
    const tx = {
      merchant: { findUnique: merchantFind },
      user: {
        findUnique: vi.fn().mockResolvedValue(before),
        updateMany,
        findUniqueOrThrow: vi.fn().mockResolvedValue(view),
        count: vi.fn(),
      },
      userRole: { deleteMany, createMany },
      auditLog: { create: auditCreate },
    };
    const prisma = {
      $transaction: vi.fn(async (work: (client: typeof tx) => unknown) =>
        work(tx),
      ),
    };
    const service = new GovernanceService(prisma as never);
    const result = await service.setUserRoles(
      'member-1',
      {
        primaryRole: AppRole.MERCHANT,
        roles: [AppRole.MEMBER, AppRole.MERCHANT],
        merchantId: ' merchant-1 ',
        reason: '联盟商户员工入职',
      },
      superAdmin,
    );

    expect(result).toMatchObject({
      id: 'member-1',
      primaryRole: AppRole.MERCHANT,
      wechatBound: true,
    });
    expect(result).not.toHaveProperty('openId');
    expect(merchantFind).toHaveBeenCalledWith({
      where: { id: 'merchant-1' },
      select: { id: true, status: true },
    });
    expect(updateMany).toHaveBeenCalledWith({
      where: {
        id: 'member-1',
        status: UserStatus.ACTIVE,
        deletedAt: null,
        updatedAt,
      },
      data: { primaryRole: AppRole.MERCHANT },
    });
    expect(deleteMany).toHaveBeenCalledOnce();
    expect(createMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        { userId: 'member-1', role: AppRole.MEMBER, merchantId: null },
        {
          userId: 'member-1',
          role: AppRole.MERCHANT,
          merchantId: 'merchant-1',
        },
      ]),
    });
    expect(auditCreate).toHaveBeenCalledOnce();
    expect(auditCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorId: superAdmin.sub,
        actorRole: AppRole.SUPER_ADMIN,
        action: 'USER_ROLES_SET',
        objectType: 'User',
        objectId: 'member-1',
        reason: '联盟商户员工入职',
      }),
    });
  });

  it('rejects inactive merchants inside the same transaction', async () => {
    const tx = {
      merchant: {
        findUnique: vi
          .fn()
          .mockResolvedValue({ id: 'merchant-1', status: UserStatus.DISABLED }),
      },
      auditLog: { create: vi.fn() },
    };
    const prisma = {
      $transaction: vi.fn(async (work: (client: typeof tx) => unknown) =>
        work(tx),
      ),
    };

    await expect(
      new GovernanceService(prisma as never).setUserRoles(
        'member-1',
        {
          primaryRole: AppRole.MERCHANT,
          roles: [AppRole.MEMBER, AppRole.MERCHANT],
          merchantId: 'merchant-1',
          reason: '商户员工入职',
        },
        superAdmin,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('keeps the last active super admin and maps a serialization race to a safe conflict', async () => {
    const lastSuper = baseUser({
      id: 'super-last',
      primaryRole: AppRole.SUPER_ADMIN,
      roles: [{ role: AppRole.SUPER_ADMIN, merchantId: null }],
    });
    const tx = {
      user: {
        findUnique: vi.fn().mockResolvedValue(lastSuper),
        count: vi.fn().mockResolvedValue(0),
        updateMany: vi.fn(),
      },
      userRole: { deleteMany: vi.fn(), createMany: vi.fn() },
      auditLog: { create: vi.fn() },
    };
    const prisma = {
      $transaction: vi.fn(async (work: (client: typeof tx) => unknown) =>
        work(tx),
      ),
    };
    await expect(
      new GovernanceService(prisma as never).setUserRoles(
        'super-last',
        {
          primaryRole: AppRole.ADMIN,
          roles: [AppRole.ADMIN],
          reason: '超管交接',
        },
        otherSuperAdmin,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(tx.user.updateMany).not.toHaveBeenCalled();

    const racing = new GovernanceService({
      $transaction: vi.fn().mockRejectedValue({ code: 'P2034' }),
    } as never);
    await expect(
      racing.setUserRoles(
        'super-last',
        {
          primaryRole: AppRole.ADMIN,
          roles: [AppRole.ADMIN],
          reason: '超管交接',
        },
        otherSuperAdmin,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('uses audit command evidence for exact keyed replay and rejects key reuse with another command', async () => {
    const before = baseUser();
    const view = {
      ...before,
      primaryRole: AppRole.FRONT_DESK,
      roles: [
        { role: AppRole.FRONT_DESK, merchantId: null, merchant: null },
        { role: AppRole.MEMBER, merchantId: null, merchant: null },
      ],
    };
    let replay: Record<string, unknown> | null = null;
    const auditCreate = vi.fn(
      async ({ data }: { data: Record<string, unknown> }) => {
        replay = {
          actorId: data.actorId,
          action: data.action,
          objectType: data.objectType,
          objectId: data.objectId,
          newValue: data.newValue,
        };
        return data;
      },
    );
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const tx = {
      user: {
        findUnique: vi.fn().mockResolvedValue(before),
        updateMany,
        findUniqueOrThrow: vi.fn().mockResolvedValue(view),
        count: vi.fn(),
      },
      userRole: {
        deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
        createMany: vi.fn().mockResolvedValue({ count: 2 }),
      },
      auditLog: {
        findFirst: vi.fn(async () => replay),
        create: auditCreate,
      },
    };
    const prisma = {
      $transaction: vi.fn(async (work: (client: typeof tx) => unknown) =>
        work(tx),
      ),
    };
    const service = new GovernanceService(prisma as never);
    const command = {
      primaryRole: AppRole.FRONT_DESK,
      roles: [AppRole.FRONT_DESK, AppRole.MEMBER],
      reason: '前台员工入职',
      idempotencyKey: 'governance-role-command-1',
    };

    await service.setUserRoles('member-1', command, superAdmin);
    await service.setUserRoles('member-1', command, superAdmin);
    expect(updateMany).toHaveBeenCalledOnce();
    expect(auditCreate).toHaveBeenCalledOnce();
    expect(auditCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        requestId: command.idempotencyKey,
        newValue: expect.objectContaining({ commandHash: expect.any(String) }),
      }),
    });

    await expect(
      service.setUserRoles(
        'member-1',
        {
          ...command,
          reason: '不同的变更原因',
        },
        superAdmin,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('GovernanceService user status and risk CAS', () => {
  it('uses a user updatedAt/status compare-and-set before the audited status change', async () => {
    const before = baseUser();
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const auditCreate = vi.fn().mockResolvedValue({});
    const tx = {
      user: {
        findUnique: vi.fn().mockResolvedValue(before),
        updateMany,
        findUniqueOrThrow: vi
          .fn()
          .mockResolvedValue({ ...before, status: UserStatus.DISABLED }),
        count: vi.fn(),
      },
      auditLog: { create: auditCreate },
    };
    const prisma = {
      $transaction: vi.fn(async (work: (client: typeof tx) => unknown) =>
        work(tx),
      ),
    };

    await new GovernanceService(prisma as never).setUserStatus(
      'member-1',
      {
        status: UserStatus.DISABLED,
        reason: '员工离职停用',
      },
      superAdmin,
    );
    expect(updateMany).toHaveBeenCalledWith({
      where: {
        id: 'member-1',
        status: UserStatus.ACTIVE,
        deletedAt: null,
        updatedAt,
      },
      data: { status: UserStatus.DISABLED },
    });
    expect(auditCreate).toHaveBeenCalledOnce();
  });

  it('lets finance review with CAS/audit, redacts returned evidence, and reserves terminal decisions for admins', async () => {
    const risk = {
      id: 'risk-1',
      status: RiskStatus.OPEN,
      evidence: { source: 'payment', authorization: 'Bearer secret' },
    };
    const auditCreate = vi.fn().mockResolvedValue({});
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const tx = {
      riskEvent: {
        findUnique: vi.fn().mockResolvedValue(risk),
        updateMany,
        findUniqueOrThrow: vi.fn().mockResolvedValue({
          ...risk,
          status: RiskStatus.REVIEWING,
        }),
      },
      auditLog: { create: auditCreate },
    };
    const prisma = {
      $transaction: vi.fn(async (work: (client: typeof tx) => unknown) =>
        work(tx),
      ),
    };
    const service = new GovernanceService(prisma as never);

    await expect(
      service.transitionRisk(
        'risk-1',
        'REVIEW',
        { reason: '核对支付证据' },
        finance,
      ),
    ).resolves.toMatchObject({
      status: RiskStatus.REVIEWING,
      evidence: { source: 'payment', authorization: '[REDACTED]' },
    });
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'risk-1', status: RiskStatus.OPEN },
      }),
    );
    expect(auditCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorId: finance.sub,
        actorRole: AppRole.FINANCE,
        action: `RISK_EVENT_${RiskStatus.REVIEWING}`,
        oldValue: { status: RiskStatus.OPEN },
        newValue: expect.objectContaining({ status: RiskStatus.REVIEWING }),
      }),
    });
    await expect(
      service.transitionRisk(
        'risk-1',
        'RESOLVE',
        { reason: '越权关闭' },
        finance,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('replays an exact keyed risk transition and rejects a key collision', async () => {
    let status: RiskStatus = RiskStatus.OPEN;
    let replay: Record<string, unknown> | null = null;
    const auditCreate = vi.fn(
      async ({ data }: { data: Record<string, unknown> }) => {
        replay = {
          actorId: data.actorId,
          action: data.action,
          objectType: data.objectType,
          objectId: data.objectId,
          newValue: data.newValue,
        };
        return data;
      },
    );
    const updateMany = vi.fn(async () => {
      status = RiskStatus.REVIEWING;
      return { count: 1 };
    });
    const tx = {
      riskEvent: {
        findUnique: vi.fn(async () => ({ id: 'risk-1', status, evidence: {} })),
        updateMany,
        findUniqueOrThrow: vi.fn(async () => ({
          id: 'risk-1',
          status,
          evidence: {},
        })),
      },
      auditLog: {
        findFirst: vi.fn(async () => replay),
        create: auditCreate,
      },
    };
    const prisma = {
      $transaction: vi.fn(async (work: (client: typeof tx) => unknown) =>
        work(tx),
      ),
    };
    const service = new GovernanceService(prisma as never);
    const command = {
      reason: '核对风险证据',
      idempotencyKey: 'governance-risk-command-1',
    };

    await service.transitionRisk('risk-1', 'REVIEW', command, finance);
    await service.transitionRisk('risk-1', 'REVIEW', command, finance);
    expect(updateMany).toHaveBeenCalledOnce();
    expect(auditCreate).toHaveBeenCalledOnce();

    await expect(
      service.transitionRisk(
        'risk-1',
        'REVIEW',
        {
          ...command,
          reason: '不同的复核原因',
        },
        finance,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
