import 'reflect-metadata';

import { describe, expect, it, vi } from 'vitest';

import { ROLES_KEY } from '../common/auth/auth.decorators.js';
import type { AuthUser } from '../common/auth/auth-user.js';
import { AppRole, UserStatus } from '../generated/prisma/enums.js';
import { GovernanceController } from './governance.controller.js';

const actor: AuthUser = {
  sub: 'super-1',
  displayName: '超级管理员',
  roles: [AppRole.SUPER_ADMIN],
};

describe('GovernanceController authorization metadata', () => {
  it('keeps global lists and writes behind their declared B-end roles', () => {
    expect(
      Reflect.getMetadata(ROLES_KEY, GovernanceController.prototype.users),
    ).toEqual([AppRole.ADMIN, AppRole.SUPER_ADMIN]);
    expect(
      Reflect.getMetadata(ROLES_KEY, GovernanceController.prototype.setRoles),
    ).toEqual([AppRole.SUPER_ADMIN]);
    expect(
      Reflect.getMetadata(ROLES_KEY, GovernanceController.prototype.setStatus),
    ).toEqual([AppRole.SUPER_ADMIN]);
    expect(
      Reflect.getMetadata(ROLES_KEY, GovernanceController.prototype.risks),
    ).toEqual([AppRole.FINANCE, AppRole.ADMIN, AppRole.SUPER_ADMIN]);
    expect(
      Reflect.getMetadata(ROLES_KEY, GovernanceController.prototype.reviewRisk),
    ).toEqual([AppRole.FINANCE, AppRole.ADMIN, AppRole.SUPER_ADMIN]);
    expect(
      Reflect.getMetadata(
        ROLES_KEY,
        GovernanceController.prototype.resolveRisk,
      ),
    ).toEqual([AppRole.ADMIN, AppRole.SUPER_ADMIN]);
    expect(
      Reflect.getMetadata(
        ROLES_KEY,
        GovernanceController.prototype.dismissRisk,
      ),
    ).toEqual([AppRole.ADMIN, AppRole.SUPER_ADMIN]);
  });
});

describe('GovernanceController delegation', () => {
  it('passes ids, immutable command bodies and the full authenticated actor unchanged', async () => {
    const governance = {
      users: vi.fn().mockResolvedValue({ items: [] }),
      setUserRoles: vi.fn().mockResolvedValue({ id: 'user-1' }),
      setUserStatus: vi.fn().mockResolvedValue({ id: 'user-1' }),
      riskEvents: vi.fn().mockResolvedValue({ items: [] }),
      transitionRisk: vi.fn().mockResolvedValue({ id: 'risk-1' }),
    };
    const controller = new GovernanceController(governance as never);
    const userQuery = { page: 1, pageSize: 20 };
    const roles = {
      roles: [AppRole.MEMBER, AppRole.FRONT_DESK],
      primaryRole: AppRole.FRONT_DESK,
      reason: '前台员工入职',
      idempotencyKey: 'governance-role-1',
    };
    const status = {
      status: UserStatus.DISABLED,
      reason: '员工离职停用',
      idempotencyKey: 'governance-status-1',
    };
    const riskQuery = { page: 1, pageSize: 20 };
    const review = {
      reason: '核对风险证据',
      idempotencyKey: 'governance-risk-1',
    };

    await controller.users(userQuery, actor);
    await controller.setRoles('user-1', roles, actor);
    await controller.setStatus('user-1', status, actor);
    await controller.risks(riskQuery, actor);
    await controller.reviewRisk('risk-1', review, actor);
    await controller.resolveRisk('risk-1', review, actor);
    await controller.dismissRisk('risk-1', review, actor);

    expect(governance.users).toHaveBeenCalledWith(userQuery, actor);
    expect(governance.setUserRoles).toHaveBeenCalledWith(
      'user-1',
      roles,
      actor,
    );
    expect(governance.setUserStatus).toHaveBeenCalledWith(
      'user-1',
      status,
      actor,
    );
    expect(governance.riskEvents).toHaveBeenCalledWith(riskQuery, actor);
    expect(governance.transitionRisk).toHaveBeenNthCalledWith(
      1,
      'risk-1',
      'REVIEW',
      review,
      actor,
    );
    expect(governance.transitionRisk).toHaveBeenNthCalledWith(
      2,
      'risk-1',
      'RESOLVE',
      review,
      actor,
    );
    expect(governance.transitionRisk).toHaveBeenNthCalledWith(
      3,
      'risk-1',
      'DISMISS',
      review,
      actor,
    );
  });
});
