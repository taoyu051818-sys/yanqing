import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common'
import { describe, expect, it, vi } from 'vitest'

import type { AuthUser } from '../common/auth/auth-user.js'
import { AppRole, MemberLevel } from '../generated/prisma/enums.js'
import { MembershipsService } from './memberships.service.js'

const admin: AuthUser = {
  sub: 'admin-membership-product',
  displayName: '会员产品管理员',
  roles: [AppRole.ADMIN],
}
const frontDesk: AuthUser = {
  sub: 'front-membership-product',
  displayName: '会员前台',
  roles: [AppRole.FRONT_DESK],
}
const member: AuthUser = {
  sub: 'member-membership-product',
  displayName: '普通会员',
  roles: [AppRole.MEMBER],
}

const productDto = (overrides: Record<string, unknown> = {}) => ({
  code: 'MEMBER_GOLD_YEAR',
  name: '年度金卡',
  level: MemberLevel.GOLD,
  priceCents: 69_900,
  durationDays: 365,
  benefits: { bookingDays: 14, venueDiscountBps: 9_000 },
  effectiveFrom: '2027-01-01T00:00:00.000Z',
  effectiveTo: '2028-01-01T00:00:00.000Z',
  reason: '建立年度金卡标准版本',
  idempotencyKey: 'membership-product-create-v1',
  ...overrides,
})

describe('MembershipsService membership product governance', () => {
  it('exposes only currently effective enabled public products', async () => {
    const findMany = vi.fn().mockResolvedValue([])
    const service = new MembershipsService({
      membershipProduct: { findMany },
    } as never)

    await service.products()

    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        enabled: true,
        effectiveFrom: { lte: expect.any(Date) },
        OR: [{ effectiveTo: null }, { effectiveTo: { gt: expect.any(Date) } }],
      }),
      select: expect.objectContaining({ code: true, version: true, effectiveFrom: true }),
    }))
  })

  it('allows front desk read-only access but rejects product mutations', async () => {
    const findMany = vi.fn().mockResolvedValue([])
    const service = new MembershipsService({
      membershipProduct: { findMany },
      $transaction: vi.fn(),
    } as never)

    await expect(service.manageProducts(frontDesk)).resolves.toEqual([])
    await expect(service.createProduct(productDto(), frontDesk))
      .rejects.toBeInstanceOf(ForbiddenException)
    expect(findMany).toHaveBeenCalledOnce()
  })

  it('creates one immutable disabled v1 and returns an exact idempotent replay', async () => {
    let stored: any = null
    const auditCreate = vi.fn().mockResolvedValue({})
    const tx = {
      membershipProduct: {
        findUnique: vi.fn(async () => stored),
        aggregate: vi.fn().mockResolvedValue({ _max: { version: null } }),
        create: vi.fn(async ({ data }: any) => {
          stored = { id: 'membership-product-v1', ...data, createdAt: new Date(), updatedAt: new Date() }
          return stored
        }),
      },
      auditLog: { create: auditCreate },
    }
    const service = new MembershipsService({
      membershipProduct: { findUnique: vi.fn(async () => stored) },
      $transaction: vi.fn(async (work: (value: typeof tx) => unknown) => work(tx)),
    } as never)
    const dto = productDto()

    const first = await service.createProduct(dto, admin)
    const replay = await service.createProduct(dto, admin)

    expect(first).toMatchObject({
      code: dto.code,
      version: 1,
      enabled: false,
      createdById: admin.sub,
    })
    expect(replay.id).toBe(first.id)
    expect(replay).not.toHaveProperty('creationIdempotencyKey')
    expect(replay).not.toHaveProperty('creationCommandHash')
    expect(tx.membershipProduct.create).toHaveBeenCalledOnce()
    expect(auditCreate).toHaveBeenCalledOnce()
    expect(JSON.stringify(auditCreate.mock.calls[0][0])).not.toContain(dto.idempotencyKey)
  })

  it('requires the explicit version endpoint once a product code exists', async () => {
    const tx = {
      membershipProduct: {
        findUnique: vi.fn().mockResolvedValue(null),
        aggregate: vi.fn().mockResolvedValue({ _max: { version: 1 } }),
        create: vi.fn(),
      },
    }
    const service = new MembershipsService({
      membershipProduct: { findUnique: vi.fn() },
      $transaction: vi.fn(async (work: (value: typeof tx) => unknown) => work(tx)),
    } as never)

    await expect(service.createProduct(productDto(), admin))
      .rejects.toBeInstanceOf(ConflictException)
    expect(tx.membershipProduct.create).not.toHaveBeenCalled()
  })

  it('rejects enabling overlapping versions of the same product code', async () => {
    const product = {
      id: 'membership-product-v2',
      code: 'MEMBER_GOLD_YEAR',
      version: 2,
      enabled: false,
      effectiveFrom: new Date('2027-01-01T00:00:00.000Z'),
      effectiveTo: new Date('2028-01-01T00:00:00.000Z'),
    }
    const tx = {
      membershipProductTransition: { findUnique: vi.fn().mockResolvedValue(null) },
      membershipProduct: {
        findUnique: vi.fn().mockResolvedValue(product),
        findFirst: vi.fn().mockResolvedValue({ id: 'membership-product-v1', version: 1 }),
        updateMany: vi.fn(),
      },
    }
    const service = new MembershipsService({
      membershipProductTransition: { findUnique: vi.fn() },
      $transaction: vi.fn(async (work: (value: typeof tx) => unknown) => work(tx)),
    } as never)

    await expect(service.setProductStatus(product.id, {
      enabled: true,
      reason: '启用年度金卡新版本',
      idempotencyKey: 'membership-product-enable-overlap',
    }, admin)).rejects.toThrow('有效期与当前版本重叠')
    expect(tx.membershipProduct.updateMany).not.toHaveBeenCalled()
  })

  it('refuses purchases for a disabled or out-of-window product', async () => {
    const orderCreate = vi.fn()
    const tx = {
      membershipProduct: { findUnique: vi.fn().mockResolvedValue(null) },
      memberProfile: { findUnique: vi.fn().mockResolvedValue({ id: 'profile-1' }) },
      order: { create: orderCreate },
    }
    const service = new MembershipsService({
      order: { findUnique: vi.fn().mockResolvedValue(null) },
      $transaction: vi.fn(async (work: (value: typeof tx) => unknown) => work(tx)),
    } as never)

    await expect(service.purchase({
      productId: 'disabled-product',
      creationIdempotencyKey: 'disabled-product-purchase',
    }, member)).rejects.toBeInstanceOf(NotFoundException)
    expect(orderCreate).not.toHaveBeenCalled()
  })
})
