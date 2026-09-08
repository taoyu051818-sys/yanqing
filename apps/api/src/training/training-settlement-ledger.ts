import { ConflictException } from '@nestjs/common';
import { trainingContractContributionCents } from '@yanqing/shared';
import { Prisma, type TrainingSettlement } from '../generated/prisma/client.js';
import type { PrismaService } from '../database/prisma.service.js';

type LedgerClient = Pick<
  Prisma.TransactionClient,
  'trainingRevenueRecognition' | 'trainingSession' | 'trainingEnrollment'
>;

export async function readTrainingLedger(
  client: LedgerClient,
  periodStart: Date,
  periodEnd: Date,
) {
  const [recognitions, sessions, balances] = await Promise.all([
    client.trainingRevenueRecognition.findMany({
      where: { createdAt: { gte: periodStart, lt: periodEnd } },
      orderBy: { id: 'asc' },
    }),
    client.trainingSession.findMany({
      where: {
        status: 'COMPLETED',
        startsAt: { gte: periodStart, lt: periodEnd },
      },
      orderBy: { id: 'asc' },
    }),
    client.trainingEnrollment.aggregate({
      _sum: { prepaidBalanceCents: true, refundedCents: true },
    }),
  ]);
  const snapshot = {
    version: 1,
    recognitions: recognitions.map((r) => ({
      id: r.id,
      effectiveRevenueCents: r.effectiveRevenueCents,
    })),
    sessions: sessions.map((s) => ({
      id: s.id,
      coachCostCents: s.coachCostCents,
      assistantCostCents: s.assistantCostCents,
      materialCostCents: s.materialCostCents,
      occupiedCourtHours: Number(s.occupiedCourtHours),
    })),
  };
  const totals = trainingSnapshotTotals(snapshot);
  const directCostCents =
    totals.coachCostCents +
    totals.assistantCostCents +
    totals.materialCostCents;
  const cashContributionMarginCents =
    totals.effectiveRevenueCents - directCostCents;
  return {
    recognitions,
    snapshot,
    summary: {
      ...totals,
      contractRateBps: 2000,
      venueContractContributionCents: signedContribution(
        totals.effectiveRevenueCents,
      ),
      venueFeeCents: 0,
      trainingPayableFromVenueCents: 0,
      directCostCents,
      cashContributionMarginCents,
      resourceEfficiencyCentsPerCourtHour:
        totals.occupiedCourtHours === 0
          ? null
          : Math.round(cashContributionMarginCents / totals.occupiedCourtHours),
      unusedBalanceCents: balances._sum.prepaidBalanceCents ?? 0,
      refundedCents: balances._sum.refundedCents ?? 0,
      recognitionCount: recognitions.length,
      consumeCount: recognitions.filter((r) => r.type === 'CONSUME').length,
      reversalCount: recognitions.filter((r) => r.type === 'REVERSAL').length,
    },
  };
}

type SourceSnapshot = Awaited<
  ReturnType<typeof readTrainingLedger>
>['snapshot'];
function signedContribution(amount: number) {
  return (
    Math.sign(amount) *
    trainingContractContributionCents(Math.abs(amount), 2000)
  );
}
function trainingSnapshotTotals(snapshot: {
  recognitions: { effectiveRevenueCents: number }[];
  sessions: {
    coachCostCents: number;
    assistantCostCents: number;
    materialCostCents: number;
    occupiedCourtHours: number;
  }[];
}) {
  return {
    effectiveRevenueCents: snapshot.recognitions.reduce(
      (sum, r) => sum + r.effectiveRevenueCents,
      0,
    ),
    coachCostCents: snapshot.sessions.reduce(
      (sum, s) => sum + s.coachCostCents,
      0,
    ),
    assistantCostCents: snapshot.sessions.reduce(
      (sum, s) => sum + s.assistantCostCents,
      0,
    ),
    materialCostCents: snapshot.sessions.reduce(
      (sum, s) => sum + s.materialCostCents,
      0,
    ),
    occupiedCourtHours:
      Math.round(
        snapshot.sessions.reduce((sum, s) => sum + s.occupiedCourtHours, 0) *
          100,
      ) / 100,
  };
}

/** A posted source must not slip into a period whose statement already exists. */
export async function assertTrainingLedgerOpen(
  tx: Pick<Prisma.TransactionClient, 'trainingSettlement'>,
  at: Date,
) {
  const occupied = await tx.trainingSettlement.findFirst({
    where: {
      status: { not: 'VOID' },
      periodStart: { lte: at },
      periodEnd: { gt: at },
    },
    select: { id: true },
  });
  if (occupied)
    throw new ConflictException(
      '该账期已生成培训结算单，请先作废草稿并重新制单',
    );
}

export async function assertTrainingSettlementSources(
  tx: Pick<Prisma.TransactionClient, 'trainingRevenueRecognition'>,
  statement: TrainingSettlement,
) {
  const snapshot = statement.sourceSnapshot as SourceSnapshot | null;
  if (
    !snapshot ||
    snapshot.version !== 1 ||
    !Array.isArray(snapshot.recognitions) ||
    !Array.isArray(snapshot.sessions)
  )
    throw new ConflictException('培训结算缺少来源快照，请作废后重新制单');
  const current = await tx.trainingRevenueRecognition.findMany({
    where: { settlementId: statement.id },
    select: { id: true, effectiveRevenueCents: true },
  });
  const expected = new Map(
    snapshot.recognitions.map((r) => [r.id, r.effectiveRevenueCents]),
  );
  const totals = trainingSnapshotTotals(snapshot);
  const valid =
    expected.size === snapshot.recognitions.length &&
    current.length === expected.size &&
    current.every((r) => expected.get(r.id) === r.effectiveRevenueCents) &&
    statement.effectiveRevenueCents === totals.effectiveRevenueCents &&
    statement.venueContributionCents ===
      signedContribution(totals.effectiveRevenueCents) &&
    statement.coachCostCents === totals.coachCostCents &&
    statement.assistantCostCents === totals.assistantCostCents &&
    statement.materialCostCents === totals.materialCostCents &&
    Number(statement.occupiedCourtHours) === totals.occupiedCourtHours &&
    statement.cashContributionMarginCents ===
      totals.effectiveRevenueCents -
        totals.coachCostCents -
        totals.assistantCostCents -
        totals.materialCostCents -
        statement.acquisitionCostCents -
        statement.marketingCostCents;
  if (!valid)
    throw new ConflictException(
      '培训结算金额与来源不一致，请作废草稿后重新制单',
    );
}

export function trainingTransaction<T>(
  prisma: Pick<PrismaService, '$transaction'>,
  work: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return prisma
    .$transaction(work, { isolationLevel: 'Serializable' })
    .catch((error) => {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        ['P2034', 'P2002', 'P2025'].includes(error.code)
      )
        throw new ConflictException('培训数据发生并发变更，请刷新后重试');
      throw error;
    });
}
