import { describe, expect, it, vi } from 'vitest'

import type { AuthUser } from '../common/auth/auth-user.js'
import { AppRole } from '../generated/prisma/enums.js'
import { MembershipsService } from './memberships.service.js'

const member: AuthUser = {
  sub: 'member-1',
  displayName: '会员',
  roles: [AppRole.MEMBER],
}

const creationHarness = (orderId: string, delegates: Record<string, unknown> = {}) => {
  let stored: Record<string, any> | null = null
  const orderCreate = vi.fn().mockImplementation(async ({ data }: { data: Record<string, any> }) => {
    stored = { id: orderId, ...data }
    return stored
  })
  const auditCreate = vi.fn().mockResolvedValue({})
  const tx = { ...delegates, order: { create: orderCreate }, auditLog: { create: auditCreate } }
  const prisma = {
    order: {
      findUnique: vi.fn().mockImplementation(async () => stored && ({
        id: stored.id,
        memberId: stored.memberId,
        creationCommandHash: stored.creationCommandHash,
      })),
      findUniqueOrThrow: vi.fn().mockImplementation(async () => stored),
    },
    $transaction: vi.fn(async (work: (client: typeof tx) => unknown) => work(tx)),
  }
  return { prisma, tx, orderCreate, auditCreate }
}

describe('MembershipsService order creator evidence', () => {
  it('audits membership creation once and does not audit an exact replay', async () => {
    const key = 'membership-order-key-1'
    const { prisma, orderCreate, auditCreate } = creationHarness('membership-order-1', {
      membershipProduct: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'membership-gold',
          name: '金卡',
          enabled: true,
          level: 'GOLD',
          durationDays: 365,
          priceCents: 69_900,
          benefits: {},
        }),
      },
      memberProfile: { findUnique: vi.fn().mockResolvedValue({ id: 'profile-1' }) },
    })
    const service = new MembershipsService(prisma as never)

    await service.purchase({ productId: 'membership-gold', creationIdempotencyKey: key }, member)
    await service.purchase({ productId: 'membership-gold', creationIdempotencyKey: key }, member)

    expect(orderCreate).toHaveBeenCalledOnce()
    expect(orderCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ memberId: member.sub, createdById: member.sub }),
    }))
    expect(auditCreate).toHaveBeenCalledOnce()
    expect(auditCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorId: member.sub,
        actorRole: AppRole.MEMBER,
        action: 'MEMBERSHIP_ORDER_CREATED',
        objectType: 'Order',
        objectId: 'membership-order-1',
        newValue: expect.objectContaining({
          memberId: member.sub,
          createdById: member.sub,
          amountCents: 69_900,
          creationIdempotencyKeyPresent: true,
          productId: 'membership-gold',
        }),
      }),
    })
    expect(JSON.stringify(auditCreate.mock.calls[0][0])).not.toContain(key)
  })

  it('audits recharge creation once and does not audit an exact replay', async () => {
    const key = 'recharge-order-key-1'
    const { prisma, orderCreate, auditCreate } = creationHarness('recharge-order-1')
    const service = new MembershipsService(prisma as never)

    await service.recharge({ principalCents: 10_000, giftCents: 500, creationIdempotencyKey: key }, member)
    await service.recharge({ principalCents: 10_000, giftCents: 500, creationIdempotencyKey: key }, member)

    expect(orderCreate).toHaveBeenCalledOnce()
    expect(orderCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ memberId: member.sub, createdById: member.sub }),
    }))
    expect(auditCreate).toHaveBeenCalledOnce()
    expect(auditCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorId: member.sub,
        action: 'RECHARGE_ORDER_CREATED',
        objectType: 'Order',
        objectId: 'recharge-order-1',
        newValue: expect.objectContaining({
          memberId: member.sub,
          createdById: member.sub,
          amountCents: 10_000,
          principalCents: 10_000,
          giftCents: 500,
          creationIdempotencyKeyPresent: true,
        }),
      }),
    })
    expect(JSON.stringify(auditCreate.mock.calls[0][0])).not.toContain(key)
  })
})
