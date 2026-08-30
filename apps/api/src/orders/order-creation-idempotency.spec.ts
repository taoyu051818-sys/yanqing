import { ConflictException } from '@nestjs/common'
import { describe, expect, it, vi } from 'vitest'

import { Prisma } from '../generated/prisma/client.js'
import {
  executeOrderCreation,
  isOrderCreationKeyViolation,
  orderCreationCommandHash,
} from './order-creation-idempotency.js'

const uniqueError = (target: string) => new Prisma.PrismaClientKnownRequestError(
  'unique constraint',
  { code: 'P2002', clientVersion: '7.10.0', meta: { modelName: 'Order', target: [target] } },
)

describe('order creation idempotency', () => {
  it('keeps old clients on the original path when no key is supplied', async () => {
    const prisma = { order: { findUnique: vi.fn() } }
    const create = vi.fn().mockResolvedValue({ id: 'order-1' })

    const result = await executeOrderCreation(prisma as never, {
      memberId: 'member-1', command: { kind: 'RECHARGE', amount: 100 },
      loadExisting: vi.fn(), create,
    })

    expect(result).toEqual({ id: 'order-1' })
    expect(create).toHaveBeenCalledWith({})
    expect(prisma.order.findUnique).not.toHaveBeenCalled()
  })

  it('produces the same hash for equivalent object key ordering', () => {
    expect(orderCreationCommandHash({ kind: 'GOODS', items: [{ quantity: 2, itemId: 'ball' }] }))
      .toBe(orderCreationCommandHash({ items: [{ itemId: 'ball', quantity: 2 }], kind: 'GOODS' }))
  })

  it('replays the original order for the same key, member and command', async () => {
    const command = { kind: 'MEMBERSHIP_PURCHASE', productId: 'gold' }
    const prisma = { order: { findUnique: vi.fn().mockResolvedValue({
      id: 'order-1', memberId: 'member-1', creationCommandHash: orderCreationCommandHash(command),
    }) } }
    const loadExisting = vi.fn().mockResolvedValue({ id: 'order-1', membership: { id: 'membership-1' } })
    const create = vi.fn()

    await expect(executeOrderCreation(prisma as never, {
      memberId: 'member-1', creationIdempotencyKey: 'membership-key-1', command, loadExisting, create,
    })).resolves.toMatchObject({ id: 'order-1' })
    expect(loadExisting).toHaveBeenCalledWith('order-1')
    expect(create).not.toHaveBeenCalled()
  })

  it.each([
    ['different member', 'member-2', { kind: 'RECHARGE', amount: 100 }],
    ['different command', 'member-1', { kind: 'RECHARGE', amount: 200 }],
  ])('rejects reuse by %s without exposing the original order', async (_label, memberId, command) => {
    const original = { kind: 'RECHARGE', amount: 100 }
    const prisma = { order: { findUnique: vi.fn().mockResolvedValue({
      id: 'secret-order', memberId: 'member-1', creationCommandHash: orderCreationCommandHash(original),
    }) } }
    const loadExisting = vi.fn()

    await expect(executeOrderCreation(prisma as never, {
      memberId, creationIdempotencyKey: 'recharge-key-1', command, loadExisting, create: vi.fn(),
    })).rejects.toBeInstanceOf(ConflictException)
    expect(loadExisting).not.toHaveBeenCalled()
  })

  it('reads back the concurrent winner only for the creation-key unique constraint', async () => {
    const command = { kind: 'TRAINING_PURCHASE', productId: 'adult' }
    const winner = { id: 'order-winner', memberId: 'member-1', creationCommandHash: orderCreationCommandHash(command) }
    const prisma = { order: { findUnique: vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(winner) } }
    const loadExisting = vi.fn().mockResolvedValue({ id: winner.id })

    await expect(executeOrderCreation(prisma as never, {
      memberId: 'member-1', creationIdempotencyKey: 'training-key-1', command, loadExisting,
      create: vi.fn().mockRejectedValue(uniqueError('creationIdempotencyKey')),
    })).resolves.toEqual({ id: winner.id })
    expect(prisma.order.findUnique).toHaveBeenCalledTimes(2)
  })

  it('does not turn an unrelated unique violation into a replay', async () => {
    const error = uniqueError('orderNo')
    const prisma = { order: { findUnique: vi.fn().mockResolvedValue(null) } }
    const loadExisting = vi.fn()

    await expect(executeOrderCreation(prisma as never, {
      memberId: 'member-1', creationIdempotencyKey: 'goods-key-1', command: { kind: 'GOODS' }, loadExisting,
      create: vi.fn().mockRejectedValue(error),
    })).rejects.toBe(error)
    expect(isOrderCreationKeyViolation(error)).toBe(false)
    expect(prisma.order.findUnique).toHaveBeenCalledOnce()
    expect(loadExisting).not.toHaveBeenCalled()
  })
})
