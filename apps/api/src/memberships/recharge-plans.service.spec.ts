import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common'
import { describe, expect, it, vi } from 'vitest'

import type { AuthUser } from '../common/auth/auth-user.js'
import { AppRole } from '../generated/prisma/enums.js'
import { MembershipsService } from './memberships.service.js'

const admin: AuthUser = {
  sub: 'admin-recharge-plan',
  displayName: '充值计划管理员',
  roles: [AppRole.ADMIN],
}
const member: AuthUser = {
  sub: 'member-recharge-plan',
  displayName: '普通会员',
  roles: [AppRole.MEMBER],
}

const createPlanDto = (overrides: Record<string, unknown> = {}) => ({
  code: 'RECHARGE_500',
  name: '充值500元赠25元',
  principalCents: 50_000,
  giftCents: 2_500,
  effectiveFrom: '2026-01-01T00:00:00.000Z',
  effectiveTo: '2099-01-01T00:00:00.000Z',
  reason: '新增标准充值档位',
  idempotencyKey: 'recharge-plan-create-1',
  ...overrides,
})

describe('MembershipsService recharge plan governance', () => {
  it('rejects a gift larger than principal before touching storage', async () => {
    const prisma = { $transaction: vi.fn() }
    const service = new MembershipsService(prisma as never)

    await expect(service.createRechargePlan(createPlanDto({
      principalCents: 100,
      giftCents: 101,
    }), admin)).rejects.toBeInstanceOf(BadRequestException)
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })

  it('defends plan administration in the service layer', async () => {
    const prisma = { rechargePlan: { findMany: vi.fn() } }
    const service = new MembershipsService(prisma as never)

    expect(() => service.manageRechargePlans(member)).toThrow(ForbiddenException)
    await expect(service.createRechargePlan(createPlanDto(), member))
      .rejects.toBeInstanceOf(ForbiddenException)
    expect(prisma.rechargePlan.findMany).not.toHaveBeenCalled()
  })

  it('creates an immutable disabled version once and audits without the key', async () => {
    let stored: any = null
    const auditCreate = vi.fn().mockResolvedValue({})
    const tx = {
      rechargePlan: {
        findUnique: vi.fn(async () => stored),
        aggregate: vi.fn().mockResolvedValue({ _max: { version: 1 } }),
        create: vi.fn(async ({ data }: any) => {
          stored = {
            id: 'recharge-plan-v2',
            ...data,
            createdAt: new Date(),
            updatedAt: new Date(),
          }
          return stored
        }),
      },
      auditLog: { create: auditCreate },
    }
    const prisma = {
      rechargePlan: { findUnique: vi.fn(async () => stored) },
      $transaction: vi.fn(async (work: (value: typeof tx) => unknown) => work(tx)),
    }
    const service = new MembershipsService(prisma as never)
    const dto = createPlanDto()

    const first = await service.createRechargePlan(dto, admin)
    const replay = await service.createRechargePlan(dto, admin)

    expect(first).toMatchObject({
      code: dto.code,
      version: 2,
      principalCents: dto.principalCents,
      giftCents: dto.giftCents,
      enabled: false,
      createdById: admin.sub,
    })
    expect(replay.id).toBe(first.id)
    expect(tx.rechargePlan.create).toHaveBeenCalledOnce()
    expect(auditCreate).toHaveBeenCalledOnce()
    expect(JSON.stringify(auditCreate.mock.calls[0][0])).not.toContain(dto.idempotencyKey)
  })

  it('does not allow disabling the final currently-effective plan', async () => {
    const plan = {
      id: 'only-active-plan',
      code: 'RECHARGE_100',
      version: 1,
      enabled: true,
      effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
      effectiveTo: new Date('2099-01-01T00:00:00.000Z'),
    }
    const tx = {
      rechargePlanTransition: { findUnique: vi.fn().mockResolvedValue(null) },
      rechargePlan: {
        findUnique: vi.fn().mockResolvedValue(plan),
        count: vi.fn().mockResolvedValue(0),
        updateMany: vi.fn(),
      },
    }
    const prisma = {
      rechargePlanTransition: { findUnique: vi.fn() },
      $transaction: vi.fn(async (work: (value: typeof tx) => unknown) => work(tx)),
    }
    const service = new MembershipsService(prisma as never)

    await expect(service.setRechargePlanStatus(plan.id, {
      enabled: false,
      reason: '临时停用该档位',
      idempotencyKey: 'recharge-plan-disable-last',
    }, admin)).rejects.toThrow('最后一个当前有效充值计划')
    expect(tx.rechargePlan.updateMany).not.toHaveBeenCalled()
  })

  it('rejects enabling an overlapping version of the same plan code', async () => {
    const plan = {
      id: 'overlapping-v2',
      code: 'RECHARGE_500',
      version: 2,
      enabled: false,
      effectiveFrom: new Date('2026-06-01T00:00:00.000Z'),
      effectiveTo: new Date('2027-06-01T00:00:00.000Z'),
    }
    const tx = {
      rechargePlanTransition: { findUnique: vi.fn().mockResolvedValue(null) },
      rechargePlan: {
        findUnique: vi.fn().mockResolvedValue(plan),
        findFirst: vi.fn().mockResolvedValue({ id: 'overlapping-v1', version: 1 }),
        updateMany: vi.fn(),
      },
    }
    const service = new MembershipsService({
      rechargePlanTransition: { findUnique: vi.fn() },
      $transaction: vi.fn(async (work: (value: typeof tx) => unknown) => work(tx)),
    } as never)

    await expect(service.setRechargePlanStatus(plan.id, {
      enabled: true,
      reason: '启用新版本',
      idempotencyKey: 'recharge-plan-enable-overlap',
    }, admin)).rejects.toThrow('有效期与当前版本重叠')
    expect(tx.rechargePlan.updateMany).not.toHaveBeenCalled()
  })

  it('persists one status transition and returns an exact replay', async () => {
    const plan: any = {
      id: 'future-plan',
      code: 'RECHARGE_1000',
      version: 1,
      enabled: false,
      effectiveFrom: new Date('2027-01-01T00:00:00.000Z'),
      effectiveTo: new Date('2028-01-01T00:00:00.000Z'),
    }
    let transition: any = null
    const tx = {
      rechargePlanTransition: {
        findUnique: vi.fn(async () => transition && ({ ...transition, plan })),
        create: vi.fn(async ({ data }: any) => {
          transition = { id: 'transition-1', ...data, createdAt: new Date() }
          return transition
        }),
      },
      rechargePlan: {
        findUnique: vi.fn().mockResolvedValue(plan),
        findFirst: vi.fn().mockResolvedValue(null),
        updateMany: vi.fn(async ({ data }: any) => {
          plan.enabled = data.enabled
          return { count: 1 }
        }),
      },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
    }
    const prisma = {
      rechargePlanTransition: {
        findUnique: vi.fn(async () => transition && ({ ...transition, plan })),
      },
      $transaction: vi.fn(async (work: (value: typeof tx) => unknown) => work(tx)),
    }
    const service = new MembershipsService(prisma as never)
    const command = {
      enabled: true,
      reason: '按计划启用新档位',
      idempotencyKey: 'recharge-plan-enable-future',
    }

    const first = await service.setRechargePlanStatus(plan.id, command, admin)
    const replay = await service.setRechargePlanStatus(plan.id, command, admin)

    expect(first).toMatchObject({ enabled: true, idempotent: false })
    expect(replay).toMatchObject({ enabled: true, idempotent: true })
    expect(replay.transition).not.toHaveProperty('idempotencyKey')
    expect(replay.transition).not.toHaveProperty('commandHash')
    expect(replay.transition).not.toHaveProperty('plan')
    expect(JSON.stringify(replay)).not.toContain('recharge-plan-enable-future')
    expect(tx.rechargePlan.updateMany).toHaveBeenCalledOnce()
    expect(tx.rechargePlanTransition.create).toHaveBeenCalledOnce()
    expect(tx.auditLog.create).toHaveBeenCalledOnce()
  })

  it('rejects a disabled or not-yet-effective plan without creating an order', async () => {
    const orderCreate = vi.fn()
    const tx = {
      rechargePlan: { findFirst: vi.fn().mockResolvedValue(null) },
      order: { create: orderCreate },
    }
    const prisma = {
      order: { findUnique: vi.fn().mockResolvedValue(null) },
      $transaction: vi.fn(async (work: (value: typeof tx) => unknown) => work(tx)),
    }
    const service = new MembershipsService(prisma as never)

    await expect(service.recharge({
      planId: 'disabled-plan',
      creationIdempotencyKey: 'disabled-plan-order-key',
    }, member)).rejects.toBeInstanceOf(NotFoundException)
    expect(orderCreate).not.toHaveBeenCalled()
  })
})
