import { randomBytes } from 'node:crypto'

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
  AccountTxnKind,
  AccountType,
  AppRole,
  BookingStatus,
  BusinessType,
  CourtUsage,
  GameStatus,
  HostStatus,
  OrderStatus,
  Prisma,
  RegistrationStatus,
  RewardStatus,
  SourceChannel,
  SubjectAccount,
} from '../generated/prisma/client.js'
import {
  GAME_CAPACITY_MAX,
  GAME_CAPACITY_MIN,
  type CreateGameDto,
  type PublishGameDto,
  type RegisterGameDto,
  type RejectHostDto,
  type ReviewHostDto,
} from './games.dto.js'
import {
  executeOrderCreation,
  orderCreationCommandHash,
  type OrderCreationFields,
} from '../orders/order-creation-idempotency.js'

const serial = (prefix: string) =>
  `${prefix}${new Date().toISOString().replace(/\D/g, '').slice(0, 14)}${randomBytes(3).toString('hex').toUpperCase()}`

const isValidGameCapacity = (capacity: number) =>
  Number.isInteger(capacity) && capacity >= GAME_CAPACITY_MIN && capacity <= GAME_CAPACITY_MAX

const DEFAULT_HOST_REWARD_OBSERVATION_DAYS = 7
const HOST_REWARD_OBSERVATION_PARAMETER_KEYS = [
  'game.host_reward.refund_observation_days',
  // Keep compatibility with the parameter already shipped in the first
  // migration.  Operators can introduce the game-specific key later without
  // changing the reward workflow.
  'referral.refund_observation_days',
] as const

const GAME_STATUSES_ALLOWED_TO_COMPLETE: readonly GameStatus[] = [
  GameStatus.OPEN,
  GameStatus.FULL,
  GameStatus.IN_PROGRESS,
]

const GAME_STATUSES_NOT_PUBLISHABLE: readonly GameStatus[] = [
  GameStatus.CANCELLED,
  GameStatus.FULL,
  GameStatus.IN_PROGRESS,
  GameStatus.COMPLETED,
]

const ORDER_STATUSES_REFUNDED: readonly OrderStatus[] = [
  OrderStatus.REFUNDED,
  // A checked-in registration that has been partially refunded must not
  // continue to earn the full host incentive.  The current reward model is
  // count-based (not prorated), so it is conservatively excluded and remains
  // visible in the audit evidence for a manual adjustment if needed.
  OrderStatus.PARTIALLY_REFUNDED,
  OrderStatus.CANCELLED,
]

const ORDER_STATUSES_REFUND_PENDING: readonly OrderStatus[] = [
  OrderStatus.REFUND_PENDING,
]

// A registration occupies a seat from the moment a pending order is created
// until it is cancelled/refunded.  WAITLISTED is deliberately excluded: it
// has no order and must never make the game look full by itself.
const GAME_SEAT_STATUSES: readonly RegistrationStatus[] = [
  RegistrationStatus.REGISTERED,
  RegistrationStatus.PAID,
  RegistrationStatus.CHECKED_IN,
  RegistrationStatus.COMPLETED,
]

const FINANCIAL_ROLES: readonly AppRole[] = [
  AppRole.FINANCE,
  AppRole.ADMIN,
  AppRole.SUPER_ADMIN,
]

type RewardRuleSnapshot = {
  rewardType: string
  perCheckedIn: number
  cap: number
}

type RegistrationForReward = {
  id: string
  userId: string
  status: RegistrationStatus
  checkedInAt?: Date | null
  order?: {
    id: string
    status: OrderStatus
    paidCents?: number
    refundedCents?: number
  } | null
}

type RewardEligibility = {
  eligible: RegistrationForReward[]
  excludedRefunded: RegistrationForReward[]
  pendingRefund: RegistrationForReward[]
}

/**
 * Claim the oldest waiting member when a paid seat is released.  This helper
 * is exported so the refund workflow can use the same state transition as an
 * operations operator.  It deliberately creates a fresh pending order (the
 * member still has to pay); no balance or reward is touched here.
 */
export async function promoteNextGameWaitlist(
  tx: Prisma.TransactionClient,
  gameId: string,
  actorId: string,
  actorRole: AppRole,
) {
  const game = await tx.game.findUnique({
    where: { id: gameId },
    select: { id: true, title: true, hostId: true, feeCents: true, capacity: true, status: true },
  })
  if (!game || (game.status !== GameStatus.OPEN && game.status !== GameStatus.FULL)) return null
  if (!isValidGameCapacity(game.capacity)) return null

  const seated = await tx.gameRegistration.count({
    where: { gameId, status: { in: [...GAME_SEAT_STATUSES] } },
  })
  if (seated >= game.capacity) return null
  const next = await tx.gameRegistration.findFirst({
    where: { gameId, status: RegistrationStatus.WAITLISTED, orderId: null },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: { id: true, userId: true },
  })
  if (!next) {
    if (game.status === GameStatus.FULL) {
      await tx.game.updateMany({ where: { id: gameId, status: GameStatus.FULL }, data: { status: GameStatus.OPEN } })
    }
    return null
  }

  // Claim the row before creating the order.  The conditional update is the
  // compare-and-set boundary that prevents two refund workers from creating
  // two orders for the same waiting member.
  const claimed = await tx.gameRegistration.updateMany({
    where: { id: next.id, status: RegistrationStatus.WAITLISTED, orderId: null },
    data: { status: RegistrationStatus.REGISTERED },
  })
  if (claimed.count !== 1) return null

  const order = await tx.order.create({
    data: {
      creationIdempotencyKey: `SYSTEM:GAME_WAITLIST:${next.id}`,
      creationCommandHash: orderCreationCommandHash({
        kind: 'GAME_WAITLIST_PROMOTION', gameId, registrationId: next.id, memberId: next.userId,
      }),
      orderNo: serial('GO'),
      memberId: next.userId,
      businessType: BusinessType.GAME,
      subjectAccount: SubjectAccount.VENUE,
      sourceChannel: SourceChannel.MINI_PROGRAM,
      status: OrderStatus.PENDING,
      title: game.title,
      listAmountCents: game.feeCents,
      payableCents: game.feeCents,
      parameterSnapshot: { gameId, hostId: game.hostId, promotedFromWaitlist: true },
      items: {
        create: {
          itemType: 'GAME_REGISTRATION',
          itemId: gameId,
          name: game.title,
          unitPriceCents: game.feeCents,
          amountCents: game.feeCents,
        },
      },
    },
  })
  const registration = await tx.gameRegistration.update({
    where: { id: next.id },
    data: { orderId: order.id },
  })
  await tx.game.updateMany({
    where: { id: gameId, status: { in: [GameStatus.OPEN, GameStatus.FULL] } },
    data: { status: seated + 1 >= game.capacity ? GameStatus.FULL : GameStatus.OPEN },
  })
  await tx.auditLog.create({
    data: {
      actorId,
      actorRole,
      action: 'GAME_WAITLIST_PROMOTED',
      objectType: 'GameRegistration',
      objectId: registration.id,
      newValue: { gameId, orderId: order.id, userId: next.userId } as never,
    },
  })
  return { order, registration }
}

@Injectable()
export class GamesService {
  constructor(private readonly prisma: PrismaService) {}

  list() {
    return this.prisma.game.findMany({
      include: {
        host: { select: { id: true, displayName: true, avatarUrl: true } },
        _count: {
          select: {
            registrations: { where: { status: { in: [...GAME_SEAT_STATUSES] } } },
          },
        },
        courtBookings: { include: { court: true } },
      },
      orderBy: { startsAt: 'desc' },
    })
  }

  myHosted(actor: AuthUser) {
    return this.prisma.game.findMany({
      where: { hostId: actor.sub },
      include: { registrations: { include: { user: { select: { displayName: true } } } }, hostRewards: true },
      orderBy: { startsAt: 'desc' },
    })
  }

  async applyHost(actor: AuthUser) {
    if (!actor.roles.includes(AppRole.MEMBER)) {
      throw new ForbiddenException('仅会员可申请成为球局主理人')
    }
    const existing = await this.prisma.hostProfile.findUnique({ where: { userId: actor.sub } })
    if (existing?.status === HostStatus.APPROVED) throw new ConflictException('已经是球局主理人')
    if (existing?.status === HostStatus.APPLIED) return existing
    return this.prisma.$transaction(async (tx) => {
      const profile = await tx.hostProfile.upsert({
        where: { userId: actor.sub },
        update: { status: HostStatus.APPLIED, appliedAt: new Date(), approvedAt: null, suspendedReason: null },
        create: { userId: actor.sub, status: HostStatus.APPLIED },
      })
      await tx.auditLog.create({
        data: {
          actorId: actor.sub,
          actorRole: actor.roles[0],
          action: 'HOST_APPLIED',
          objectType: 'HostProfile',
          objectId: profile.id,
          oldValue: existing ? { status: existing.status } as never : undefined,
          newValue: { status: HostStatus.APPLIED } as never,
        },
      })
      return profile
    })
  }

  hostApplications() {
    return this.prisma.hostProfile.findMany({
      where: { status: HostStatus.APPLIED },
      select: {
        id: true,
        userId: true,
        status: true,
        appliedAt: true,
        user: { select: { id: true, displayName: true, phone: true, memberProfile: { select: { level: true, visitCount: true } } } },
      },
      orderBy: { appliedAt: 'asc' },
    })
  }

  async approveHost(userId: string, dto: ReviewHostDto, actor: AuthUser) {
    return this.prisma.$transaction(async (tx) => {
      const profile = await tx.hostProfile.findUnique({ where: { userId } })
      if (!profile) throw new NotFoundException('主理人申请不存在')
      if (profile.status === HostStatus.APPROVED) return profile
      if (profile.status !== HostStatus.APPLIED) throw new ConflictException('只有待审批申请可以通过')
      const updated = await tx.hostProfile.update({
        where: { userId },
        data: { status: HostStatus.APPROVED, approvedAt: new Date(), suspendedReason: null },
      })
      const role = await tx.userRole.findFirst({
        where: { userId, role: AppRole.HOST, merchantId: null },
      })
      if (!role) await tx.userRole.create({ data: { userId, role: AppRole.HOST } })
      await tx.auditLog.create({
        data: {
          actorId: actor.sub,
          actorRole: actor.roles[0],
          action: 'HOST_APPROVED',
          objectType: 'HostProfile',
          objectId: profile.id,
          reason: dto.reason,
        },
      })
      return updated
    })
  }

  async rejectHost(userId: string, dto: RejectHostDto, actor: AuthUser) {
    const reason = dto.reason.trim()
    if (reason.length < 2) throw new BadRequestException('驳回原因不能为空')
    return this.prisma.$transaction(async (tx) => {
      const profile = await tx.hostProfile.findUnique({ where: { userId } })
      if (!profile) throw new NotFoundException('主理人申请不存在')
      if (profile.status === HostStatus.REJECTED && profile.suspendedReason === reason) return profile
      if (profile.status !== HostStatus.APPLIED) throw new ConflictException('只有待审批申请可以驳回')
      const updated = await tx.hostProfile.update({
        where: { userId },
        data: { status: HostStatus.REJECTED, approvedAt: null, suspendedReason: reason },
      })
      await tx.userRole.deleteMany({ where: { userId, role: AppRole.HOST } })
      await tx.auditLog.create({
        data: {
          actorId: actor.sub,
          actorRole: actor.roles[0],
          action: 'HOST_REJECTED',
          objectType: 'HostProfile',
          objectId: profile.id,
          oldValue: { status: profile.status } as never,
          newValue: { status: HostStatus.REJECTED } as never,
          reason,
        },
      })
      return updated
    })
  }

  async create(dto: CreateGameDto, actor: AuthUser) {
    if (!actor.roles.some((role) => [AppRole.HOST, AppRole.ADMIN, AppRole.SUPER_ADMIN].includes(role as never))) {
      throw new ForbiddenException('仅已授权主理人或管理员可创建球局')
    }
    const host = await this.prisma.hostProfile.findUnique({ where: { userId: actor.sub } })
    if (host?.status !== HostStatus.APPROVED && !actor.roles.some((role) => [AppRole.ADMIN, AppRole.SUPER_ADMIN].includes(role as never))) {
      throw new ConflictException('主理人申请尚未通过')
    }
    const title = dto.title.trim()
    if (!title) throw new BadRequestException('球局标题不能为空')
    const startsAt = new Date(dto.startsAt)
    const endsAt = new Date(dto.endsAt)
    if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())) {
      throw new BadRequestException('球局时间无效')
    }
    if (endsAt <= startsAt) throw new BadRequestException('球局结束时间必须晚于开始时间')
    if (startsAt <= new Date()) throw new BadRequestException('球局开始时间必须晚于当前时间')
    if (new Set(dto.courtIds).size !== dto.courtIds.length) throw new BadRequestException('场地不能重复')
    if (!isValidGameCapacity(dto.capacity)) {
      throw new BadRequestException(`普通主理人球局人数上限必须在${GAME_CAPACITY_MIN}-${GAME_CAPACITY_MAX}人之间`)
    }
    if (!Number.isInteger(dto.feeCents) || dto.feeCents < 0) {
      throw new BadRequestException('球局费用必须为非负整数')
    }

    return this.prisma.$transaction(
      async (tx) => {
        const courts = await tx.court.findMany({
          where: { id: { in: dto.courtIds }, enabled: true },
          select: { id: true, usage: true },
        })
        if (courts.length !== dto.courtIds.length) throw new NotFoundException('部分场地不存在或已停用')
        if (courts.some((court) => court.usage === CourtUsage.MAINTENANCE || court.usage === CourtUsage.TRAINING)) {
          throw new ConflictException('球局不能使用维护场或培训专用场')
        }
        const closure = await tx.courtClosure.findFirst({
          where: {
            courtId: { in: dto.courtIds },
            status: 'ACTIVE',
            startsAt: { lt: endsAt },
            endsAt: { gt: startsAt },
          },
          select: { id: true, reason: true },
        })
        if (closure) throw new ConflictException(`所选场地时段已封场：${closure.reason}`)
        const conflict = await tx.courtBooking.findFirst({
          where: {
            courtId: { in: dto.courtIds },
            status: { not: BookingStatus.CANCELLED },
            startsAt: { lt: endsAt },
            endsAt: { gt: startsAt },
          },
        })
        if (conflict) throw new ConflictException('所选场地时段已被占用')
        const game = await tx.game.create({
          data: {
            code: serial('GM'),
            title,
            hostId: actor.sub,
            level: dto.level,
            // Publishing is an explicit review action.  Keeping drafts out of
            // the member list prevents an incomplete game from being booked.
            status: GameStatus.DRAFT,
            startsAt,
            endsAt,
            capacity: dto.capacity,
            feeCents: dto.feeCents,
            description: dto.description,
            rewardRule: (dto.rewardRule ?? { type: 'BADMINTON_COIN', perCheckedIn: 20, cap: 500 }) as never,
          },
        })
        await tx.courtBooking.createMany({
          data: dto.courtIds.map((courtId) => ({
            courtId,
            memberId: actor.sub,
            status: BookingStatus.CONFIRMED,
            startsAt,
            endsAt,
            usage: CourtUsage.RETAIL,
            gameId: game.id,
            note: `主理人球局 ${game.code}`,
          })),
        })
        await tx.auditLog.create({
          data: {
            actorId: actor.sub,
            actorRole: actor.roles[0],
            action: 'GAME_CREATED',
            objectType: 'Game',
            objectId: game.id,
            newValue: {
              status: GameStatus.DRAFT,
              title,
              startsAt,
              endsAt,
              courtIds: dto.courtIds,
              capacity: dto.capacity,
              feeCents: dto.feeCents,
            } as never,
          },
        })
        return game
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    )
  }

  /** Move a reviewed draft into the member-facing registration period. */
  async publish(gameId: string, dto: PublishGameDto | undefined, actor: AuthUser) {
    if (!actor.roles.some((role) => [AppRole.HOST, AppRole.ADMIN, AppRole.SUPER_ADMIN].includes(role as never))) {
      throw new ForbiddenException('仅本局主理人或管理员可发布球局')
    }
    const reason = dto?.reason?.trim() || undefined
    return this.prisma.$transaction(
      async (tx) => {
        const game = await tx.game.findUnique({
          where: { id: gameId },
          include: { host: { include: { hostProfile: true } }, courtBookings: { include: { court: true } } },
        })
        if (!game) throw new NotFoundException('球局不存在')
        this.assertGameOperator(game.hostId, actor)
        if (game.status === GameStatus.OPEN) return game
        if (GAME_STATUSES_NOT_PUBLISHABLE.includes(game.status)) {
          throw new ConflictException(`球局当前状态为 ${game.status}，不能发布`)
        }
        if (game.host.hostProfile?.status !== HostStatus.APPROVED && !actor.roles.some((role) => [AppRole.ADMIN, AppRole.SUPER_ADMIN].includes(role as never))) {
          throw new ConflictException('主理人资质尚未通过，不能发布球局')
        }
        if (game.startsAt <= new Date() || game.endsAt <= game.startsAt) {
          throw new ConflictException('球局时间已过期或设置无效')
        }
        if (!isValidGameCapacity(game.capacity)) {
          throw new ConflictException(`普通主理人球局人数上限必须在${GAME_CAPACITY_MIN}-${GAME_CAPACITY_MAX}人之间`)
        }
        if (game.courtBookings.length === 0) throw new ConflictException('球局尚未绑定场地')
        if (game.courtBookings.some((booking) => booking.status === BookingStatus.CANCELLED || !booking.court.enabled)) {
          throw new ConflictException('球局绑定的场地不可用')
        }
        const changed = await tx.game.updateMany({
          where: { id: gameId, status: GameStatus.DRAFT },
          data: { status: GameStatus.OPEN },
        })
        if (changed.count !== 1) {
          const latest = await tx.game.findUnique({ where: { id: gameId } })
          if (latest?.status === GameStatus.OPEN) return latest
          throw new ConflictException('球局已被其他操作更新，请刷新后重试')
        }
        const published = await tx.game.findUniqueOrThrow({ where: { id: gameId } })
        await tx.auditLog.create({
          data: {
            actorId: actor.sub,
            actorRole: actor.roles[0],
            action: 'GAME_PUBLISHED',
            objectType: 'Game',
            objectId: gameId,
            oldValue: { status: GameStatus.DRAFT } as never,
            newValue: { status: GameStatus.OPEN, reason } as never,
            reason,
          },
        })
        return published
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    )
  }

  async register(gameId: string, dto: RegisterGameDto, actor: AuthUser) {
    return executeOrderCreation(this.prisma, {
      memberId: actor.sub,
      creationIdempotencyKey: dto.creationIdempotencyKey,
      command: { kind: 'GAME_REGISTRATION', gameId, sourceChannel: dto.sourceChannel },
      loadExisting: (id) => this.prisma.order.findUniqueOrThrow({ where: { id }, include: { gameRegistration: true } }),
      create: (creation) => this.registerOnce(gameId, dto, actor, creation),
    })
  }

  private async registerOnce(gameId: string, dto: RegisterGameDto, actor: AuthUser, creation: OrderCreationFields) {
    return this.prisma.$transaction(
      async (tx) => {
        const game = await tx.game.findUnique({
          where: { id: gameId },
          select: {
            id: true,
            title: true,
            hostId: true,
            feeCents: true,
            capacity: true,
            status: true,
          },
        })
        // FULL still accepts a waitlist entry.  It is a member-facing
        // registration state, not a hard stop, so the first released seat can
        // be offered to the oldest waiting member.
        if (!game || (game.status !== GameStatus.OPEN && game.status !== GameStatus.FULL)) {
          throw new NotFoundException('球局不在报名中')
        }
        if (!isValidGameCapacity(game.capacity)) {
          throw new ConflictException(`普通主理人球局人数上限必须在${GAME_CAPACITY_MIN}-${GAME_CAPACITY_MAX}人之间`)
        }
        const duplicate = await tx.gameRegistration.findUnique({
          where: { gameId_userId: { gameId, userId: actor.sub } },
        })
        if (duplicate?.status === RegistrationStatus.WAITLISTED) {
          const queue = await tx.gameRegistration.findMany({
            where: { gameId, status: RegistrationStatus.WAITLISTED },
            select: { id: true },
            orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          })
          const queueIndex = queue.findIndex((item) => item.id === duplicate.id)
          return {
            registration: duplicate,
            waitlistPosition: queueIndex >= 0 ? queueIndex + 1 : 1,
            status: RegistrationStatus.WAITLISTED,
          }
        }
        if (duplicate && GAME_SEAT_STATUSES.includes(duplicate.status)) {
          throw new ConflictException('已经报名该球局或正在候补')
        }

        const seated = await tx.gameRegistration.count({
          where: { gameId, status: { in: [...GAME_SEAT_STATUSES] } },
        })
        const waitlisted = await tx.gameRegistration.count({
          where: { gameId, status: RegistrationStatus.WAITLISTED },
        })
        // If a seat was released while an older waitlist entry is still
        // pending promotion, preserve FIFO order: a new caller joins behind
        // that entry instead of jumping the queue.
        if (seated >= game.capacity || waitlisted > 0) {
          const registration = duplicate
            ? await tx.gameRegistration.update({
                where: { id: duplicate.id },
                data: {
                  status: RegistrationStatus.WAITLISTED,
                  orderId: null,
                  checkedInAt: null,
                },
              })
            : await tx.gameRegistration.create({
                data: {
                  gameId,
                  userId: actor.sub,
                  status: RegistrationStatus.WAITLISTED,
                },
              })
          await tx.game.updateMany({
            where: { id: gameId, status: { in: [GameStatus.OPEN, GameStatus.FULL] } },
            data: { status: GameStatus.FULL },
          })
          await tx.auditLog.create({
            data: {
              actorId: actor.sub,
              actorRole: actor.roles[0],
              action: 'GAME_WAITLISTED',
              objectType: 'GameRegistration',
              objectId: registration.id,
              newValue: {
                gameId,
                status: RegistrationStatus.WAITLISTED,
                position: waitlisted + 1,
              } as never,
            },
          })
          return {
            registration,
            waitlistPosition: waitlisted + 1,
            status: RegistrationStatus.WAITLISTED,
          }
        }

        const order = await tx.order.create({
          data: {
            ...creation,
            orderNo: serial('GO'),
            memberId: actor.sub,
            createdById: actor.sub,
            businessType: BusinessType.GAME,
            subjectAccount: SubjectAccount.VENUE,
            sourceChannel: dto.sourceChannel,
            status: OrderStatus.PENDING,
            title: game.title,
            listAmountCents: game.feeCents,
            payableCents: game.feeCents,
            parameterSnapshot: { gameId, hostId: game.hostId },
            items: {
              create: {
                itemType: 'GAME_REGISTRATION',
                itemId: gameId,
                name: game.title,
                unitPriceCents: game.feeCents,
                amountCents: game.feeCents,
              },
            },
            gameRegistration: duplicate
              ? undefined
              : { create: { gameId, userId: actor.sub } },
          },
          include: { gameRegistration: true },
        })
        await tx.auditLog.create({
          data: {
            actorId: actor.sub,
            actorRole: actor.roles[0],
            action: 'GAME_ORDER_CREATED',
            objectType: 'Order',
            objectId: order.id,
            newValue: {
              memberId: actor.sub,
              createdById: actor.sub,
              businessType: BusinessType.GAME,
              amountCents: game.feeCents,
              creationIdempotencyKeyPresent: Boolean(creation.creationIdempotencyKey),
              gameId,
              hostId: game.hostId,
              gameRegistrationId: order.gameRegistration?.id ?? duplicate?.id,
              sourceChannel: dto.sourceChannel,
            } as never,
          },
        })
        if (duplicate) {
          // Reuse a terminal historical row rather than violating the
          // [gameId,userId] uniqueness constraint.  The old order remains in
          // the audit trail; this new order becomes the active registration.
          const registration = await tx.gameRegistration.update({
            where: { id: duplicate.id },
            data: {
              status: RegistrationStatus.REGISTERED,
              orderId: order.id,
              checkedInAt: null,
            },
          })
          return { ...order, gameRegistration: registration }
        }
        if (seated + 1 >= game.capacity) {
          await tx.game.updateMany({
            where: { id: gameId, status: GameStatus.OPEN },
            data: { status: GameStatus.FULL },
          })
        }
        return order
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    )
  }

  /** Manually retry a waitlist promotion from the operations workbench. */
  async promoteWaitlist(gameId: string, actor: AuthUser) {
    if (!actor.roles.some((role) => [
      AppRole.HOST,
      AppRole.FRONT_DESK,
      AppRole.FINANCE,
      AppRole.ADMIN,
      AppRole.SUPER_ADMIN,
    ].includes(role as never))) {
      throw new ForbiddenException('仅本局主理人、前台、财务或管理员可处理球局候补')
    }
    return this.prisma.$transaction(
      async (tx) => {
        const game = await tx.game.findUnique({ where: { id: gameId }, select: { id: true, hostId: true } })
        if (!game) throw new NotFoundException('球局不存在')
        const hostOnly = actor.roles.includes(AppRole.HOST) && !actor.roles.some((role) => [
          AppRole.FRONT_DESK,
          AppRole.FINANCE,
          AppRole.ADMIN,
          AppRole.SUPER_ADMIN,
        ].includes(role as never))
        if (hostOnly) this.assertGameOperator(game.hostId, actor)
        return promoteNextGameWaitlist(tx, gameId, actor.sub, actor.roles[0])
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    )
  }

  async checkIn(gameId: string, userId: string, actor: AuthUser) {
    return this.prisma.$transaction(async (tx) => {
      const registration = await tx.gameRegistration.findUnique({
        where: { gameId_userId: { gameId, userId } },
        include: {
          game: { select: { id: true, hostId: true, status: true } },
          order: { select: { id: true, status: true, paidCents: true, refundedCents: true } },
        },
      })
      if (!registration) throw new NotFoundException('报名记录不存在')
      // Front desk staff may scan a member on behalf of the host.  A user
      // carrying only the HOST role, however, remains restricted to games they
      // own; this prevents one host from altering another host's attendance.
      this.assertGameOperator(registration.game.hostId, actor, { allowFrontDesk: true })

      // A repeated scan is a safe no-op.  This matters when the front desk
      // retries after a network timeout and prevents the audit stream from
      // pretending that the member checked in multiple times.
      if (registration.status === RegistrationStatus.CHECKED_IN) return registration
      if (registration.status !== RegistrationStatus.PAID) {
        throw new ConflictException('报名未支付或不存在')
      }
      if (registration.order && ORDER_STATUSES_REFUNDED.includes(registration.order.status)) {
        throw new ConflictException('该报名已退款，不能签到')
      }
      if (
        registration.game.status === GameStatus.CANCELLED ||
        registration.game.status === GameStatus.COMPLETED
      ) {
        throw new ConflictException('球局已结束或取消，不能签到')
      }
      const checkedInAt = new Date()
      const updated = await tx.gameRegistration.update({
        where: { id: registration.id },
        data: { status: RegistrationStatus.CHECKED_IN, checkedInAt },
      })
      await tx.auditLog.create({
        data: {
          actorId: actor.sub,
          actorRole: actor.roles[0],
          action: 'GAME_CHECKED_IN',
          objectType: 'GameRegistration',
          objectId: registration.id,
          oldValue: { status: registration.status } as never,
          newValue: { status: RegistrationStatus.CHECKED_IN, checkedInAt: checkedInAt.toISOString() } as never,
        },
      })
      return updated
    })
  }

  async complete(gameId: string, actor: AuthUser) {
    return this.prisma.$transaction(
      async (tx) => {
        const game = await tx.game.findUnique({
          where: { id: gameId },
          include: {
            registrations: {
              include: {
                order: { select: { id: true, status: true, paidCents: true, refundedCents: true } },
              },
            },
          },
        })
        if (!game) throw new NotFoundException('球局不存在')
        this.assertGameOperator(game.hostId, actor)

        if (
          game.status !== GameStatus.COMPLETED &&
          !GAME_STATUSES_ALLOWED_TO_COMPLETE.includes(game.status)
        ) {
          throw new ConflictException('当前球局状态不允许结束')
        }
        // A host may close an OPEN/FULL/IN_PROGRESS game only after its
        // scheduled start.  Without this gate a mistaken tap (or a replayed
        // request from the member client) could create a reward observation
        // window for a game that never happened.  Keep the COMPLETED branch
        // idempotent above this check so historical retries remain readable.
        if (game.status !== GameStatus.COMPLETED) {
          const startsAt = game.startsAt instanceof Date ? game.startsAt : new Date(String(game.startsAt))
          if (Number.isNaN(startsAt.getTime())) throw new ConflictException('球局开始时间无效，不能结束并结算')
          if (startsAt > new Date()) throw new ConflictException('球局尚未开始，不能结束并结算')
        }

        // Read the existing unique reward first so a completed retry can
        // return the immutable result without touching the game or ledgers.
        const existingReward = await tx.hostReward.findFirst({
          where: { gameId },
          orderBy: { createdAt: 'asc' },
        })
        if (game.status === GameStatus.COMPLETED) {
          if (existingReward) {
            return { checkedIn: existingReward.basisCount, reward: existingReward }
          }
          // Repair a legacy completed game that predates host reward rows.
          // The repair still uses the immutable check-in evidence and starts a
          // fresh observation window, so it cannot award recruitment alone.
          const now = new Date()
          const eligibility = this.rewardEligibility(game.registrations)
          const rule = this.rewardRuleSnapshot(game.rewardRule)
          const observationEndsAt = await this.observationEndsAt(tx, now)
          const reward = await this.createHostReward(tx, game, gameId, eligibility, rule, observationEndsAt)
          await this.writeCompletionAudit(tx, actor, game, reward, eligibility, observationEndsAt, true)
          return { checkedIn: eligibility.eligible.length, reward }
        }
        const now = new Date()
        const eligibility = this.rewardEligibility(game.registrations)
        const rule = this.rewardRuleSnapshot(game.rewardRule)
        const observationEndsAt = await this.observationEndsAt(tx, now)
        const reward = existingReward ?? await this.createHostReward(
          tx,
          game,
          gameId,
          eligibility,
          rule,
          observationEndsAt,
        )

        await tx.game.update({ where: { id: gameId }, data: { status: GameStatus.COMPLETED } })
        await tx.courtBooking.updateMany({
          where: { gameId },
          data: { status: BookingStatus.COMPLETED },
        })
        await this.writeCompletionAudit(tx, actor, game, reward, eligibility, observationEndsAt, false)
        return { checkedIn: reward.basisCount, reward }
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    )
  }

  /**
   * Mature host rewards after the refund observation window.  This is a
   * finance operation: the host can create/finish their own game, but cannot
   * unilaterally release money into an account.
   */
  async grantMatured(actor: AuthUser) {
    this.assertFinancialOperator(actor)
    const now = new Date()
    const candidates = await this.prisma.hostReward.findMany({
      where: {
        status: { in: [RewardStatus.PENDING_OBSERVATION, RewardStatus.AVAILABLE] },
        availableAt: { lte: now },
      },
      orderBy: { availableAt: 'asc' },
      take: 500,
    })

    const results: unknown[] = []
    for (const candidate of candidates) {
      const result = await this.prisma.$transaction(
        async (tx) => {
          const reward = await tx.hostReward.findUnique({
            where: { id: candidate.id },
            include: {
              game: {
                include: {
                  registrations: {
                    include: {
                      order: { select: { id: true, status: true, paidCents: true, refundedCents: true } },
                    },
                  },
                },
              },
            },
          })
          if (!reward) return null
          if (
            reward.status !== RewardStatus.PENDING_OBSERVATION &&
            reward.status !== RewardStatus.AVAILABLE
          ) {
            return reward
          }
          if (!reward.availableAt || reward.availableAt > now) return reward

          const eligibility = this.rewardEligibility(reward.game.registrations)
          if (eligibility.pendingRefund.length) {
            // A refund request is not enough evidence to claw back a reward;
            // hold it in AVAILABLE until the refund reaches a terminal state.
            if (reward.status !== RewardStatus.AVAILABLE) {
              const held = await tx.hostReward.update({
                where: { id: reward.id },
                data: { status: RewardStatus.AVAILABLE },
              })
              await this.writeRewardAudit(tx, actor, reward, 'GAME_HOST_REWARD_HELD_REFUND_REVIEW', {
                pendingRefundRegistrationIds: eligibility.pendingRefund.map((item) => item.id),
                observationEndsAt: reward.availableAt.toISOString(),
              })
              return held
            }
            return reward
          }

          const rule = this.rewardRuleSnapshot(reward.game.rewardRule)
          const recalculatedValue = Math.min(rule.cap, eligibility.eligible.length * rule.perCheckedIn)
          let currentReward = reward
          if (
            reward.basisCount !== eligibility.eligible.length ||
            reward.rewardValue !== recalculatedValue
          ) {
            await tx.hostReward.update({
              where: { id: reward.id },
              data: {
                basisCount: eligibility.eligible.length,
                rewardValue: recalculatedValue,
              },
            })
            currentReward = {
              ...reward,
              basisCount: eligibility.eligible.length,
              rewardValue: recalculatedValue,
            }
            await this.writeRewardAudit(tx, actor, reward, 'GAME_HOST_REWARD_RECALCULATED', {
              oldBasisCount: reward.basisCount,
              oldRewardValue: reward.rewardValue,
              basisCount: eligibility.eligible.length,
              rewardValue: recalculatedValue,
              excludedRefundedRegistrationIds: eligibility.excludedRefunded.map((item) => item.id),
            })
          }

          if (recalculatedValue <= 0) {
            const reversed = await tx.hostReward.update({
              where: { id: reward.id },
              data: { status: RewardStatus.REVERSED },
            })
            await this.writeRewardAudit(tx, actor, currentReward, 'GAME_HOST_REWARD_REVERSED', {
              reason: '观察期内没有可计奖的真实签到',
              excludedRefundedRegistrationIds: eligibility.excludedRefunded.map((item) => item.id),
            })
            return reversed
          }

          const accountType = this.rewardAccountType(currentReward.rewardType)
          if (!accountType) {
            const rejected = await tx.hostReward.update({
              where: { id: reward.id },
              data: { status: RewardStatus.REJECTED },
            })
            await this.writeRewardAudit(tx, actor, currentReward, 'GAME_HOST_REWARD_REJECTED', {
              reason: `奖励类型 ${currentReward.rewardType} 没有对应账户`,
            })
            return rejected
          }

          const idempotencyKey = `GAME_HOST_REWARD:${currentReward.id}`
          const existingTransaction = await tx.accountTransaction.findUnique({
            where: { idempotencyKey },
          })
          if (existingTransaction) {
            if (existingTransaction.amount !== recalculatedValue) {
              throw new ConflictException('主理人奖励账务与奖励记录金额不一致，请人工核对')
            }
            const recovered = await tx.hostReward.update({
              where: { id: currentReward.id },
              data: { status: RewardStatus.GRANTED, grantedAt: currentReward.grantedAt ?? now },
            })
            await this.writeRewardAudit(tx, actor, currentReward, 'GAME_HOST_REWARD_GRANTED_RECOVERED', {
              idempotencyKey,
              accountTransactionId: existingTransaction.id,
            })
            return recovered
          }

          const account = await tx.account.upsert({
            where: { userId_type: { userId: currentReward.hostId, type: accountType } },
            update: {},
            create: { userId: currentReward.hostId, type: accountType },
          })
          const balanceBefore = account.balance
          const accountVersion = typeof account.version === 'number' ? account.version : 0
          const updatedAccount = await tx.account.updateMany({
            where: { id: account.id, version: accountVersion },
            data: { balance: { increment: recalculatedValue }, version: { increment: 1 } },
          })
          if (updatedAccount.count !== 1) {
            throw new ConflictException('主理人账户余额已变化，请重试')
          }
          const accountTransaction = await tx.accountTransaction.create({
            data: {
              accountId: account.id,
              kind: AccountTxnKind.CREDIT,
              amount: recalculatedValue,
              balanceBefore,
              balanceAfter: balanceBefore + recalculatedValue,
              reasonCode: 'GAME_HOST_REWARD',
              reason: `球局 ${currentReward.game.code} 主理人签到奖励`,
              operatorId: actor.sub,
              idempotencyKey,
              metadata: {
                gameId: currentReward.gameId,
                rewardId: currentReward.id,
                basisCount: eligibility.eligible.length,
                checkedInRegistrationIds: eligibility.eligible.map((item) => item.id),
                excludedRefundedRegistrationIds: eligibility.excludedRefunded.map((item) => item.id),
                observationEndsAt: currentReward.availableAt?.toISOString() ?? null,
              },
            } as never,
          })
          const granted = await tx.hostReward.update({
            where: { id: currentReward.id },
            data: { status: RewardStatus.GRANTED, grantedAt: now },
          })
          await this.writeRewardAudit(tx, actor, currentReward, 'GAME_HOST_REWARD_GRANTED', {
            accountId: account.id,
            accountTransactionId: accountTransaction.id,
            idempotencyKey,
            basisCount: eligibility.eligible.length,
            rewardValue: recalculatedValue,
          })
          return granted
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      )
      if (result) results.push(result)
    }
    return { processed: results.length, results }
  }

  private assertGameOperator(
    hostId: string,
    actor: AuthUser,
    options: { allowFrontDesk?: boolean } = {},
  ): void {
    const elevated = actor.roles.some((role) =>
      [AppRole.ADMIN, AppRole.SUPER_ADMIN].includes(role as never),
    )
    const frontDesk = options.allowFrontDesk && actor.roles.includes(AppRole.FRONT_DESK)
    if (hostId !== actor.sub && !elevated && !frontDesk) {
      throw new ForbiddenException('只有本局主理人或管理员可操作该球局')
    }
  }

  private assertFinancialOperator(actor: AuthUser): void {
    if (!actor.roles.some((role) => FINANCIAL_ROLES.includes(role))) {
      throw new ForbiddenException('只有财务或管理员可发放主理人奖励')
    }
  }

  private rewardEligibility(registrations: ReadonlyArray<RegistrationForReward>): RewardEligibility {
    const checkedIn = registrations.filter((item) => item.status === RegistrationStatus.CHECKED_IN)
    const excludedRefunded = checkedIn.filter((item) =>
      Boolean(item.order && ORDER_STATUSES_REFUNDED.includes(item.order.status)),
    )
    const pendingRefund = checkedIn.filter((item) =>
      Boolean(item.order && ORDER_STATUSES_REFUND_PENDING.includes(item.order.status)),
    )
    const excludedIds = new Set(excludedRefunded.map((item) => item.id))
    return {
      eligible: checkedIn.filter((item) => !excludedIds.has(item.id)),
      excludedRefunded,
      pendingRefund,
    }
  }

  private rewardRuleSnapshot(value: unknown): RewardRuleSnapshot {
    const rule = value && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown>
      : {}
    const perCheckedIn = typeof rule.perCheckedIn === 'number' && Number.isFinite(rule.perCheckedIn)
      ? Math.max(0, Math.round(rule.perCheckedIn))
      : 20
    const cap = typeof rule.cap === 'number' && Number.isFinite(rule.cap)
      ? Math.max(0, Math.round(rule.cap))
      : 500
    const rewardType = typeof rule.type === 'string' && rule.type.trim()
      ? rule.type.trim()
      : AccountType.BADMINTON_COIN
    return { rewardType, perCheckedIn, cap }
  }

  private rewardAccountType(rewardType: string): AccountType | undefined {
    if (rewardType === AccountType.BADMINTON_COIN) return AccountType.BADMINTON_COIN
    if (rewardType === AccountType.GIFT_BALANCE) return AccountType.GIFT_BALANCE
    return undefined
  }

  private async observationEndsAt(tx: Prisma.TransactionClient, now: Date): Promise<Date> {
    const delegate = (tx as unknown as {
      systemParameter?: { findFirst?: (args: unknown) => Promise<{ value?: unknown } | null> }
    }).systemParameter
    let days = DEFAULT_HOST_REWARD_OBSERVATION_DAYS
    if (delegate?.findFirst) {
      for (const key of HOST_REWARD_OBSERVATION_PARAMETER_KEYS) {
        const parameter = await delegate.findFirst({
          where: {
            key,
            effectiveFrom: { lte: now },
            OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }],
          },
          orderBy: { effectiveFrom: 'desc' },
        })
        if (parameter) {
          const parsed = typeof parameter.value === 'number' ? parameter.value : Number(parameter.value)
          if (Number.isFinite(parsed)) days = Math.min(365, Math.max(0, Math.round(parsed)))
          break
        }
      }
    }
    return new Date(now.getTime() + days * 86_400_000)
  }

  private async createHostReward(
    tx: Prisma.TransactionClient,
    game: { hostId: string },
    gameId: string,
    eligibility: RewardEligibility,
    rule: RewardRuleSnapshot,
    observationEndsAt: Date,
  ) {
    const rewardValue = Math.min(rule.cap, eligibility.eligible.length * rule.perCheckedIn)
    // HostReward is unique per game.  The compound business key is enforced
    // in the database and this upsert makes concurrent completion requests
    // resolve to the same immutable reward instead of racing through a
    // read-then-create sequence.
    return tx.hostReward.upsert({
      where: { gameId },
      update: {},
      create: {
        hostId: game.hostId,
        gameId,
        rewardType: rule.rewardType,
        rewardValue,
        basisCount: eligibility.eligible.length,
        status: RewardStatus.PENDING_OBSERVATION,
        availableAt: observationEndsAt,
      },
    })
  }

  private async writeCompletionAudit(
    tx: Prisma.TransactionClient,
    actor: AuthUser,
    game: { id: string; status: GameStatus },
    reward: { id: string; rewardValue: number; basisCount: number; rewardType: string },
    eligibility: RewardEligibility,
    observationEndsAt: Date,
    repaired: boolean,
  ): Promise<void> {
    await tx.auditLog.create({
      data: {
        actorId: actor.sub,
        actorRole: actor.roles[0],
        action: repaired ? 'GAME_REWARD_REBUILT' : 'GAME_COMPLETED',
        objectType: 'Game',
        objectId: game.id,
        oldValue: { status: game.status } as never,
        newValue: {
          status: GameStatus.COMPLETED,
          rewardId: reward.id,
          rewardType: reward.rewardType,
          rewardValue: reward.rewardValue,
          checkedIn: eligibility.eligible.length,
          checkedInRegistrationIds: eligibility.eligible.map((item) => item.id),
          excludedRefundedRegistrationIds: eligibility.excludedRefunded.map((item) => item.id),
          pendingRefundRegistrationIds: eligibility.pendingRefund.map((item) => item.id),
          observationEndsAt: observationEndsAt.toISOString(),
        } as never,
      },
    })
  }

  private async writeRewardAudit(
    tx: Prisma.TransactionClient,
    actor: AuthUser,
    reward: { id: string; gameId: string; status: RewardStatus },
    action: string,
    newValue: Record<string, unknown>,
  ): Promise<void> {
    const auditValue: Record<string, unknown> = { ...newValue, gameId: reward.gameId }
    if (action.endsWith('GRANTED') || action.endsWith('RECOVERED')) {
      auditValue.status = RewardStatus.GRANTED
    }
    await tx.auditLog.create({
      data: {
        actorId: actor.sub,
        actorRole: actor.roles[0],
        action,
        objectType: 'HostReward',
        objectId: reward.id,
        oldValue: { status: reward.status } as never,
        newValue: auditValue as never,
      },
    })
  }
}
