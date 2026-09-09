import { ConflictException, ForbiddenException } from '@nestjs/common';
import type { AuthUser } from '../../common/auth/auth-user.js';
import { PrismaService } from '../../database/prisma.service.js';
import {
  AccountTxnKind,
  AccountType,
  Prisma,
  RewardStatus,
} from '../../generated/prisma/client.js';
import { FINANCIAL_ROLES } from '../shared/games-support.js';

import {
  rewardEligibility,
  rewardRuleSnapshot,
} from '../shared/games-policy.js';

export async function grantMatured(prisma: PrismaService, actor: AuthUser) {
  assertFinancialOperator(actor);
  const now = new Date();
  const candidates = await prisma.hostReward.findMany({
    where: {
      status: {
        in: [RewardStatus.PENDING_OBSERVATION, RewardStatus.AVAILABLE],
      },
      availableAt: { lte: now },
    },
    orderBy: { availableAt: 'asc' },
    take: 500,
  });

  const results: unknown[] = [];
  for (const candidate of candidates) {
    const result = await prisma.$transaction(
      async (tx) => {
        const reward = await tx.hostReward.findUnique({
          where: { id: candidate.id },
          include: {
            game: {
              include: {
                registrations: {
                  include: {
                    order: {
                      select: {
                        id: true,
                        status: true,
                        paidCents: true,
                        refundedCents: true,
                      },
                    },
                  },
                },
              },
            },
          },
        });
        if (!reward) return null;
        if (
          reward.status !== RewardStatus.PENDING_OBSERVATION &&
          reward.status !== RewardStatus.AVAILABLE
        ) {
          return reward;
        }
        if (!reward.availableAt || reward.availableAt > now) return reward;

        const eligibility = rewardEligibility(
          reward.game.registrations,
          reward.hostId,
        );
        if (eligibility.pendingRefund.length) {
          // A refund request is not enough evidence to claw back a reward;
          // hold it in AVAILABLE until the refund reaches a terminal state.
          if (reward.status !== RewardStatus.AVAILABLE) {
            const held = await tx.hostReward.update({
              where: { id: reward.id },
              data: { status: RewardStatus.AVAILABLE },
            });
            await writeRewardAudit(
              tx,
              actor,
              reward,
              'GAME_HOST_REWARD_HELD_REFUND_REVIEW',
              {
                pendingRefundRegistrationIds: eligibility.pendingRefund.map(
                  (item) => item.id,
                ),
                observationEndsAt: reward.availableAt.toISOString(),
              },
            );
            return held;
          }
          return reward;
        }

        const rule = rewardRuleSnapshot(reward.game.rewardRule);
        const recalculatedValue = Math.min(
          rule.cap,
          eligibility.eligible.length * rule.perCheckedIn,
        );
        let currentReward = reward;
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
          });
          currentReward = {
            ...reward,
            basisCount: eligibility.eligible.length,
            rewardValue: recalculatedValue,
          };
          await writeRewardAudit(
            tx,
            actor,
            reward,
            'GAME_HOST_REWARD_RECALCULATED',
            {
              oldBasisCount: reward.basisCount,
              oldRewardValue: reward.rewardValue,
              basisCount: eligibility.eligible.length,
              rewardValue: recalculatedValue,
              excludedRefundedRegistrationIds: eligibility.excludedRefunded.map(
                (item) => item.id,
              ),
              excludedHostRegistrationIds: eligibility.excludedSelf.map(
                (item) => item.id,
              ),
            },
          );
        }

        if (recalculatedValue <= 0) {
          const reversed = await tx.hostReward.update({
            where: { id: reward.id },
            data: { status: RewardStatus.REVERSED },
          });
          await writeRewardAudit(
            tx,
            actor,
            currentReward,
            'GAME_HOST_REWARD_REVERSED',
            {
              reason: '观察期内没有可计奖的真实签到',
              excludedRefundedRegistrationIds: eligibility.excludedRefunded.map(
                (item) => item.id,
              ),
            },
          );
          return reversed;
        }

        const accountType = rewardAccountType(currentReward.rewardType);
        if (!accountType) {
          const rejected = await tx.hostReward.update({
            where: { id: reward.id },
            data: { status: RewardStatus.REJECTED },
          });
          await writeRewardAudit(
            tx,
            actor,
            currentReward,
            'GAME_HOST_REWARD_REJECTED',
            {
              reason: `奖励类型 ${currentReward.rewardType} 没有对应账户`,
            },
          );
          return rejected;
        }

        const idempotencyKey = `GAME_HOST_REWARD:${currentReward.id}`;
        const existingTransaction = await tx.accountTransaction.findUnique({
          where: { idempotencyKey },
        });
        if (existingTransaction) {
          if (existingTransaction.amount !== recalculatedValue) {
            throw new ConflictException(
              '主理人奖励账务与奖励记录金额不一致，请人工核对',
            );
          }
          const recovered = await tx.hostReward.update({
            where: { id: currentReward.id },
            data: {
              status: RewardStatus.GRANTED,
              grantedAt: currentReward.grantedAt ?? now,
            },
          });
          await writeRewardAudit(
            tx,
            actor,
            currentReward,
            'GAME_HOST_REWARD_GRANTED_RECOVERED',
            {
              idempotencyKey,
              accountTransactionId: existingTransaction.id,
            },
          );
          return recovered;
        }

        const account = await tx.account.upsert({
          where: {
            userId_type: { userId: currentReward.hostId, type: accountType },
          },
          update: {},
          create: { userId: currentReward.hostId, type: accountType },
        });
        const balanceBefore = account.balance;
        const accountVersion =
          typeof account.version === 'number' ? account.version : 0;
        const updatedAccount = await tx.account.updateMany({
          where: { id: account.id, version: accountVersion },
          data: {
            balance: { increment: recalculatedValue },
            version: { increment: 1 },
          },
        });
        if (updatedAccount.count !== 1) {
          throw new ConflictException('主理人账户余额已变化，请重试');
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
              checkedInRegistrationIds: eligibility.eligible.map(
                (item) => item.id,
              ),
              excludedRefundedRegistrationIds: eligibility.excludedRefunded.map(
                (item) => item.id,
              ),
              excludedHostRegistrationIds: eligibility.excludedSelf.map(
                (item) => item.id,
              ),
              observationEndsAt:
                currentReward.availableAt?.toISOString() ?? null,
            },
          } as never,
        });
        const granted = await tx.hostReward.update({
          where: { id: currentReward.id },
          data: { status: RewardStatus.GRANTED, grantedAt: now },
        });
        await writeRewardAudit(
          tx,
          actor,
          currentReward,
          'GAME_HOST_REWARD_GRANTED',
          {
            accountId: account.id,
            accountTransactionId: accountTransaction.id,
            idempotencyKey,
            basisCount: eligibility.eligible.length,
            rewardValue: recalculatedValue,
          },
        );
        return granted;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    if (result) results.push(result);
  }
  return { processed: results.length, results };
}

export function assertFinancialOperator(actor: AuthUser): void {
  if (!actor.roles.some((role) => FINANCIAL_ROLES.includes(role))) {
    throw new ForbiddenException('只有财务或管理员可发放主理人奖励');
  }
}

export function rewardAccountType(rewardType: string): AccountType | undefined {
  if (rewardType === AccountType.BADMINTON_COIN)
    return AccountType.BADMINTON_COIN;
  if (rewardType === AccountType.GIFT_BALANCE) return AccountType.GIFT_BALANCE;
  return undefined;
}

export async function writeRewardAudit(
  tx: Prisma.TransactionClient,
  actor: AuthUser,
  reward: { id: string; gameId: string; status: RewardStatus },
  action: string,
  newValue: Record<string, unknown>,
): Promise<void> {
  const auditValue: Record<string, unknown> = {
    ...newValue,
    gameId: reward.gameId,
  };
  if (action.endsWith('GRANTED') || action.endsWith('RECOVERED')) {
    auditValue.status = RewardStatus.GRANTED;
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
  });
}
