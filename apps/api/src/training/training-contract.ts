import { ConflictException } from '@nestjs/common';

/** Immutable sold contract fields, never the current product. */
type TrainingContractBalance = {
  totalAmountCents: number;
  totalSessions: number;
  consumedSessions: number;
  prepaidBalanceCents: number;
};

export function trainingConsumptionQuote(contract: TrainingContractBalance) {
  const {
    totalAmountCents,
    totalSessions,
    consumedSessions,
    prepaidBalanceCents,
  } = contract;
  if (
    ![
      totalAmountCents,
      totalSessions,
      consumedSessions,
      prepaidBalanceCents,
    ].every(Number.isSafeInteger) ||
    totalAmountCents <= 0 ||
    totalSessions <= 0 ||
    consumedSessions < 0 ||
    consumedSessions >= totalSessions ||
    prepaidBalanceCents < 0 ||
    prepaidBalanceCents > totalAmountCents
  )
    throw new ConflictException(
      '培训合同金额、课时或预收余额无效，请先核对账本',
    );

  const sessionNumber = consumedSessions + 1;
  // Integer allocation conserves cents, even for tiny amounts. The last
  // session settles the actual remaining balance, including legacy rounding,
  // refunds and reversals; it cannot recognize refunded money.
  const cumulative = (n: number) =>
    Number((BigInt(totalAmountCents) * BigInt(n)) / BigInt(totalSessions));
  const amountCents =
    sessionNumber === totalSessions
      ? prepaidBalanceCents
      : Math.min(
          prepaidBalanceCents,
          cumulative(sessionNumber) - cumulative(consumedSessions),
        );
  return {
    policy: 'FROZEN_CONTRACT_CUMULATIVE_V1' as const,
    totalAmountCents,
    totalSessions,
    sessionNumber,
    amountCents,
  };
}
