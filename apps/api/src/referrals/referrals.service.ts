import { createHash, randomBytes } from 'node:crypto'

import { ConflictException, Injectable, NotFoundException } from '@nestjs/common'

import type { AuthUser } from '../common/auth/auth-user.js'
import { PrismaService } from '../database/prisma.service.js'
import {
  AccountTxnKind,
  AccountType,
  OrderStatus,
  Prisma,
  RewardStatus,
  UserStatus,
} from '../generated/prisma/client.js'

const REFERRAL_INVITE_TTL_MS = 30 * 24 * 60 * 60 * 1_000
const tokenHash = (value: string) =>
  createHash('sha256').update(value).digest('hex')

@Injectable()
export class ReferralsService {
  constructor(private readonly prisma: PrismaService) {}

  async createInvite(actor: AuthUser) {
    const inviter = await this.prisma.user.findUnique({
      where: { id: actor.sub },
      select: {
        status: true,
        deletedAt: true,
        memberProfile: { select: { id: true } },
      },
    })
    if (
      !inviter ||
      inviter.status !== UserStatus.ACTIVE ||
      inviter.deletedAt ||
      !inviter.memberProfile
    ) {
      throw new NotFoundException('会员不存在或已停用')
    }

    const inviteCode = randomBytes(24).toString('base64url')
    const expiresAt = new Date(Date.now() + REFERRAL_INVITE_TTL_MS)
    await this.prisma.referralInvite.create({
      data: {
        tokenHash: tokenHash(inviteCode),
        inviterId: actor.sub,
        expiresAt,
      },
      select: { id: true },
    })
    return { inviteCode, expiresAt }
  }

  async myRewards(actor: AuthUser) {
    const rewards = await this.prisma.referralReward.findMany({
      where: { OR: [{ referrerId: actor.sub }, { newUserId: actor.sub }] },
      // The referrer may see why a reward is pending/reversed, but must not
      // receive the referred member's order amount, payment channel or full
      // parameter snapshot through an unrestricted nested order relation.
      select: {
        id: true,
        referrerId: true,
        newUserId: true,
        triggerOrderId: true,
        triggerType: true,
        rewardType: true,
        rewardValue: true,
        newUserRewardValue: true,
        status: true,
        observationEndsAt: true,
        grantedAt: true,
        reversedAt: true,
        createdAt: true,
        newUser: { select: { displayName: true } },
        referrer: { select: { displayName: true } },
        triggerOrder: {
          select: {
            id: true,
            businessType: true,
            status: true,
            paidAt: true,
            completedAt: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    })
    return rewards.map((reward) => {
      const recipientRole =
        reward.referrerId === actor.sub ? 'REFERRER' : 'NEW_USER'
      const {
        referrerId: _referrerId,
        newUserId: _newUserId,
        triggerOrderId: _triggerOrderId,
        ...publicReward
      } = reward
      return {
        ...publicReward,
        recipientRole,
        recipientRewardValue:
          recipientRole === 'REFERRER'
            ? reward.rewardValue
            : reward.newUserRewardValue,
      }
    })
  }

  async grantMatured(actor: AuthUser) {
    const rewards = await this.prisma.referralReward.findMany({
      where: {
        status: {
          in: [RewardStatus.PENDING_OBSERVATION, RewardStatus.AVAILABLE],
        },
        observationEndsAt: { lte: new Date() },
        triggerOrder: {
          is: {
            status: OrderStatus.COMPLETED,
            completedAt: { not: null },
            refundedCents: 0,
          },
        },
      },
      include: { triggerOrder: true },
      take: 500,
    })
    const results = []
    for (const reward of rewards) {
      results.push(
        await this.prisma.$transaction(
          async (tx) => {
            const current = await tx.referralReward.findUnique({
              where: { id: reward.id },
              include: { triggerOrder: true },
            })
            if (!current) return null
            // The outer query can race with another worker (or a test/mock can
            // return a stale candidate). Terminal and not-yet-matured rows are
            // not counted as work performed by this invocation.
            if (
              current.status === RewardStatus.GRANTED ||
              current.status === RewardStatus.REVERSED
            ) {
              return null
            }
            if (current.observationEndsAt > new Date()) return null
            if (
              !current.triggerOrder ||
              !current.triggerOrder.completedAt ||
              current.triggerOrder.status === OrderStatus.REFUND_PENDING
            ) {
              return null
            }
            if (
              current.triggerOrder.refundedCents > 0 ||
              [
                OrderStatus.REFUNDED,
                OrderStatus.PARTIALLY_REFUNDED,
                OrderStatus.CANCELLED,
              ].includes(current.triggerOrder.status as never)
            ) {
              const reversed = await tx.referralReward.update({
                where: { id: current.id },
                data: { status: RewardStatus.REVERSED, reversedAt: new Date() },
              })
              await tx.auditLog.create({
                data: {
                  actorId: actor.sub,
                  actorRole: actor.roles[0],
                  action: 'REFERRAL_REWARD_REVERSED',
                  objectType: 'ReferralReward',
                  objectId: current.id,
                  reason: '触发首单已退款或撤销',
                  oldValue: { status: current.status } as never,
                  newValue: { status: RewardStatus.REVERSED } as never,
                },
              })
              return reversed
            }
            if (current.triggerOrder.status !== OrderStatus.COMPLETED) {
              return null
            }
            const accountType =
              current.rewardType === 'BADMINTON_COIN'
                ? AccountType.BADMINTON_COIN
                : current.rewardType === 'GIFT_BALANCE'
                  ? AccountType.GIFT_BALANCE
                  : undefined
            if (!accountType) {
              const rejected = await tx.referralReward.update({
                where: { id: current.id },
                data: { status: RewardStatus.REJECTED },
              })
              await tx.auditLog.create({
                data: {
                  actorId: actor.sub,
                  actorRole: actor.roles[0],
                  action: 'REFERRAL_REWARD_REJECTED',
                  objectType: 'ReferralReward',
                  objectId: current.id,
                  reason: `不支持的奖励类型 ${current.rewardType}`,
                  oldValue: {
                    status: current.status,
                    rewardType: current.rewardType,
                  } as never,
                  newValue: { status: RewardStatus.REJECTED } as never,
                },
              })
              return rejected
            }

            // Claim the reward before touching the recipient account.  This
            // conditional write is the concurrency boundary: only one worker
            // can move a pending reward to GRANTED.  If a later account or
            // ledger write fails, the surrounding transaction rolls the claim
            // back, so we never leave a credited account with an unclaimed
            // reward (or vice versa).
            const grantedAt = current.grantedAt ?? new Date()
            const claimed = await tx.referralReward.updateMany({
              where: {
                id: current.id,
                status: {
                  in: [
                    RewardStatus.PENDING_OBSERVATION,
                    RewardStatus.AVAILABLE,
                  ],
                },
              },
              data: { status: RewardStatus.GRANTED, grantedAt },
            })
            if (claimed.count !== 1) return null
            const claimedReward = {
              ...current,
              status: RewardStatus.GRANTED,
              grantedAt,
            }
            const recipients = [
              {
                userId: claimedReward.referrerId,
                rewardValue: claimedReward.rewardValue,
                idempotencyKey: `REFERRAL:${claimedReward.id}`,
                reasonCode: 'DIRECT_REFERRAL_REWARD',
                reason: '一层直接推荐有效首单邀请人奖励',
              },
              {
                userId: claimedReward.newUserId,
                rewardValue: claimedReward.newUserRewardValue,
                idempotencyKey: `REFERRAL_NEW_USER:${claimedReward.id}`,
                reasonCode: 'NEW_MEMBER_REFERRAL_REWARD',
                reason: '一层直接推荐有效首单新客奖励',
              },
            ].filter((recipient) => recipient.rewardValue > 0)
            const grantedTransactions: string[] = []
            for (const recipient of recipients) {
              const account = await tx.account.upsert({
                where: {
                  userId_type: { userId: recipient.userId, type: accountType },
                },
                update: {},
                create: { userId: recipient.userId, type: accountType },
              })
              const existingTransaction =
                await tx.accountTransaction.findUnique({
                  where: { idempotencyKey: recipient.idempotencyKey },
                })
              if (existingTransaction) {
                grantedTransactions.push(recipient.idempotencyKey)
                continue
              }
              const changed = await tx.account.updateMany({
                where: { id: account.id, version: account.version },
                data: {
                  balance: { increment: recipient.rewardValue },
                  version: { increment: 1 },
                },
              })
              if (changed.count !== 1)
                throw new ConflictException('推荐奖励账户余额已变化，请重试')
              await tx.accountTransaction.create({
                data: {
                  accountId: account.id,
                  kind: AccountTxnKind.CREDIT,
                  amount: recipient.rewardValue,
                  balanceBefore: account.balance,
                  balanceAfter: account.balance + recipient.rewardValue,
                  reasonCode: recipient.reasonCode,
                  reason: recipient.reason,
                  orderId: claimedReward.triggerOrderId,
                  operatorId: actor.sub,
                  idempotencyKey: recipient.idempotencyKey,
                },
              })
              grantedTransactions.push(recipient.idempotencyKey)
            }
            await tx.auditLog.create({
              data: {
                actorId: actor.sub,
                actorRole: actor.roles[0],
                action: 'REFERRAL_REWARD_GRANTED',
                objectType: 'ReferralReward',
                objectId: claimedReward.id,
                newValue: {
                  referrerRewardValue: claimedReward.rewardValue,
                  newUserRewardValue: claimedReward.newUserRewardValue,
                  accountType,
                  idempotencyKeys: grantedTransactions,
                } as never,
              },
            })
            return tx.referralReward.findUniqueOrThrow({
              where: { id: claimedReward.id },
            })
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        ),
      )
    }
    return {
      processed: results.filter(Boolean).length,
      results: results.filter(Boolean),
    }
  }
}
