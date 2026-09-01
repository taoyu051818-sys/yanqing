import 'reflect-metadata';

import { describe, expect, it, vi } from 'vitest';

import { ROLES_KEY } from '../common/auth/auth.decorators.js';
import type { AuthUser } from '../common/auth/auth-user.js';
import { AppRole } from '../generated/prisma/enums.js';
import { ReportsController } from './reports.controller.js';

describe('ReportsController', () => {
  it('keeps the route role-gated and forwards the actor for scope enforcement', async () => {
    expect(Reflect.getMetadata(ROLES_KEY, ReportsController)).toEqual([
      AppRole.FINANCE,
      AppRole.ADMIN,
      AppRole.SUPER_ADMIN,
    ]);
    const workbook = vi.fn().mockResolvedValue({
      filename: 'finance.xlsx',
      buffer: Buffer.from('xlsx'),
    });
    const setHeader = vi.fn();
    const send = vi.fn();
    const actor: AuthUser = {
      sub: 'finance-1',
      displayName: '财务',
      roles: [AppRole.FINANCE],
    };
    const controller = new ReportsController({ workbook } as never);

    await controller.export('finance', actor, { setHeader, send } as never);

    expect(workbook).toHaveBeenCalledWith('finance', actor);
    expect(setHeader).toHaveBeenCalledWith(
      'content-type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    expect(send).toHaveBeenCalledWith(Buffer.from('xlsx'));
  });
});
