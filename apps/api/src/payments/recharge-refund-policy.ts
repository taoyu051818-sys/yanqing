import { AccountType, Prisma } from '../generated/prisma/client.js';

function cents(value: unknown) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : 0;
}

/** Round one cumulative entitlement, not every installment independently. */
export function cumulativeRechargeRecovery(
  originalCents: number,
  refundedCents: number,
  paidCents: number,
) {
  if (paidCents <= 0 || !Number.isSafeInteger(paidCents)) return 0;
  const numerator =
    BigInt(cents(originalCents)) *
    BigInt(Math.min(paidCents, cents(refundedCents)));
  const denominator = BigInt(paidCents);
  return Number((2n * numerator + denominator) / (2n * denominator));
}

export async function rechargeRefundDebits(
  tx: Prisma.TransactionClient,
  refund: {
    id: string;
    orderId: string;
    order: { parameterSnapshot: Prisma.JsonValue };
  },
  paidCents: number,
  cumulativeRefundedCents: number,
): Promise<Array<[AccountType, number]>> {
  const snapshot = refund.order.parameterSnapshot as {
    principalCents?: number;
    giftCents?: number;
  };
  const transactions = await tx.accountTransaction.findMany({
    where: {
      orderId: refund.orderId,
      reasonCode: 'RECHARGE_REFUND',
      amount: { lte: 0 },
    },
    select: {
      amount: true,
      metadata: true,
      idempotencyKey: true,
      account: { select: { type: true } },
    },
  });
  const risks = await tx.riskEvent.findMany({
    where: {
      orderId: refund.orderId,
      ruleCode: 'RECHARGE_REFUND_BALANCE_SHORTFALL',
      objectId: { not: refund.id },
    },
    select: { objectId: true, evidence: true },
  });
  return (
    [
      [AccountType.CASH_PRINCIPAL, cents(snapshot?.principalCents)],
      [AccountType.GIFT_BALANCE, cents(snapshot?.giftCents)],
    ] as Array<[AccountType, number]>
  ).map(([type, original]) => {
    const assessed = new Map<string, number>();
    let legacyRecovered = 0;
    for (const row of transactions) {
      if (
        row.account.type !== type ||
        row.idempotencyKey === `RECHARGE-REFUND:${refund.id}:${type}`
      )
        continue;
      const metadata = row.metadata as {
        requestedRecoveryCents?: number;
      } | null;
      const requested = Math.max(
        cents(-row.amount),
        cents(metadata?.requestedRecoveryCents),
      );
      if (row.idempotencyKey) assessed.set(row.idempotencyKey, requested);
      else legacyRecovered += requested;
    }
    // A refund with zero available balance has no debit row. Its durable risk
    // carries the already-assessed debt; do not charge that debt again under a
    // later installment while leaving the original recovery task outstanding.
    for (const risk of risks) {
      const evidence = risk.evidence as {
        recovery?: Array<{
          accountType?: AccountType;
          requestedCents?: number;
        }>;
      } | null;
      for (const row of Array.isArray(evidence?.recovery)
        ? evidence.recovery
        : []) {
        if (row.accountType !== type) continue;
        const key = `RECHARGE-REFUND:${risk.objectId}:${type}`;
        assessed.set(
          key,
          Math.max(assessed.get(key) ?? 0, cents(row.requestedCents)),
        );
      }
    }
    const prior =
      legacyRecovered +
      [...assessed.values()].reduce((sum, value) => sum + value, 0);
    return [
      type,
      Math.max(
        0,
        cumulativeRechargeRecovery(
          original,
          cumulativeRefundedCents,
          paidCents,
        ) - prior,
      ),
    ];
  });
}
