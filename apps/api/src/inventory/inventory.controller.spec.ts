import 'reflect-metadata';

import { describe, expect, it } from 'vitest';

import { ROLES_KEY } from '../common/auth/auth.decorators.js';
import { AppRole } from '../generated/prisma/enums.js';
import { InventoryController } from './inventory.controller.js';

describe('InventoryController permissions', () => {
  it('keeps the full inventory controller administrator-only', () => {
    expect(Reflect.getMetadata(ROLES_KEY, InventoryController)).toEqual([
      AppRole.ADMIN,
      AppRole.SUPER_ADMIN,
    ]);
  });

  it('overrides only low-stock and award options with narrow role lists', () => {
    expect(
      Reflect.getMetadata(ROLES_KEY, InventoryController.prototype.lowStock),
    ).toEqual([AppRole.FRONT_DESK, AppRole.ADMIN, AppRole.SUPER_ADMIN]);
    expect(
      Reflect.getMetadata(
        ROLES_KEY,
        InventoryController.prototype.awardOptions,
      ),
    ).toEqual([
      AppRole.FRONT_DESK,
      AppRole.EVENT_MANAGER,
      AppRole.ADMIN,
      AppRole.SUPER_ADMIN,
    ]);
  });
});
