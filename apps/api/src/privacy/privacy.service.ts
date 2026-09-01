import { createHash } from 'node:crypto'

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
  AccountAdjustmentStatus,
  AccountType,
  AppRole,
  CouponStatus,
  DataErasureRequestStatus,
  ExportStatus,
  FrontDeskShiftStatus,
  HostStatus,
  MembershipStatus,
  OrderStatus,
  PaymentStatus,
  Prisma,
  RefundStatus,
  RegistrationStatus,
  RewardStatus,
  TrainingEnrollmentStatus,
  TrainingTrialStatus,
  UserStatus,
} from '../generated/prisma/client.js'
import type {
  CreateDataErasureRequestDto,
  DataErasureRequestQueryDto,
  DecideDataErasureRequestDto,
} from './privacy.dto.js'

type PrivacyClient = Prisma.TransactionClient | PrismaService
type DecisionAction = 'CANCEL' | 'REJECT' | 'COMPLETE'

export interface ErasureBlocker {
  code: string
  count: number
  message: string
}

const sha256 = (input: Record<string, unknown>) =>
  createHash('sha256').update(JSON.stringify(input)).digest('hex')

const isPrismaCode = (error: unknown, code: string) =>
  Boolean(error && typeof error === 'object' && 'code' in error && error.code === code)

const normalized = (value: string, label: string, min = 2, max = 300) => {
  const result = value?.trim()
  if (!result || result.length < min || result.length > max) {
    throw new BadRequestException(`${label}长度必须为${min}-${max}个字符`)
  }
  return result
}

const hasOwn = (value: object, key: string) =>
  Object.prototype.hasOwnProperty.call(value, key)

/**
 * Data-erasure commands keep their replay keys and hashes in persistence, but
 * callers only need the workflow state and review evidence. Keep this
 * allow-list at the HTTP boundary so adding a database column cannot silently
 * expand the privacy response contract.
 */
const dataErasureRequestResponse = (request: any) => ({
  id: request.id,
  userId: request.userId,
  status: request.status,
  reason: request.reason,
  reviewedById: request.reviewedById ?? null,
  reviewReason: request.reviewReason ?? null,
  requestedAt: request.requestedAt,
  reviewedAt: request.reviewedAt ?? null,
  completedAt: request.completedAt ?? null,
  createdAt: request.createdAt,
  updatedAt: request.updatedAt,
  ...(hasOwn(request, 'user')
    ? {
        user: request.user
          ? {
              id: request.user.id,
              displayName: request.user.displayName,
              status: request.user.status,
              ...(hasOwn(request.user, 'phone')
                ? { phone: request.user.phone }
                : {}),
            }
          : null,
      }
    : {}),
  ...(hasOwn(request, 'reviewedBy')
    ? {
        reviewedBy: request.reviewedBy
          ? {
              id: request.reviewedBy.id,
              displayName: request.reviewedBy.displayName,
            }
          : null,
      }
    : {}),
})

@Injectable()
export class PrivacyService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateDataErasureRequestDto, actor: AuthUser) {
    const reason = normalized(dto.reason, '注销原因')
    const requestId = normalized(dto.idempotencyKey, '注销申请幂等键', 8, 100)
    const hash = sha256({ kind: 'DATA_ERASURE_REQUEST', userId: actor.sub, reason })

    try {
      return await this.prisma.$transaction(
        async (tx) => {
          const replay = await tx.dataErasureRequest.findUnique({
            where: { requestIdempotencyKey: requestId },
          })
          if (replay) {
            this.assertRequestReplay(replay, actor.sub, hash)
            return this.view(tx, replay.id)
          }
          const user = await tx.user.findUnique({
            where: { id: actor.sub },
            select: { id: true, status: true, deletedAt: true, memberProfile: { select: { id: true } } },
          })
          if (!user || user.deletedAt || user.status === UserStatus.DELETED) {
            throw new NotFoundException('账号不存在或已完成匿名化')
          }
          if (!user.memberProfile) throw new ConflictException('只有会员账号可以发起数据注销申请')
          const open = await tx.dataErasureRequest.findFirst({
            where: { userId: actor.sub, status: DataErasureRequestStatus.REQUESTED },
          })
          if (open) throw new ConflictException('已有待处理的注销申请，请勿重复提交')
          const created = await tx.dataErasureRequest.create({
            data: {
              userId: actor.sub,
              reason,
              requestIdempotencyKey: requestId,
              requestCommandHash: hash,
            },
          })
          await tx.auditLog.create({
            data: {
              actorId: actor.sub,
              actorRole: actor.roles[0],
              action: 'DATA_ERASURE_REQUESTED',
              objectType: 'DataErasureRequest',
              objectId: created.id,
              reason,
              requestId,
              newValue: { userId: actor.sub, status: created.status, commandHash: hash } as never,
            },
          })
          return this.view(tx, created.id)
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      )
    } catch (error) {
      if (!isPrismaCode(error, 'P2002')) throw error
      const replay = await this.prisma.dataErasureRequest.findUnique({
        where: { requestIdempotencyKey: requestId },
      })
      if (replay) {
        this.assertRequestReplay(replay, actor.sub, hash)
        return this.view(this.prisma, replay.id)
      }
      throw new ConflictException('已有待处理的注销申请，请刷新后查看')
    }
  }

  async listMine(actor: AuthUser) {
    const requests = await this.prisma.dataErasureRequest.findMany({
      where: { userId: actor.sub },
      include: { reviewedBy: { select: { id: true, displayName: true } } },
      orderBy: { requestedAt: 'desc' },
    })
    return requests.map(dataErasureRequestResponse)
  }

  async list(query: DataErasureRequestQueryDto, actor: AuthUser) {
    this.assertAdmin(actor, false)
    const where = { status: query.status }
    const [items, total] = await this.prisma.$transaction([
      this.prisma.dataErasureRequest.findMany({
        where,
        include: {
          user: { select: { id: true, displayName: true, phone: true, status: true } },
          reviewedBy: { select: { id: true, displayName: true } },
        },
        orderBy: { requestedAt: 'asc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.dataErasureRequest.count({ where }),
    ])
    return {
      items: items.map(dataErasureRequestResponse),
      total,
      page: query.page,
      pageSize: query.pageSize,
    }
  }

  async blockers(requestId: string, actor: AuthUser) {
    this.assertAdmin(actor, false)
    const request = await this.prisma.dataErasureRequest.findUnique({ where: { id: requestId } })
    if (!request) throw new NotFoundException('注销申请不存在')
    return this.erasureBlockers(this.prisma, request.userId)
  }

  cancel(requestId: string, dto: DecideDataErasureRequestDto, actor: AuthUser) {
    return this.decide(requestId, 'CANCEL', dto, actor)
  }

  reject(requestId: string, dto: DecideDataErasureRequestDto, actor: AuthUser) {
    this.assertAdmin(actor, true)
    return this.decide(requestId, 'REJECT', dto, actor)
  }

  complete(requestId: string, dto: DecideDataErasureRequestDto, actor: AuthUser) {
    this.assertAdmin(actor, true)
    return this.decide(requestId, 'COMPLETE', dto, actor)
  }

  private async decide(
    requestId: string,
    action: DecisionAction,
    dto: DecideDataErasureRequestDto,
    actor: AuthUser,
  ) {
    const reason = normalized(dto.reason, '处理原因')
    const decisionId = normalized(dto.idempotencyKey, '处理幂等键', 8, 100)
    const hash = sha256({ kind: `DATA_ERASURE_${action}`, requestId, reason })
    const target = action === 'CANCEL'
      ? DataErasureRequestStatus.CANCELLED
      : action === 'REJECT'
        ? DataErasureRequestStatus.REJECTED
        : DataErasureRequestStatus.COMPLETED

    try {
      return await this.prisma.$transaction(
        async (tx) => {
          const decisionReplay = await tx.dataErasureRequest.findUnique({
            where: { decisionIdempotencyKey: decisionId },
          })
          if (decisionReplay) {
            this.assertDecisionReplay(decisionReplay, requestId, actor.sub, hash, target)
            return this.view(tx, decisionReplay.id)
          }
          const current = await tx.dataErasureRequest.findUnique({ where: { id: requestId } })
          if (!current) throw new NotFoundException('注销申请不存在')
          if (action === 'CANCEL' && current.userId !== actor.sub) {
            throw new ForbiddenException('只能撤回本人的注销申请')
          }
          if (action !== 'CANCEL' && current.userId === actor.sub) {
            throw new ForbiddenException('注销申请人与复核人不能是同一账号')
          }
          if (current.status !== DataErasureRequestStatus.REQUESTED) {
            throw new ConflictException('注销申请已进入终态，不能重复处理')
          }

          if (action === 'COMPLETE') {
            const blockers = await this.erasureBlockers(tx, current.userId)
            if (blockers.length) {
              throw new ConflictException({
                message: '账号仍有未完成业务，暂不能匿名化',
                blockers,
              })
            }
            await this.anonymizeUser(tx, current.userId)
          }

          const now = new Date()
          const changed = await tx.dataErasureRequest.updateMany({
            where: { id: current.id, status: DataErasureRequestStatus.REQUESTED },
            data: {
              status: target,
              decisionIdempotencyKey: decisionId,
              decisionCommandHash: hash,
              reviewedById: actor.sub,
              reviewReason: reason,
              reviewedAt: now,
              completedAt: target === DataErasureRequestStatus.COMPLETED ? now : null,
            },
          })
          if (changed.count !== 1) throw new ConflictException('注销申请已由其他人员处理')
          await tx.auditLog.create({
            data: {
              actorId: actor.sub,
              actorRole: actor.roles[0],
              action: `DATA_ERASURE_${target}`,
              objectType: 'DataErasureRequest',
              objectId: current.id,
              reason,
              requestId: decisionId,
              oldValue: { status: current.status } as never,
              newValue: {
                status: target,
                userId: current.userId,
                personalIdentifiersRemoved: target === DataErasureRequestStatus.COMPLETED,
                commandHash: hash,
              } as never,
            },
          })
          return this.view(tx, current.id)
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      )
    } catch (error) {
      if (!isPrismaCode(error, 'P2002') && !isPrismaCode(error, 'P2034')) throw error
      const replay = await this.prisma.dataErasureRequest.findUnique({
        where: { decisionIdempotencyKey: decisionId },
      })
      if (replay) {
        this.assertDecisionReplay(replay, requestId, actor.sub, hash, target)
        return this.view(this.prisma, replay.id)
      }
      throw new ConflictException('注销申请刚刚发生变化，请刷新后重试')
    }
  }

  private async erasureBlockers(client: PrivacyClient, userId: string): Promise<ErasureBlocker[]> {
    const user = await client.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        status: true,
        deletedAt: true,
        primaryRole: true,
        roles: { select: { role: true } },
      },
    })
    if (!user || user.deletedAt || user.status === UserStatus.DELETED) return []

    const [
      spendableAccounts,
      activeOrders,
      activePayments,
      activeRefunds,
      activeMemberships,
      activeGameEntries,
      activeEventEntries,
      activeTraining,
      activeTrainingTrials,
      claimedCoupons,
      pendingAdjustments,
      pendingReferralRewards,
      pendingHostRewards,
      openShifts,
    ] = await Promise.all([
      client.account.count({
        where: {
          userId,
          OR: [
            { type: { in: [AccountType.CASH_PRINCIPAL, AccountType.GIFT_BALANCE, AccountType.BADMINTON_COIN] }, balance: { not: 0 } },
            { frozenBalance: { not: 0 } },
          ],
        },
      }),
      client.order.count({
        where: { memberId: userId, status: { in: [OrderStatus.PENDING, OrderStatus.PAID, OrderStatus.CHECKED_IN, OrderStatus.REFUND_PENDING] } },
      }),
      client.payment.count({ where: { userId, status: { in: [PaymentStatus.CREATED, PaymentStatus.PROCESSING] } } }),
      client.refund.count({
        where: { order: { memberId: userId }, status: { in: [RefundStatus.REQUESTED, RefundStatus.APPROVED, RefundStatus.PROCESSING] } },
      }),
      client.memberSubscription.count({ where: { member: { userId }, status: MembershipStatus.ACTIVE } }),
      client.gameRegistration.count({
        where: { userId, status: { in: [RegistrationStatus.WAITLISTED, RegistrationStatus.REGISTERED, RegistrationStatus.PAID, RegistrationStatus.CHECKED_IN] } },
      }),
      client.eventTeam.count({
        where: {
          OR: [{ captainId: userId }, { playerAUserId: userId }, { playerBUserId: userId }],
          status: { in: [RegistrationStatus.WAITLISTED, RegistrationStatus.REGISTERED, RegistrationStatus.PAID, RegistrationStatus.CHECKED_IN] },
        },
      }),
      client.trainingEnrollment.count({
        where: {
          OR: [{ buyerId: userId }, { student: { guardianId: userId } }],
          status: { in: [TrainingEnrollmentStatus.PENDING_PAYMENT, TrainingEnrollmentStatus.ACTIVE, TrainingEnrollmentStatus.PARTIALLY_REFUNDED] },
        },
      }),
      client.trainingTrial.count({
        where: {
          OR: [{ memberId: userId }, { guardianId: userId }],
          status: {
            in: [
              TrainingTrialStatus.RESERVED,
              TrainingTrialStatus.CHECKED_IN,
              TrainingTrialStatus.ASSESSED,
            ],
          },
        },
      }),
      client.couponCode.count({ where: { holderId: userId, status: CouponStatus.CLAIMED } }),
      client.accountAdjustmentRequest.count({ where: { requestedById: userId, status: AccountAdjustmentStatus.REQUESTED } }),
      client.referralReward.count({
        where: { OR: [{ referrerId: userId }, { newUserId: userId }], status: { in: [RewardStatus.PENDING_OBSERVATION, RewardStatus.AVAILABLE] } },
      }),
      client.hostReward.count({ where: { hostId: userId, status: { in: [RewardStatus.PENDING_OBSERVATION, RewardStatus.AVAILABLE] } } }),
      client.frontDeskShift.count({ where: { operatorId: userId, status: FrontDeskShiftStatus.OPEN } }),
    ])

    const roles = new Set([user.primaryRole, ...user.roles.map(({ role }) => role)])
    const candidates: ErasureBlocker[] = [
      ...(user.status !== UserStatus.DISABLED
        ? [{ code: 'USER_MUST_BE_DISABLED', count: 1, message: '请先停用账号，确认其不能继续发起新业务' }]
        : []),
      ...([...roles].some((role) => role !== AppRole.MEMBER)
        ? [{ code: 'STAFF_ROLES_ACTIVE', count: 1, message: '请先移交职责并撤销全部员工、主理人或商户角色' }]
        : []),
      { code: 'SPENDABLE_ACCOUNT_BALANCE', count: spendableAccounts, message: '仍有本金、赠送余额、羽球币或冻结余额' },
      { code: 'ACTIVE_ORDER', count: activeOrders, message: '仍有未完成订单或待履约订单' },
      { code: 'ACTIVE_PAYMENT', count: activePayments, message: '仍有处理中支付' },
      { code: 'ACTIVE_REFUND', count: activeRefunds, message: '仍有待处理退款' },
      { code: 'ACTIVE_MEMBERSHIP', count: activeMemberships, message: '仍有生效中的会员权益' },
      { code: 'ACTIVE_GAME_ENTRY', count: activeGameEntries, message: '仍有待参加球局或候补报名' },
      { code: 'ACTIVE_EVENT_ENTRY', count: activeEventEntries, message: '仍有待参加赛事报名' },
      { code: 'ACTIVE_TRAINING', count: activeTraining, message: '仍有未结课、未退清的培训课包' },
      { code: 'ACTIVE_TRAINING_TRIAL', count: activeTrainingTrials, message: '仍有待到课、待测评或待转化的培训试听' },
      { code: 'CLAIMED_COUPON', count: claimedCoupons, message: '仍有已领取未核销的联盟券' },
      { code: 'PENDING_ACCOUNT_ADJUSTMENT', count: pendingAdjustments, message: '仍有待复核账户调整' },
      { code: 'PENDING_REFERRAL_REWARD', count: pendingReferralRewards, message: '仍有观察期或待发放推荐奖励' },
      { code: 'PENDING_HOST_REWARD', count: pendingHostRewards, message: '仍有观察期或待发放主理人奖励' },
      { code: 'OPEN_FRONT_DESK_SHIFT', count: openShifts, message: '仍有未关前台班次' },
    ]
    return candidates.filter(({ count }) => count > 0)
  }

  private async anonymizeUser(tx: Prisma.TransactionClient, userId: string) {
    const user = await tx.user.findUnique({
      where: { id: userId },
      select: { id: true, displayName: true, updatedAt: true },
    })
    if (!user) throw new NotFoundException('待匿名化账号不存在')
    const now = new Date()
    const pseudonym = `已注销用户-${userId.slice(-6)}`

    // Event teams intentionally retain immutable participation, score and
    // prize evidence.  Remove the requester's display name from those public
    // history rows before the account itself becomes pseudonymous; partner
    // names and all financial/competitive fields remain unchanged.
    const participantTeams = await tx.eventTeam.findMany({
      where: {
        OR: [
          { playerAUserId: userId },
          { playerBUserId: userId },
        ],
      },
      select: {
        id: true,
        playerAName: true,
        playerBName: true,
        playerAUserId: true,
        playerBUserId: true,
      },
    })
    for (const team of participantTeams) {
      const personalNames = new Set([user.displayName])
      const data: { playerAName?: string; playerBName?: string } = {}
      if (team.playerAUserId === userId) {
        personalNames.add(team.playerAName)
        data.playerAName = '已匿名参赛者'
      }
      if (team.playerBUserId === userId) {
        personalNames.add(team.playerBName)
        data.playerBName = '已匿名参赛者'
      }
      await tx.eventTeam.update({ where: { id: team.id }, data })

      const awards = await tx.eventPrizeAward.findMany({
        where: { teamId: team.id },
        select: { id: true, recipientNames: true, receivedByName: true },
      })
      for (const award of awards) {
        const recipientNames = award.recipientNames.map((name) =>
          personalNames.has(name) ? '已匿名参赛者' : name,
        )
        const receivedByName = award.receivedByName && personalNames.has(award.receivedByName)
          ? '已匿名参赛者'
          : award.receivedByName
        if (
          recipientNames.some((name, index) => name !== award.recipientNames[index]) ||
          receivedByName !== award.receivedByName
        ) {
          await tx.eventPrizeAward.update({
            where: { id: award.id },
            data: { recipientNames, receivedByName },
          })
        }
      }
    }

    await tx.userRole.deleteMany({ where: { userId } })
    await tx.user.updateMany({ where: { referrerId: userId }, data: { referrerId: null } })
    await tx.memberProfile.updateMany({
      where: { userId },
      data: { tags: [], consentVersion: null, consentedAt: null, isNewCustomer: false },
    })
    await tx.student.updateMany({
      where: { guardianId: userId },
      data: { displayName: '已匿名学员', birthMonth: null, guardianConsentStatus: false, authorizationNote: null },
    })
    await tx.customerLead.updateMany({
      where: { convertedMemberId: userId },
      data: { displayName: pseudonym, phone: null },
    })
    await tx.hostProfile.updateMany({
      where: { userId },
      data: { status: HostStatus.SUSPENDED, suspendedReason: '账号已完成注销与匿名化' },
    })
    await tx.notification.deleteMany({ where: { userId } })
    await tx.exportJob.updateMany({
      where: { userId },
      data: { status: ExportStatus.EXPIRED, fileKey: null, downloadUrl: null, expiresAt: now },
    })
    const changed = await tx.user.updateMany({
      where: { id: userId, status: UserStatus.DISABLED, deletedAt: null, updatedAt: user.updatedAt },
      data: {
        openId: null,
        unionId: null,
        phone: null,
        displayName: pseudonym,
        avatarUrl: null,
        status: UserStatus.DELETED,
        primaryRole: AppRole.MEMBER,
        referrerId: null,
        deletedAt: now,
      },
    })
    if (changed.count !== 1) throw new ConflictException('账号状态已发生变化，请重新检查注销条件')
  }

  private async view(client: PrivacyClient, id: string) {
    const request = await client.dataErasureRequest.findUniqueOrThrow({
      where: { id },
      include: {
        user: { select: { id: true, displayName: true, status: true } },
        reviewedBy: { select: { id: true, displayName: true } },
      },
    })
    return dataErasureRequestResponse(request)
  }

  private assertRequestReplay(
    request: { userId: string; requestCommandHash: string },
    userId: string,
    hash: string,
  ) {
    if (request.userId !== userId || request.requestCommandHash !== hash) {
      throw new ConflictException('注销申请幂等键已用于不同账号或命令')
    }
  }

  private assertDecisionReplay(
    request: {
      id: string
      status: DataErasureRequestStatus
      reviewedById: string | null
      decisionCommandHash: string | null
    },
    requestId: string,
    actorId: string,
    hash: string,
    target: DataErasureRequestStatus,
  ) {
    if (
      request.id !== requestId ||
      request.reviewedById !== actorId ||
      request.decisionCommandHash !== hash ||
      request.status !== target
    ) {
      throw new ConflictException('注销处理幂等键已用于不同申请、操作人或命令')
    }
  }

  private assertAdmin(actor: AuthUser, superOnly: boolean) {
    const allowed: AppRole[] = superOnly
      ? [AppRole.SUPER_ADMIN]
      : [AppRole.ADMIN, AppRole.SUPER_ADMIN]
    if (!actor.roles.some((role) => allowed.includes(role))) {
      throw new ForbiddenException(superOnly ? '仅超级管理员可复核数据注销' : '无权查看数据注销申请')
    }
  }
}
