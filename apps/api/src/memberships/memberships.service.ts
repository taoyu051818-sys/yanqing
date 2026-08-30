import { randomBytes } from 'node:crypto'

import { Injectable, NotFoundException } from '@nestjs/common'

import type { AuthUser } from '../common/auth/auth-user.js'
import { PrismaService } from '../database/prisma.service.js'
import {
  BusinessType,
  MembershipStatus,
  OrderStatus,
  SourceChannel,
  SubjectAccount,
} from '../generated/prisma/client.js'
import type { CreateRechargeDto, PurchaseMembershipDto } from './memberships.dto.js'
import { executeOrderCreation } from '../orders/order-creation-idempotency.js'

const orderNo = (prefix: string) =>
  `${prefix}${new Date().toISOString().replace(/\D/g, '').slice(0, 14)}${randomBytes(3).toString('hex').toUpperCase()}`

@Injectable()
export class MembershipsService {
  constructor(private readonly prisma: PrismaService) {}

  products() {
    return this.prisma.membershipProduct.findMany({ where: { enabled: true }, orderBy: { priceCents: 'asc' } })
  }

  async purchase(dto: PurchaseMembershipDto, actor: AuthUser) {
    return executeOrderCreation(this.prisma, {
      memberId: actor.sub,
      creationIdempotencyKey: dto.creationIdempotencyKey,
      command: { kind: 'MEMBERSHIP_PURCHASE', productId: dto.productId },
      loadExisting: (id) => this.prisma.order.findUniqueOrThrow({ where: { id }, include: { membership: true } }),
      create: (creation) => this.prisma.$transaction(async (tx) => {
        const [product, member] = await Promise.all([
          tx.membershipProduct.findUnique({ where: { id: dto.productId } }),
          tx.memberProfile.findUnique({ where: { userId: actor.sub } }),
        ])
        if (!product?.enabled) throw new NotFoundException('会员产品不存在或已下架')
        if (!member) throw new NotFoundException('会员档案不存在')
        const startsAt = new Date()
        const endsAt = new Date(startsAt.getTime() + product.durationDays * 86_400_000)
        const created = await tx.order.create({
          data: {
            ...creation,
            orderNo: orderNo('MB'), memberId: actor.sub, createdById: actor.sub, businessType: BusinessType.MEMBERSHIP,
            subjectAccount: SubjectAccount.VENUE, sourceChannel: SourceChannel.MINI_PROGRAM,
            status: OrderStatus.PENDING, title: product.name, listAmountCents: product.priceCents,
            payableCents: product.priceCents,
            parameterSnapshot: { productId: product.id, level: product.level, durationDays: product.durationDays, benefits: product.benefits },
            items: { create: { itemType: 'MEMBERSHIP', itemId: product.id, name: product.name, unitPriceCents: product.priceCents, amountCents: product.priceCents } },
            membership: { create: { memberId: member.id, productId: product.id, startsAt, endsAt, status: MembershipStatus.FROZEN } },
          },
          include: { membership: true },
        })
        await tx.auditLog.create({
          data: {
            actorId: actor.sub,
            actorRole: actor.roles[0],
            action: 'MEMBERSHIP_ORDER_CREATED',
            objectType: 'Order',
            objectId: created.id,
            newValue: {
              memberId: actor.sub,
              createdById: actor.sub,
              businessType: BusinessType.MEMBERSHIP,
              amountCents: product.priceCents,
              creationIdempotencyKeyPresent: Boolean(creation.creationIdempotencyKey),
              productId: product.id,
              level: product.level,
              durationDays: product.durationDays,
            } as never,
          },
        })
        return created
      }),
    })
  }

  recharge(dto: CreateRechargeDto, actor: AuthUser) {
    return executeOrderCreation(this.prisma, {
      memberId: actor.sub,
      creationIdempotencyKey: dto.creationIdempotencyKey,
      command: { kind: 'RECHARGE', principalCents: dto.principalCents, giftCents: dto.giftCents },
      loadExisting: (id) => this.prisma.order.findUniqueOrThrow({ where: { id } }),
      create: (creation) => this.prisma.$transaction(async (tx) => {
        const created = await tx.order.create({
          data: {
            ...creation,
            orderNo: orderNo('RC'), memberId: actor.sub, createdById: actor.sub, businessType: BusinessType.RECHARGE,
            subjectAccount: SubjectAccount.VENUE, sourceChannel: SourceChannel.MINI_PROGRAM,
            status: OrderStatus.PENDING, title: `会员充值 ¥${(dto.principalCents / 100).toFixed(2)}`,
            listAmountCents: dto.principalCents, payableCents: dto.principalCents,
            parameterSnapshot: { principalCents: dto.principalCents, giftCents: dto.giftCents },
            items: { create: { itemType: 'RECHARGE', name: '现金本金充值', unitPriceCents: dto.principalCents, amountCents: dto.principalCents, metadata: { giftCents: dto.giftCents } } },
          },
        })
        await tx.auditLog.create({
          data: {
            actorId: actor.sub,
            actorRole: actor.roles[0],
            action: 'RECHARGE_ORDER_CREATED',
            objectType: 'Order',
            objectId: created.id,
            newValue: {
              memberId: actor.sub,
              createdById: actor.sub,
              businessType: BusinessType.RECHARGE,
              amountCents: dto.principalCents,
              creationIdempotencyKeyPresent: Boolean(creation.creationIdempotencyKey),
              principalCents: dto.principalCents,
              giftCents: dto.giftCents,
            } as never,
          },
        })
        return created
      }),
    })
  }
}
