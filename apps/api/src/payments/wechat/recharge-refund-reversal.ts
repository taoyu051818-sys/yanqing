import {
  AccountTxnKind,
  Prisma,
} from '../../generated/prisma/client.js';
import { RechargeRefundRecovery } from './wechat-notice-types.js';
import { rechargeRefundDebits } from '../recharge-refund-policy.js';

export async function reverseRechargeBalance(
  tx: Prisma.TransactionClient,
  refund: {
    id: string;
    refundNo: string;
    amountCents: number;
    orderId: string;
    approvedById: string | null;
    requestedById: string;
    order: { memberId: string; parameterSnapshot: Prisma.JsonValue };
  },
  paidCents: number,
  cumulativeRefundedCents: number,
): Promise<RechargeRefundRecovery[]> {
  const debits = await rechargeRefundDebits(
    tx,
    refund,
    paidCents,
    cumulativeRefundedCents,
  );
  const recovery: RechargeRefundRecovery[] = [];
  for (const [type, amount] of debits) {
    if (!amount) continue;
    const idempotencyKey = `RECHARGE-REFUND:${refund.id}:${type}`;
    const existing = await tx.accountTransaction.findUnique({
      where: { idempotencyKey },
    });
    if (existing) {
      const recoveredCents = Math.min(amount, Math.max(0, -existing.amount));
      recovery.push({
        accountType: type,
        requestedCents: amount,
        recoveredCents,
        shortfallCents: amount - recoveredCents,
        reason:
          recoveredCents < amount
            ? 'INSUFFICIENT_AVAILABLE_BALANCE'
            : undefined,
      });
      continue;
    }

    let account =
      (await tx.account.findUnique({
        where: { userId_type: { userId: refund.order.memberId, type } },
      })) ??
      (await tx.account.upsert({
        where: { userId_type: { userId: refund.order.memberId, type } },
        update: {},
        create: { userId: refund.order.memberId, type },
      }));
    let recoveredCents = 0;
    let concurrentFailure = false;
    for (let accountAttempt = 1; accountAttempt <= 3; accountAttempt += 1) {
      const frozenBalance = Math.max(0, Number(account.frozenBalance) || 0);
      const availableBalance = Math.max(0, account.balance - frozenBalance);
      recoveredCents = Math.min(amount, availableBalance);
      if (recoveredCents <= 0) break;
      const balanceBefore = account.balance;
      const balanceAfter = balanceBefore - recoveredCents;
      const changed = await tx.account.updateMany({
        where: {
          id: account.id,
          version: account.version,
          balance: balanceBefore,
          frozenBalance: { lte: balanceAfter },
        },
        data: {
          balance: { decrement: recoveredCents },
          version: { increment: 1 },
        },
      });
      if (changed.count === 1) {
        await tx.accountTransaction.create({
          data: {
            accountId: account.id,
            kind: AccountTxnKind.REVERSAL,
            amount: -recoveredCents,
            balanceBefore,
            balanceAfter,
            reasonCode: 'RECHARGE_REFUND',
            reason: refund.refundNo,
            orderId: refund.orderId,
            operatorId: refund.approvedById || refund.requestedById,
            idempotencyKey,
            metadata: {
              requestedRecoveryCents: amount,
              recoveredCents,
              shortfallCents: amount - recoveredCents,
              externalRefundTerminal: true,
            },
          },
        });
        concurrentFailure = false;
        break;
      }
      concurrentFailure = true;
      const latest = await tx.account.findUnique({
        where: { userId_type: { userId: refund.order.memberId, type } },
      });
      if (!latest) break;
      account = latest;
      recoveredCents = 0;
    }
    if (concurrentFailure) recoveredCents = 0;
    recovery.push({
      accountType: type,
      requestedCents: amount,
      recoveredCents,
      shortfallCents: amount - recoveredCents,
      reason:
        recoveredCents < amount
          ? concurrentFailure
            ? 'CONCURRENT_ACCOUNT_CHANGE'
            : 'INSUFFICIENT_AVAILABLE_BALANCE'
          : undefined,
    });
  }
  return recovery;
}
