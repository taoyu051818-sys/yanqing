import { ConflictException, ForbiddenException } from '@nestjs/common'
import { describe, expect, it, vi } from 'vitest'

import type { AuthUser } from '../common/auth/auth-user.js'
import { AppRole } from '../generated/prisma/enums.js'
import { VenuesService } from './venues.service.js'

const admin: AuthUser = {
  sub: 'admin-price-rule',
  displayName: '价格管理员',
  roles: [AppRole.ADMIN],
}
const frontDesk: AuthUser = {
  sub: 'front-price-rule',
  displayName: '价格只读前台',
  roles: [AppRole.FRONT_DESK],
}
const member: AuthUser = {
  sub: 'member-price-rule',
  displayName: '普通会员',
  roles: [AppRole.MEMBER],
}

const ruleDto = (overrides: Record<string, unknown> = {}) => ({
  code: 'PRICE_S01',
  name: '晨练基础价',
  timeSlotId: 'slot-1',
  weekdayMask: 127,
  priceCents: 6_800,
  newcomerPriceCents: 4_800,
  effectiveFrom: '2027-01-01T00:00:00.000Z',
  effectiveTo: '2028-01-01T00:00:00.000Z',
  reason: '建立晨练计价标准',
  idempotencyKey: 'price-rule-create-v1',
  ...overrides,
})

describe('VenuesService price rule governance', () => {
  it('gives front desk controlled read access while keeping writes admin-only', async () => {
    const priceFindMany = vi.fn().mockResolvedValue([])
    const slotFindMany = vi.fn().mockResolvedValue([])
    const service = new VenuesService({
      priceRule: { findMany: priceFindMany },
      timeSlot: { findMany: slotFindMany },
      $transaction: vi.fn(),
    } as never)

    await expect(service.listPriceRules(frontDesk)).resolves.toEqual([])
    await expect(service.listTimeSlots(frontDesk)).resolves.toEqual([])
    await expect(service.createPriceRule(ruleDto(), frontDesk))
      .rejects.toBeInstanceOf(ForbiddenException)
    expect(priceFindMany).toHaveBeenCalledOnce()
    expect(slotFindMany).toHaveBeenCalledOnce()
    expect(() => service.listPriceRules(member)).toThrow(ForbiddenException)
  })

  it('creates one disabled v1 with source snapshot, evidence and exact replay', async () => {
    let stored: any = null
    const auditCreate = vi.fn().mockResolvedValue({})
    const tx = {
      priceRule: {
        findUnique: vi.fn(async () => stored),
        aggregate: vi.fn().mockResolvedValue({ _max: { version: null } }),
        create: vi.fn(async ({ data }: any) => {
          stored = { id: 'price-rule-v1', ...data, createdAt: new Date(), updatedAt: new Date() }
          return stored
        }),
      },
      timeSlot: { findUnique: vi.fn().mockResolvedValue({ id: 'slot-1' }) },
      auditLog: { create: auditCreate },
    }
    const service = new VenuesService({
      priceRule: { findUnique: vi.fn(async () => stored) },
      $transaction: vi.fn(async (work: (value: typeof tx) => unknown) => work(tx)),
    } as never)
    const dto = ruleDto()

    const first = await service.createPriceRule(dto, admin)
    const replay = await service.createPriceRule(dto, admin)

    expect(first).toMatchObject({
      code: dto.code,
      version: 1,
      timeSlotId: dto.timeSlotId,
      weekdayMask: dto.weekdayMask,
      enabled: false,
      createdById: admin.sub,
    })
    expect(replay.id).toBe(first.id)
    expect(replay).not.toHaveProperty('creationIdempotencyKey')
    expect(replay).not.toHaveProperty('creationCommandHash')
    expect(tx.priceRule.create).toHaveBeenCalledOnce()
    expect(auditCreate).toHaveBeenCalledOnce()
    expect(JSON.stringify(auditCreate.mock.calls[0][0])).not.toContain(dto.idempotencyKey)
  })

  it('rejects an ambiguous active rule for the same slot and weekday range', async () => {
    const rule = {
      id: 'price-rule-v2',
      code: 'PRICE_S01_NEW',
      version: 1,
      timeSlotId: 'slot-1',
      weekdayMask: 0b0111110,
      enabled: false,
      effectiveFrom: new Date('2027-01-01T00:00:00.000Z'),
      effectiveTo: new Date('2028-01-01T00:00:00.000Z'),
    }
    const tx = {
      priceRuleTransition: { findUnique: vi.fn().mockResolvedValue(null) },
      priceRule: {
        findUnique: vi.fn().mockResolvedValue(rule),
        findFirst: vi.fn().mockResolvedValue(null),
        findMany: vi.fn().mockResolvedValue([
          { id: 'price-rule-v1', code: 'PRICE_S01', version: 1, weekdayMask: 0b0000010 },
        ]),
        updateMany: vi.fn(),
      },
    }
    const service = new VenuesService({
      priceRuleTransition: { findUnique: vi.fn() },
      $transaction: vi.fn(async (work: (value: typeof tx) => unknown) => work(tx)),
    } as never)

    await expect(service.setPriceRuleStatus(rule.id, {
      enabled: true,
      reason: '启用新的晨练价格',
      idempotencyKey: 'price-rule-enable-overlap',
    }, admin)).rejects.toThrow('不能产生不确定价格')
    expect(tx.priceRule.updateMany).not.toHaveBeenCalled()
  })

  it('rejects overlapping enabled versions of the same code before CAS', async () => {
    const rule = {
      id: 'price-rule-v2',
      code: 'PRICE_S01',
      version: 2,
      timeSlotId: 'slot-1',
      weekdayMask: 127,
      enabled: false,
      effectiveFrom: new Date('2027-01-01T00:00:00.000Z'),
      effectiveTo: new Date('2028-01-01T00:00:00.000Z'),
    }
    const tx = {
      priceRuleTransition: { findUnique: vi.fn().mockResolvedValue(null) },
      priceRule: {
        findUnique: vi.fn().mockResolvedValue(rule),
        findFirst: vi.fn().mockResolvedValue({ id: 'price-rule-v1', version: 1 }),
        findMany: vi.fn(),
        updateMany: vi.fn(),
      },
    }
    const service = new VenuesService({
      priceRuleTransition: { findUnique: vi.fn() },
      $transaction: vi.fn(async (work: (value: typeof tx) => unknown) => work(tx)),
    } as never)

    await expect(service.setPriceRuleStatus(rule.id, {
      enabled: true,
      reason: '切换晨练价格版本',
      idempotencyKey: 'price-rule-enable-same-code',
    }, admin)).rejects.toBeInstanceOf(ConflictException)
    expect(tx.priceRule.findMany).not.toHaveBeenCalled()
    expect(tx.priceRule.updateMany).not.toHaveBeenCalled()
  })

  it('resolves a slot-specific active rule ahead of the global fallback deterministically', async () => {
    const effectiveFrom = new Date('2026-01-01T00:00:00.000Z')
    const global = {
      id: 'global', code: 'PRICE_GLOBAL', version: 5, timeSlotId: null,
      weekdayMask: 127, priceCents: 9_900, newcomerPriceCents: null, effectiveFrom,
    }
    const specific = {
      id: 'specific', code: 'PRICE_S01', version: 1, timeSlotId: 'slot-1',
      weekdayMask: 127, priceCents: 6_800, newcomerPriceCents: 4_800, effectiveFrom,
    }
    const findMany = vi.fn().mockResolvedValue([global, specific])
    const service = new VenuesService({ priceRule: { findMany } } as never)

    await expect((service as any).resolvePrice('slot-1', '2026-08-30'))
      .resolves.toMatchObject({ id: 'specific', priceCents: 6_800 })
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ enabled: true }),
    }))
  })
})
