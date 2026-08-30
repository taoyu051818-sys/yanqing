import { describe, expect, it, vi } from 'vitest'

import type { AuthUser } from '../common/auth/auth-user.js'
import {
  AppRole,
  InventoryMode,
  SupplierType,
} from '../generated/prisma/enums.js'
import { GoodsService } from './goods.service.js'

const member: AuthUser = {
  sub: 'member-1',
  displayName: '会员',
  roles: [AppRole.MEMBER],
}

describe('GoodsService order creator evidence', () => {
  it('audits goods order creation once and does not audit an exact replay', async () => {
    const key = 'goods-order-key-1'
    let stored: Record<string, any> | null = null
    const orderCreate = vi.fn().mockImplementation(async ({ data }: { data: Record<string, any> }) => {
      stored = { id: 'goods-order-1', ...data, items: [] }
      return stored
    })
    const auditCreate = vi.fn().mockResolvedValue({})
    const tx = {
      inventoryItem: {
        findMany: vi.fn().mockResolvedValue([{
          id: 'goods-ball',
          sku: 'BALL-01',
          name: '羽毛球',
          mode: InventoryMode.CONSIGNMENT,
          supplier: '品牌寄售旧字段',
          supplierId: 'supplier-consignment',
          supplierRecord: {
            id: 'supplier-consignment',
            code: 'CONSIGN-01',
            name: '品牌寄售',
            type: SupplierType.CONSIGNMENT,
            settlementRule: {
              settlementCycle: 'MONTHLY',
              commissionRateBps: 2_500,
            },
          },
          stock: 20,
          salePriceCents: 120,
        }]),
      },
      order: { create: orderCreate },
      auditLog: { create: auditCreate },
    }
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
    const service = new GoodsService(prisma as never)
    const command = {
      items: [{ itemId: 'goods-ball', quantity: 2 }],
      creationIdempotencyKey: key,
    }

    await service.createOrder(command, member)
    await service.createOrder(command, member)

    expect(orderCreate).toHaveBeenCalledOnce()
    expect(orderCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        memberId: member.sub,
        createdById: member.sub,
        items: {
          create: [
            expect.objectContaining({
              itemId: 'goods-ball',
              metadata: {
                inventorySnapshotVersion: 1,
                sku: 'BALL-01',
                mode: InventoryMode.CONSIGNMENT,
                supplier: '品牌寄售',
                supplierId: 'supplier-consignment',
                supplierCode: 'CONSIGN-01',
                supplierName: '品牌寄售',
                settlementRule: {
                  settlementCycle: 'MONTHLY',
                  commissionRateBps: 2_500,
                },
              },
            }),
          ],
        },
      }),
    }))
    expect(auditCreate).toHaveBeenCalledOnce()
    expect(auditCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorId: member.sub,
        actorRole: AppRole.MEMBER,
        action: 'GOODS_ORDER_CREATED',
        objectType: 'Order',
        objectId: 'goods-order-1',
        newValue: expect.objectContaining({
          memberId: member.sub,
          createdById: member.sub,
          amountCents: 240,
          creationIdempotencyKeyPresent: true,
          items: [{ itemId: 'goods-ball', quantity: 2 }],
        }),
      }),
    })
    expect(JSON.stringify(auditCreate.mock.calls[0][0])).not.toContain(key)
  })
})
