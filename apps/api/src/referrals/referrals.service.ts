import { ConflictException, Injectable } from '@nestjs/common'

import type { AuthUser } from '../common/auth/auth-user.js'
import { PrismaService } from '../database/prisma.service.js'
import {
  AccountTxnKind,
  AccountType,
  OrderStatus,
  Prisma,
  RewardStatus,
} from '../generated/prisma/client.js'

@Injectable()
export class ReferralsService {
  constructor(private readonly prisma: PrismaService) {}

  myRewards(actor: AuthUser) {
    return this.prisma.referralReward.findMany({
      where: { referrerId: actor.sub },
      include: { newUser: { select: { id: true, displayName: true } }, triggerOrder: true },
      orderBy: { createdAt: 'desc' },
    })
  }

  async grantMatured(actor: AuthUser) {
    const rewards = await this.prisma.referralReward.findMany({
      where: {
        status: { in: [RewardStatus.PENDING_OBSERVATION, RewardStatus.AVAILABLE] },
        observationEndsAt: { lte: new Date() },
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
            if (current.status === RewardStatus.GRANTED || current.status === RewardStatus.REVERSED) {
              return null
            }
            if (current.observationEndsAt > new Date()) return null
            if (
              current.triggerOrder &&
              [OrderStatus.REFUNDED, OrderStatus.PARTIALLY_REFUNDED, OrderStatus.CANCELLED].includes(current.triggerOrder.status as never)
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
            const accountType = current.rewardType === 'BADMINTON_COIN'
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
                  oldValue: { status: current.status, rewardType: current.rewardType } as never,
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
                status: { in: [RewardStatus.PENDING_OBSERVATION, RewardStatus.AVAILABLE] },
              },
              data: { status: RewardStatus.GRANTED, grantedAt },
            })
            if (claimed.count !== 1) return null
            const claimedReward = { ...current, status: RewardStatus.GRANTED, grantedAt }
            const account = await tx.account.upsert({
              where: { userId_type: { userId: claimedReward.referrerId, type: accountType } },
              update: {},
              create: { userId: claimedReward.referrerId, type: accountType },
            })
            const idempotencyKey = `REFERRAL:${claimedReward.id}`
            const existingTransaction = await tx.accountTransaction.findUnique({
              where: { idempotencyKey },
            })
            if (!existingTransaction) {
              const changed = await tx.account.updateMany({
                where: { id: account.id, version: account.version },
                data: { balance: { increment: claimedReward.rewardValue }, version: { increment: 1 } },
              })
              if (changed.count !== 1) throw new ConflictException('推荐人账户余额已变化，请重试')
              await tx.accountTransaction.create({
                data: {
                  accountId: account.id,
                  kind: AccountTxnKind.CREDIT,
                  amount: claimedReward.rewardValue,
                  balanceBefore: account.balance,
                  balanceAfter: account.balance + claimedReward.rewardValue,
                  reasonCode: 'DIRECT_REFERRAL_REWARD',
                  reason: '一层直接推荐有效首单奖励',
                  orderId: claimedReward.triggerOrderId,
                  operatorId: actor.sub,
                  idempotencyKey,
                },
              })
            }
            await tx.auditLog.create({
              data: {
                actorId: actor.sub,
                actorRole: actor.roles[0],
                action: existingTransaction ? 'REFERRAL_REWARD_GRANTED_RECOVERED' : 'REFERRAL_REWARD_GRANTED',
                objectType: 'ReferralReward',
                objectId: claimedReward.id,
                newValue: { rewardValue: claimedReward.rewardValue, accountType, idempotencyKey } as never,
              },
            })
            return tx.referralReward.findUniqueOrThrow({ where: { id: claimedReward.id } })
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        ),
      )
    }
    return { processed: results.filter(Boolean).length, results: results.filter(Boolean) }
  }
}
