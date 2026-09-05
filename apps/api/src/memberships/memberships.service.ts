import { createHash, randomBytes } from 'node:crypto'

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'

import type { AuthUser } from '../common/auth/auth-user.js'
import { PrismaService } from '../database/prisma.service.js'
import {
  BusinessType,
  AppRole,
  MembershipStatus,
  OrderStatus,
  Prisma,
  SourceChannel,
  SubjectAccount,
} from '../generated/prisma/client.js'
import type {
  CreateMembershipProductDto,
  CreateMembershipProductVersionDto,
  CreateRechargeDto,
  CreateRechargePlanDto,
  PurchaseMembershipDto,
  SetMembershipProductStatusDto,
  SetRechargePlanStatusDto,
} from './memberships.dto.js'
import { executeOrderCreation } from '../orders/order-creation-idempotency.js'
import { orderResponse } from '../orders/order-response.js'
import { resolveOperatingShareSnapshot } from '../common/finance/operating-share.js'

const orderNo = (prefix: string) =>
  `${prefix}${new Date().toISOString().replace(/\D/g, '').slice(0, 14)}${randomBytes(3).toString('hex').toUpperCase()}`

const commandHash = (command: Record<string, unknown>) => createHash('sha256')
  .update(JSON.stringify({ version: 1, command }))
  .digest('hex')

const isRetryableWriteConflict = (error: unknown) =>
  typeof error === 'object' && error !== null && 'code' in error &&
  ['P2002', 'P2034'].includes(String((error as { code?: unknown }).code))

const rechargePlanView = <T extends Record<string, unknown>>(plan: T) => {
  const {
    creationIdempotencyKey: _creationIdempotencyKey,
    creationCommandHash: _creationCommandHash,
    ...view
  } = plan
  return view
}

const rechargePlanTransitionView = <T extends Record<string, unknown>>(
  transition: T,
) => {
  const {
    idempotencyKey: _idempotencyKey,
    commandHash: _commandHash,
    plan: _plan,
    ...view
  } = transition
  return view
}

const membershipProductView = <T extends Record<string, unknown>>(product: T) => {
  const {
    creationIdempotencyKey: _creationIdempotencyKey,
    creationCommandHash: _creationCommandHash,
    ...view
  } = product
  return view
}

const membershipProductTransitionView = <T extends Record<string, unknown>>(
  transition: T,
) => {
  const {
    idempotencyKey: _idempotencyKey,
    commandHash: _commandHash,
    membershipProduct: _membershipProduct,
    ...view
  } = transition
  return view
}

@Injectable()
export class MembershipsService {
  constructor(private readonly prisma: PrismaService) {}

  products() {
    const now = new Date()
    return this.prisma.membershipProduct.findMany({
      where: {
        enabled: true,
        effectiveFrom: { lte: now },
        OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }],
      },
      select: {
        id: true,
        code: true,
        version: true,
        name: true,
        level: true,
        priceCents: true,
        durationDays: true,
        benefits: true,
        effectiveFrom: true,
        effectiveTo: true,
        enabled: true,
      },
      orderBy: [{ priceCents: 'asc' }, { code: 'asc' }, { version: 'desc' }],
    })
  }

  manageProducts(actor: AuthUser) {
    this.assertMembershipProductReader(actor)
    return this.prisma.membershipProduct.findMany({
      select: {
        id: true,
        code: true,
        version: true,
        name: true,
        level: true,
        priceCents: true,
        durationDays: true,
        benefits: true,
        effectiveFrom: true,
        effectiveTo: true,
        enabled: true,
        createdAt: true,
        updatedAt: true,
        createdBy: { select: { id: true, displayName: true } },
        transitions: {
          select: {
            id: true,
            oldEnabled: true,
            newEnabled: true,
            reason: true,
            createdAt: true,
            actor: { select: { id: true, displayName: true } },
          },
          orderBy: { createdAt: 'desc' },
          take: 20,
        },
      },
      orderBy: [{ code: 'asc' }, { version: 'desc' }],
    })
  }

  createProduct(dto: CreateMembershipProductDto, actor: AuthUser) {
    return this.createMembershipProductVersion(dto.code, null, dto, actor)
  }

  async createProductVersion(
    sourceProductId: string,
    dto: CreateMembershipProductVersionDto,
    actor: AuthUser,
  ) {
    this.assertMembershipProductAdministrator(actor)
    const source = await this.prisma.membershipProduct.findUnique({
      where: { id: sourceProductId },
      select: { code: true },
    })
    if (!source) throw new NotFoundException('会员产品源版本不存在')
    return this.createMembershipProductVersion(
      source.code,
      sourceProductId,
      dto,
      actor,
    )
  }

  async setProductStatus(
    productId: string,
    dto: SetMembershipProductStatusDto,
    actor: AuthUser,
  ) {
    this.assertMembershipProductAdministrator(actor)
    const reason = dto.reason.trim()
    const hash = commandHash({ productId, enabled: dto.enabled, reason })

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        return await this.prisma.$transaction(async (tx) => {
          const replay = await tx.membershipProductTransition.findUnique({
            where: { idempotencyKey: dto.idempotencyKey },
            include: { membershipProduct: true },
          })
          if (replay) {
            this.assertMembershipProductTransitionReplay(
              replay,
              productId,
              actor,
              hash,
            )
            return {
              ...membershipProductView(replay.membershipProduct),
              enabled: replay.newEnabled,
              transition: membershipProductTransitionView(replay),
              idempotent: true,
            }
          }

          const product = await tx.membershipProduct.findUnique({
            where: { id: productId },
          })
          if (!product) throw new NotFoundException('会员产品不存在')
          if (product.enabled === dto.enabled)
            throw new ConflictException(dto.enabled ? '会员产品已启用' : '会员产品已停用')

          if (dto.enabled) {
            const overlapping = await tx.membershipProduct.findFirst({
              where: {
                id: { not: product.id },
                code: product.code,
                enabled: true,
                ...(product.effectiveTo
                  ? { effectiveFrom: { lt: product.effectiveTo } }
                  : {}),
                OR: [
                  { effectiveTo: null },
                  { effectiveTo: { gt: product.effectiveFrom } },
                ],
              },
              select: { id: true, version: true },
            })
            if (overlapping) {
              throw new ConflictException(
                `同编码 v${overlapping.version} 的有效期与当前版本重叠，请先停用旧版本或调整新版本有效期`,
              )
            }
          }

          const changed = await tx.membershipProduct.updateMany({
            where: { id: product.id, enabled: product.enabled },
            data: { enabled: dto.enabled },
          })
          if (changed.count !== 1)
            throw new ConflictException('会员产品状态已变化，请刷新后重试')
          const transition = await tx.membershipProductTransition.create({
            data: {
              membershipProductId: product.id,
              oldEnabled: product.enabled,
              newEnabled: dto.enabled,
              reason,
              actorId: actor.sub,
              idempotencyKey: dto.idempotencyKey,
              commandHash: hash,
            },
          })
          await tx.auditLog.create({
            data: {
              actorId: actor.sub,
              actorRole: this.masterDataAuditRole(actor),
              action: 'MEMBERSHIP_PRODUCT_STATUS_SET',
              objectType: 'MembershipProduct',
              objectId: product.id,
              reason,
              oldValue: { enabled: product.enabled } as never,
              newValue: {
                enabled: dto.enabled,
                code: product.code,
                version: product.version,
              } as never,
            },
          })
          return {
            ...membershipProductView(product),
            enabled: dto.enabled,
            transition: membershipProductTransitionView(transition),
            idempotent: false,
          }
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
      } catch (error) {
        if (!isRetryableWriteConflict(error)) throw error
        const replay = await this.prisma.membershipProductTransition.findUnique({
          where: { idempotencyKey: dto.idempotencyKey },
          include: { membershipProduct: true },
        })
        if (replay) {
          this.assertMembershipProductTransitionReplay(
            replay,
            productId,
            actor,
            hash,
          )
          return {
            ...membershipProductView(replay.membershipProduct),
            enabled: replay.newEnabled,
            transition: membershipProductTransitionView(replay),
            idempotent: true,
          }
        }
        if (attempt === 3)
          throw new ConflictException('会员产品状态发生并发冲突，请刷新后重试')
      }
    }
    throw new ConflictException('会员产品状态发生并发冲突，请刷新后重试')
  }

  rechargePlans() {
    const now = new Date()
    return this.prisma.rechargePlan.findMany({
      where: {
        enabled: true,
        effectiveFrom: { lte: now },
        OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }],
      },
      select: {
        id: true,
        code: true,
        version: true,
        name: true,
        principalCents: true,
        giftCents: true,
        effectiveFrom: true,
        effectiveTo: true,
        enabled: true,
      },
      orderBy: [{ principalCents: 'asc' }, { version: 'desc' }],
    })
  }

  manageRechargePlans(actor: AuthUser) {
    this.assertRechargePlanAdministrator(actor)
    return this.prisma.rechargePlan.findMany({
      select: {
        id: true,
        code: true,
        version: true,
        name: true,
        principalCents: true,
        giftCents: true,
        effectiveFrom: true,
        effectiveTo: true,
        enabled: true,
        createdAt: true,
        updatedAt: true,
        createdBy: { select: { id: true, displayName: true } },
        transitions: {
          select: {
            id: true,
            oldEnabled: true,
            newEnabled: true,
            reason: true,
            createdAt: true,
            actor: { select: { id: true, displayName: true } },
          },
          orderBy: { createdAt: 'desc' },
          take: 20,
        },
      },
      orderBy: [{ code: 'asc' }, { version: 'desc' }],
    })
  }

  async createRechargePlan(dto: CreateRechargePlanDto, actor: AuthUser) {
    this.assertRechargePlanAdministrator(actor)
    const effectiveFrom = new Date(dto.effectiveFrom)
    const effectiveTo = dto.effectiveTo ? new Date(dto.effectiveTo) : null
    if (effectiveTo && effectiveTo <= effectiveFrom)
      throw new BadRequestException('充值计划失效时间必须晚于生效时间')
    if (dto.giftCents > dto.principalCents)
      throw new BadRequestException('赠送金额不得超过充值本金')
    const reason = dto.reason.trim()
    const command = {
      code: dto.code,
      name: dto.name.trim(),
      principalCents: dto.principalCents,
      giftCents: dto.giftCents,
      effectiveFrom: effectiveFrom.toISOString(),
      effectiveTo: effectiveTo?.toISOString() ?? null,
      reason,
    }
    const hash = commandHash(command)

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        return await this.prisma.$transaction(async (tx) => {
          const existing = await tx.rechargePlan.findUnique({
            where: { creationIdempotencyKey: dto.idempotencyKey },
          })
          if (existing) {
            this.assertRechargePlanCreationReplay(existing, actor, hash)
            return rechargePlanView(existing)
          }
          const latest = await tx.rechargePlan.aggregate({
            where: { code: dto.code },
            _max: { version: true },
          })
          const created = await tx.rechargePlan.create({
            data: {
              code: dto.code,
              version: (latest._max.version ?? 0) + 1,
              name: command.name,
              principalCents: dto.principalCents,
              giftCents: dto.giftCents,
              effectiveFrom,
              effectiveTo,
              enabled: false,
              creationIdempotencyKey: dto.idempotencyKey,
              creationCommandHash: hash,
              createdById: actor.sub,
            },
          })
          await tx.auditLog.create({
            data: {
              actorId: actor.sub,
              actorRole: actor.roles[0],
              action: 'RECHARGE_PLAN_VERSION_CREATED',
              objectType: 'RechargePlan',
              objectId: created.id,
              reason,
              newValue: {
                code: created.code,
                version: created.version,
                name: created.name,
                principalCents: created.principalCents,
                giftCents: created.giftCents,
                effectiveFrom: created.effectiveFrom.toISOString(),
                effectiveTo: created.effectiveTo?.toISOString() ?? null,
                enabled: false,
              } as never,
            },
          })
          return rechargePlanView(created)
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
      } catch (error) {
        if (!isRetryableWriteConflict(error)) throw error
        const existing = await this.prisma.rechargePlan.findUnique({
          where: { creationIdempotencyKey: dto.idempotencyKey },
        })
        if (existing) {
          this.assertRechargePlanCreationReplay(existing, actor, hash)
          return rechargePlanView(existing)
        }
        if (attempt === 3)
          throw new ConflictException('充值计划版本发生并发冲突，请刷新后重试')
      }
    }
    throw new ConflictException('充值计划版本发生并发冲突，请刷新后重试')
  }

  async setRechargePlanStatus(
    planId: string,
    dto: SetRechargePlanStatusDto,
    actor: AuthUser,
  ) {
    this.assertRechargePlanAdministrator(actor)
    const reason = dto.reason.trim()
    const hash = commandHash({ planId, enabled: dto.enabled, reason })

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        return await this.prisma.$transaction(async (tx) => {
          const existing = await tx.rechargePlanTransition.findUnique({
            where: { idempotencyKey: dto.idempotencyKey },
            include: { plan: true },
          })
          if (existing) {
            this.assertRechargePlanTransitionReplay(existing, planId, actor, hash)
            return {
              ...rechargePlanView(existing.plan),
              enabled: existing.newEnabled,
              transition: rechargePlanTransitionView(existing),
              idempotent: true,
            }
          }
          const plan = await tx.rechargePlan.findUnique({ where: { id: planId } })
          if (!plan) throw new NotFoundException('充值计划不存在')
          if (plan.enabled === dto.enabled)
            throw new ConflictException(dto.enabled ? '充值计划已启用' : '充值计划已停用')

          if (dto.enabled) {
            const overlapping = await tx.rechargePlan.findFirst({
              where: {
                id: { not: plan.id },
                code: plan.code,
                enabled: true,
                ...(plan.effectiveTo
                  ? { effectiveFrom: { lt: plan.effectiveTo } }
                  : {}),
                OR: [
                  { effectiveTo: null },
                  { effectiveTo: { gt: plan.effectiveFrom } },
                ],
              },
              select: { id: true, version: true },
            })
            if (overlapping) {
              throw new ConflictException(
                `同编码 v${overlapping.version} 的有效期与当前版本重叠，请先调整版本有效期`,
              )
            }
          } else {
            const now = new Date()
            const activeNow =
              plan.effectiveFrom <= now &&
              (!plan.effectiveTo || plan.effectiveTo > now)
            if (activeNow) {
              const alternativeCount = await tx.rechargePlan.count({
                where: {
                  id: { not: plan.id },
                  enabled: true,
                  effectiveFrom: { lte: now },
                  OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }],
                },
              })
              if (alternativeCount < 1) {
                throw new ConflictException(
                  '不能停用最后一个当前有效充值计划，请先启用替代计划',
                )
              }
            }
          }

          const changed = await tx.rechargePlan.updateMany({
            where: { id: plan.id, enabled: plan.enabled },
            data: { enabled: dto.enabled },
          })
          if (changed.count !== 1)
            throw new ConflictException('充值计划状态已变化，请刷新后重试')
          const transition = await tx.rechargePlanTransition.create({
            data: {
              planId: plan.id,
              oldEnabled: plan.enabled,
              newEnabled: dto.enabled,
              reason,
              actorId: actor.sub,
              idempotencyKey: dto.idempotencyKey,
              commandHash: hash,
            },
          })
          await tx.auditLog.create({
            data: {
              actorId: actor.sub,
              actorRole: actor.roles[0],
              action: 'RECHARGE_PLAN_STATUS_SET',
              objectType: 'RechargePlan',
              objectId: plan.id,
              reason,
              oldValue: { enabled: plan.enabled } as never,
              newValue: { enabled: dto.enabled, version: plan.version } as never,
            },
          })
          return {
            ...rechargePlanView(plan),
            enabled: dto.enabled,
            transition: rechargePlanTransitionView(transition),
            idempotent: false,
          }
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
      } catch (error) {
        if (!isRetryableWriteConflict(error)) throw error
        const existing = await this.prisma.rechargePlanTransition.findUnique({
          where: { idempotencyKey: dto.idempotencyKey },
          include: { plan: true },
        })
        if (existing) {
          this.assertRechargePlanTransitionReplay(existing, planId, actor, hash)
          return {
            ...rechargePlanView(existing.plan),
            enabled: existing.newEnabled,
            transition: rechargePlanTransitionView(existing),
            idempotent: true,
          }
        }
        if (attempt === 3)
          throw new ConflictException('充值计划状态发生并发冲突，请刷新后重试')
      }
    }
    throw new ConflictException('充值计划状态发生并发冲突，请刷新后重试')
  }

  async purchase(dto: PurchaseMembershipDto, actor: AuthUser) {
    const order = await executeOrderCreation(this.prisma, {
      memberId: actor.sub,
      creationIdempotencyKey: dto.creationIdempotencyKey,
      command: { kind: 'MEMBERSHIP_PURCHASE', productId: dto.productId },
      loadExisting: (id) => this.prisma.order.findUniqueOrThrow({ where: { id }, include: { membership: true } }),
      create: (creation) => this.prisma.$transaction(async (tx) => {
        const now = new Date()
        const [product, member] = await Promise.all([
          tx.membershipProduct.findUnique({ where: { id: dto.productId } }),
          tx.memberProfile.findUnique({ where: { userId: actor.sub } }),
        ])
        if (
          !product?.enabled ||
          product.effectiveFrom > now ||
          (product.effectiveTo !== null && product.effectiveTo <= now)
        ) {
          throw new NotFoundException('会员产品不存在、未生效或已停用')
        }
        if (!member) throw new NotFoundException('会员档案不存在')
        const startsAt = now
        const endsAt = new Date(startsAt.getTime() + product.durationDays * 86_400_000)
        const operatingShare = await resolveOperatingShareSnapshot(
          tx,
          BusinessType.MEMBERSHIP,
          now,
        )
        const created = await tx.order.create({
          data: {
            ...creation,
            orderNo: orderNo('MB'), memberId: actor.sub, createdById: actor.sub, businessType: BusinessType.MEMBERSHIP,
            subjectAccount: SubjectAccount.VENUE, sourceChannel: SourceChannel.MINI_PROGRAM,
            status: OrderStatus.PENDING, title: product.name, listAmountCents: product.priceCents,
            payableCents: product.priceCents,
            parameterSnapshot: {
              productId: product.id,
              productCode: product.code,
              productVersion: product.version,
              productName: product.name,
              level: product.level,
              priceCents: product.priceCents,
              durationDays: product.durationDays,
              benefits: product.benefits,
              effectiveFrom: product.effectiveFrom.toISOString(),
              effectiveTo: product.effectiveTo?.toISOString() ?? null,
              operatingShare,
            },
            items: { create: {
              itemType: 'MEMBERSHIP', itemId: product.id, name: product.name,
              unitPriceCents: product.priceCents, amountCents: product.priceCents,
              metadata: { productCode: product.code, productVersion: product.version },
            } },
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
              productCode: product.code,
              productVersion: product.version,
              level: product.level,
              durationDays: product.durationDays,
            } as never,
          },
        })
        return created
      }),
    })
    return orderResponse(order)
  }

  async recharge(dto: CreateRechargeDto, actor: AuthUser) {
    const order = await executeOrderCreation(this.prisma, {
      memberId: actor.sub,
      creationIdempotencyKey: dto.creationIdempotencyKey,
      command: { kind: 'RECHARGE', planId: dto.planId },
      loadExisting: (id) => this.prisma.order.findUniqueOrThrow({ where: { id } }),
      create: (creation) => this.prisma.$transaction(async (tx) => {
        const now = new Date()
        const plan = await tx.rechargePlan.findFirst({
          where: {
            id: dto.planId,
            enabled: true,
            effectiveFrom: { lte: now },
            OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }],
          },
        })
        if (!plan)
          throw new NotFoundException('充值计划不存在、未生效或已停用')
        const operatingShare = await resolveOperatingShareSnapshot(
          tx,
          BusinessType.RECHARGE,
          now,
        )
        const created = await tx.order.create({
          data: {
            ...creation,
            orderNo: orderNo('RC'), memberId: actor.sub, createdById: actor.sub, businessType: BusinessType.RECHARGE,
            subjectAccount: SubjectAccount.VENUE, sourceChannel: SourceChannel.MINI_PROGRAM,
            status: OrderStatus.PENDING, title: plan.name,
            listAmountCents: plan.principalCents, payableCents: plan.principalCents,
            parameterSnapshot: {
              rechargePlanId: plan.id,
              rechargePlanCode: plan.code,
              rechargePlanVersion: plan.version,
              rechargePlanName: plan.name,
              principalCents: plan.principalCents,
              giftCents: plan.giftCents,
              effectiveFrom: plan.effectiveFrom.toISOString(),
              effectiveTo: plan.effectiveTo?.toISOString() ?? null,
              operatingShare,
            },
            items: { create: {
              itemType: 'RECHARGE', itemId: plan.id, name: plan.name,
              unitPriceCents: plan.principalCents, amountCents: plan.principalCents,
              metadata: { rechargePlanCode: plan.code, rechargePlanVersion: plan.version, giftCents: plan.giftCents },
            } },
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
              amountCents: plan.principalCents,
              creationIdempotencyKeyPresent: Boolean(creation.creationIdempotencyKey),
              rechargePlanId: plan.id,
              rechargePlanCode: plan.code,
              rechargePlanVersion: plan.version,
              principalCents: plan.principalCents,
              giftCents: plan.giftCents,
            } as never,
          },
        })
        return created
      }),
    })
    return orderResponse(order)
  }

  private async createMembershipProductVersion(
    code: string,
    sourceProductId: string | null,
    dto: CreateMembershipProductDto | CreateMembershipProductVersionDto,
    actor: AuthUser,
  ) {
    this.assertMembershipProductAdministrator(actor)
    const effectiveFrom = new Date(dto.effectiveFrom)
    const effectiveTo = dto.effectiveTo ? new Date(dto.effectiveTo) : null
    if (effectiveTo && effectiveTo <= effectiveFrom)
      throw new BadRequestException('会员产品失效时间必须晚于生效时间')
    const reason = dto.reason.trim()
    const normalizedCode = code.trim()
    const command = {
      sourceProductId,
      code: normalizedCode,
      name: dto.name.trim(),
      level: dto.level,
      priceCents: dto.priceCents,
      durationDays: dto.durationDays,
      benefits: dto.benefits,
      effectiveFrom: effectiveFrom.toISOString(),
      effectiveTo: effectiveTo?.toISOString() ?? null,
      reason,
    }
    const hash = commandHash(command)

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        return await this.prisma.$transaction(async (tx) => {
          const replay = await tx.membershipProduct.findUnique({
            where: { creationIdempotencyKey: dto.idempotencyKey },
          })
          if (replay) {
            this.assertMembershipProductCreationReplay(replay, actor, hash)
            return membershipProductView(replay)
          }

          if (sourceProductId) {
            const source = await tx.membershipProduct.findUnique({
              where: { id: sourceProductId },
              select: { code: true },
            })
            if (!source) throw new NotFoundException('会员产品源版本不存在')
            if (source.code !== normalizedCode)
              throw new ConflictException('会员产品源版本编码已变化，请刷新后重试')
          }

          const latest = await tx.membershipProduct.aggregate({
            where: { code: normalizedCode },
            _max: { version: true },
          })
          if (!sourceProductId && latest._max.version !== null)
            throw new ConflictException('会员产品编码已存在，请从已有版本创建新版本')
          if (sourceProductId && latest._max.version === null)
            throw new ConflictException('会员产品版本链不存在，请刷新后重试')

          const created = await tx.membershipProduct.create({
            data: {
              code: normalizedCode,
              version: (latest._max.version ?? 0) + 1,
              name: command.name,
              level: dto.level,
              priceCents: dto.priceCents,
              durationDays: dto.durationDays,
              benefits: dto.benefits as Prisma.InputJsonValue,
              effectiveFrom,
              effectiveTo,
              enabled: false,
              creationIdempotencyKey: dto.idempotencyKey,
              creationCommandHash: hash,
              createdById: actor.sub,
            },
          })
          await tx.auditLog.create({
            data: {
              actorId: actor.sub,
              actorRole: this.masterDataAuditRole(actor),
              action: 'MEMBERSHIP_PRODUCT_VERSION_CREATED',
              objectType: 'MembershipProduct',
              objectId: created.id,
              reason,
              newValue: {
                sourceProductId,
                code: created.code,
                version: created.version,
                name: created.name,
                level: created.level,
                priceCents: created.priceCents,
                durationDays: created.durationDays,
                benefits: created.benefits,
                effectiveFrom: created.effectiveFrom.toISOString(),
                effectiveTo: created.effectiveTo?.toISOString() ?? null,
                enabled: false,
              } as never,
            },
          })
          return membershipProductView(created)
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
      } catch (error) {
        if (!isRetryableWriteConflict(error)) throw error
        const replay = await this.prisma.membershipProduct.findUnique({
          where: { creationIdempotencyKey: dto.idempotencyKey },
        })
        if (replay) {
          this.assertMembershipProductCreationReplay(replay, actor, hash)
          return membershipProductView(replay)
        }
        if (attempt === 3)
          throw new ConflictException('会员产品版本发生并发冲突，请刷新后重试')
      }
    }
    throw new ConflictException('会员产品版本发生并发冲突，请刷新后重试')
  }

  private assertMembershipProductReader(actor: AuthUser) {
    if (!actor.roles.some((role) => [
      AppRole.FRONT_DESK,
      AppRole.ADMIN,
      AppRole.SUPER_ADMIN,
    ].includes(role as never))) {
      throw new ForbiddenException('仅前台或管理员可查看会员产品版本')
    }
  }

  private assertMembershipProductAdministrator(actor: AuthUser) {
    if (!actor.roles.some((role) => [AppRole.ADMIN, AppRole.SUPER_ADMIN].includes(role as never)))
      throw new ForbiddenException('仅管理员可管理会员产品')
  }

  private assertMembershipProductCreationReplay(
    existing: { createdById: string; creationCommandHash: string },
    actor: AuthUser,
    hash: string,
  ) {
    if (existing.createdById !== actor.sub || existing.creationCommandHash !== hash)
      throw new ConflictException('会员产品创建幂等键已用于其他命令或操作人')
  }

  private assertMembershipProductTransitionReplay(
    existing: {
      membershipProductId: string
      actorId: string
      commandHash: string
    },
    productId: string,
    actor: AuthUser,
    hash: string,
  ) {
    if (
      existing.membershipProductId !== productId ||
      existing.actorId !== actor.sub ||
      existing.commandHash !== hash
    ) {
      throw new ConflictException('会员产品状态幂等键已用于其他命令或操作人')
    }
  }

  private masterDataAuditRole(actor: AuthUser) {
    return actor.roles.includes(AppRole.SUPER_ADMIN)
      ? AppRole.SUPER_ADMIN
      : AppRole.ADMIN
  }

  private assertRechargePlanAdministrator(actor: AuthUser) {
    if (!actor.roles.some((role) => [AppRole.ADMIN, AppRole.SUPER_ADMIN].includes(role as never)))
      throw new ForbiddenException('仅管理员可管理充值计划')
  }

  private assertRechargePlanCreationReplay(
    existing: { createdById: string; creationCommandHash: string },
    actor: AuthUser,
    hash: string,
  ) {
    if (existing.createdById !== actor.sub || existing.creationCommandHash !== hash)
      throw new ConflictException('充值计划创建幂等键已用于其他命令或操作人')
  }

  private assertRechargePlanTransitionReplay(
    existing: { planId: string; actorId: string; commandHash: string },
    planId: string,
    actor: AuthUser,
    hash: string,
  ) {
    if (
      existing.planId !== planId ||
      existing.actorId !== actor.sub ||
      existing.commandHash !== hash
    ) {
      throw new ConflictException('充值计划状态幂等键已用于其他命令或操作人')
    }
  }
}
