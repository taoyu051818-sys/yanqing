import { randomBytes } from 'node:crypto'

import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'

import type { AuthUser } from '../common/auth/auth-user.js'
import { PrismaService } from '../database/prisma.service.js'
import { BusinessType, OrderStatus, SourceChannel, SubjectAccount } from '../generated/prisma/client.js'
import {
  buildGoodsOrderItemSnapshot,
  ConsignmentOrderSnapshotError,
} from '../inventory/consignment-order-snapshot.js'
import type { CreateGoodsOrderDto } from './goods.dto.js'
import { executeOrderCreation } from '../orders/order-creation-idempotency.js'

const orderNo = () => `GD${new Date().toISOString().replace(/\D/g, '').slice(0, 14)}${randomBytes(3).toString('hex').toUpperCase()}`

@Injectable()
export class GoodsService {
  constructor(private readonly prisma: PrismaService) {}

  products() {
    return this.prisma.inventoryItem.findMany({ where: { enabled: true }, orderBy: [{ category: 'asc' }, { name: 'asc' }] })
  }

  async createOrder(dto: CreateGoodsOrderDto, actor: AuthUser) {
    const quantities = new Map<string, number>()
    for (const item of dto.items) quantities.set(item.itemId, (quantities.get(item.itemId) || 0) + item.quantity)
    const commandItems = [...quantities.entries()]
      .map(([itemId, quantity]) => ({ itemId, quantity }))
      .sort((left, right) => left.itemId.localeCompare(right.itemId))
    return executeOrderCreation(this.prisma, {
      memberId: actor.sub,
      creationIdempotencyKey: dto.creationIdempotencyKey,
      command: { kind: 'GOODS_ORDER', items: commandItems },
      loadExisting: (id) => this.prisma.order.findUniqueOrThrow({ where: { id }, include: { items: true } }),
      create: (creation) => this.prisma.$transaction(async (tx) => {
        const products = await tx.inventoryItem.findMany({
          where: { id: { in: [...quantities.keys()] }, enabled: true },
          include: { supplierRecord: true },
        })
        if (products.length !== quantities.size) throw new NotFoundException('部分商品不存在或已下架')
        const items = products.map((product) => {
          const quantity = quantities.get(product.id)!
          if (product.stock < quantity) throw new BadRequestException(`${product.name} 库存不足`)
          try {
            return {
              itemType: 'INVENTORY_GOODS', itemId: product.id, name: product.name, quantity,
              unitPriceCents: product.salePriceCents, amountCents: product.salePriceCents * quantity,
              metadata: buildGoodsOrderItemSnapshot(product),
            }
          } catch (error) {
            if (error instanceof ConsignmentOrderSnapshotError)
              throw new BadRequestException(error.message)
            throw error
          }
        })
        const amount = items.reduce((sum, item) => sum + item.amountCents, 0)
        const created = await tx.order.create({
          data: {
            ...creation,
            orderNo: orderNo(), memberId: actor.sub, createdById: actor.sub, businessType: BusinessType.GOODS,
            subjectAccount: SubjectAccount.VENUE, sourceChannel: SourceChannel.MINI_PROGRAM,
            status: OrderStatus.PENDING, title: `场馆商品 ${items.length} 种`,
            listAmountCents: amount, payableCents: amount,
            parameterSnapshot: { pricing: 'SERVER_SNAPSHOT', itemCount: items.length },
            items: { create: items },
          },
          include: { items: true },
        })
        await tx.auditLog.create({
          data: {
            actorId: actor.sub,
            actorRole: actor.roles[0],
            action: 'GOODS_ORDER_CREATED',
            objectType: 'Order',
            objectId: created.id,
            newValue: {
              memberId: actor.sub,
              createdById: actor.sub,
              businessType: BusinessType.GOODS,
              amountCents: amount,
              creationIdempotencyKeyPresent: Boolean(creation.creationIdempotencyKey),
              items: commandItems,
            } as never,
          },
        })
        return created
      }),
    })
  }
}
