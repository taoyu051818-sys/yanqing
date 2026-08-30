import { BadRequestException } from '@nestjs/common'
import { describe, expect, it, vi } from 'vitest'

import type { AuthUser } from '../common/auth/auth-user.js'
import { AppRole, ParameterType } from '../generated/prisma/enums.js'
import { ConfigurationService } from './configuration.service.js'

const actor: AuthUser = { sub: 'admin', displayName: 'Admin', roles: [AppRole.SUPER_ADMIN] }

describe('ConfigurationService contractual parameters', () => {
  const service = new ConfigurationService({} as never)

  it('does not allow any role to change the 20% training contract rate', async () => {
    await expect(service.createVersion({
      key: 'training.contract_rate_bps', value: 1_999, type: ParameterType.INTEGER,
      description: 'invalid', reason: '验证比例硬约束', effectiveFrom: '2027-01-01T00:00:00+08:00', locked: true,
    }, actor)).rejects.toBeInstanceOf(BadRequestException)
  })

  it('does not allow a training venue fee', async () => {
    await expect(service.createVersion({
      key: 'training.venue_fee_cents', value: 1, type: ParameterType.INTEGER,
      description: 'invalid', reason: '验证场地费硬约束', effectiveFrom: '2027-01-01T00:00:00+08:00', locked: true,
    }, actor)).rejects.toBeInstanceOf(BadRequestException)
  })

  it('locks valid training parameters when creating an effective-dated version', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'p1' })
    const transaction = vi.fn(async (work: (tx: any) => unknown) => work({
      systemParameter: { create },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
    }))
    const prisma = { systemParameter: { findFirst: vi.fn().mockResolvedValue(null) }, $transaction: transaction }
    const configured = new ConfigurationService(prisma as never)
    await configured.createVersion({
      key: 'training.contract_rate_bps', value: 2_000, type: ParameterType.INTEGER,
      description: 'locked contract', reason: '初始化合同计提比例', effectiveFrom: '2027-01-01T00:00:00+08:00', locked: false,
    }, actor)
    expect(transaction).toHaveBeenCalledOnce()
    expect(create.mock.calls[0][0].data.locked).toBe(true)
  })
})
