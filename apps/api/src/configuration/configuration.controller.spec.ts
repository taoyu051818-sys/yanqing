import { describe, expect, it } from 'vitest'

import { ROLES_KEY } from '../common/auth/auth.decorators.js'
import { AppRole } from '../generated/prisma/enums.js'
import { ConfigurationController } from './configuration.controller.js'

describe('ConfigurationController permissions', () => {
  it('does not expose the internal parameter catalogue to finance', () => {
    expect(Reflect.getMetadata(ROLES_KEY, ConfigurationController.prototype.list)).toEqual([
      AppRole.ADMIN,
      AppRole.SUPER_ADMIN,
    ])
    expect(Reflect.getMetadata(ROLES_KEY, ConfigurationController.prototype.resolve)).toEqual([
      AppRole.ADMIN,
      AppRole.SUPER_ADMIN,
    ])
  })
})
