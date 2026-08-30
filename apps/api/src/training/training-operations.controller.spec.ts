import 'reflect-metadata'

import { describe, expect, it, vi } from 'vitest'

import { ROLES_KEY } from '../common/auth/auth.decorators.js'
import type { AuthUser } from '../common/auth/auth-user.js'
import { AppRole } from '../generated/prisma/enums.js'
import {
  TrainingTrialsController,
  YouthTrainingRulesController,
} from './training-operations.controller.js'

const actor: AuthUser = {
  sub: 'admin-1',
  displayName: '培训管理员',
  roles: [AppRole.ADMIN],
}

describe('training operations controller boundaries', () => {
  it('forwards member/guardian self-service scope without accepting a caller-supplied user id', async () => {
    const trials = { list: vi.fn().mockResolvedValue([]) }
    const controller = new TrainingTrialsController(trials as never)
    await expect(controller.mine({}, actor)).resolves.toEqual([])
    expect(trials.list).toHaveBeenCalledWith({}, actor, true)
  })

  it('keeps trial transitions on explicit role-scoped commands', () => {
    expect(
      Reflect.getMetadata(ROLES_KEY, TrainingTrialsController.prototype.create),
    ).toEqual([AppRole.FRONT_DESK, AppRole.ADMIN, AppRole.SUPER_ADMIN])
    expect(
      Reflect.getMetadata(ROLES_KEY, TrainingTrialsController.prototype.assess),
    ).toEqual([AppRole.COACH, AppRole.ADMIN, AppRole.SUPER_ADMIN])
    expect(
      Reflect.getMetadata(ROLES_KEY, TrainingTrialsController.prototype.convert),
    ).toEqual([AppRole.ADMIN, AppRole.SUPER_ADMIN])
  })

  it('passes the actor into the service-level rule list authorization', async () => {
    const rules = { list: vi.fn().mockResolvedValue([]) }
    const controller = new YouthTrainingRulesController(rules as never)
    await expect(controller.list({}, actor)).resolves.toEqual([])
    expect(rules.list).toHaveBeenCalledWith({}, actor)
    expect(
      Reflect.getMetadata(ROLES_KEY, YouthTrainingRulesController.prototype.create),
    ).toEqual([AppRole.ADMIN])
    expect(
      Reflect.getMetadata(ROLES_KEY, YouthTrainingRulesController.prototype.publish),
    ).toEqual([AppRole.SUPER_ADMIN])
  })
})
