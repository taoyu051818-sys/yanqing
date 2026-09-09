import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { validateEventScore } from '@yanqing/shared';
import type { AuthUser } from '../common/auth/auth-user.js';
import type { PrismaService } from '../database/prisma.service.js';
import {
  EventStatus,
  MatchStatus,
  Prisma,
} from '../generated/prisma/client.js';
import type { SubmitScoreDto, CorrectScoreDto } from './events.dto.js';
import { isPrismaErrorCode } from './event-command-support.js';
import {
  isTerminalMatch,
  EVENT_TOTAL_ROUNDS,
} from './event-competition-policy.js';
import { recomputeStandings } from './event-standings.js';

const SCORE_CONCURRENCY_MESSAGE = '比分已被其他操作提交，请刷新后重试';

const MATCH_STATUSES_ACCEPTING_SCORE: readonly MatchStatus[] = [
  MatchStatus.PENDING,
  MatchStatus.IN_PROGRESS,
  MatchStatus.SUBMITTED,
];

export async function submitScore(
  prisma: PrismaService,
  matchId: string,
  dto: SubmitScoreDto,
  actor: AuthUser,
) {
  try {
    return await prisma.$transaction(
      async (tx) => {
        const match = await tx.eventMatch.findUnique({
          where: { id: matchId },
        });
        if (!match?.teamBId) throw new NotFoundException('对阵不存在');
        if (match.round < 1 || match.round > EVENT_TOTAL_ROUNDS) {
          throw new ConflictException('赛事轮次数据无效，不能录入比分');
        }
        if (!MATCH_STATUSES_ACCEPTING_SCORE.includes(match.status)) {
          throw new ConflictException('比分已确认，修正请使用纠错接口');
        }
        try {
          // The starting handicap is part of the match snapshot.  Both normal
          // submission and correction must validate against it, otherwise a
          // player could submit a score below the handicap or above 21.
          validateEventScore(
            dto.scoreA,
            dto.scoreB,
            match.startingScoreA,
            match.startingScoreB,
          );
        } catch (error) {
          throw new BadRequestException(
            error instanceof Error ? error.message : '比分无效',
          );
        }
        const teamAWon = dto.scoreA > dto.scoreB;

        // Compare-and-set the match state before touching either team.  A
        // plain update after a non-locking read allows two concurrent
        // requests to both increment standings and append opponents.  The
        // status predicate is evaluated atomically by the database; only
        // the request that moves PENDING/IN_PROGRESS/SUBMITTED -> CONFIRMED
        // may continue.  Prisma reports a lost compare-and-set as P2025.
        try {
          await tx.eventMatch.update({
            where: {
              id: matchId,
              status: { in: [...MATCH_STATUSES_ACCEPTING_SCORE] },
            },
            data: {
              scoreA: dto.scoreA,
              scoreB: dto.scoreB,
              status: MatchStatus.CONFIRMED,
              submittedById: actor.sub,
              confirmedById: actor.sub,
              submittedAt: new Date(),
              confirmedAt: new Date(),
            },
          });
        } catch (error) {
          if (
            isPrismaErrorCode(error, 'P2025') ||
            isPrismaErrorCode(error, 'P2034')
          ) {
            throw new ConflictException(SCORE_CONCURRENCY_MESSAGE);
          }
          throw error;
        }

        // All writes below are in the same transaction as the compare-and-
        // set.  If either team update or the audit insert fails, the match
        // confirmation is rolled back as well, so there is no partially
        // counted score to reconcile later.
        await tx.eventTeam.update({
          where: { id: match.teamAId },
          data: {
            points: { increment: teamAWon ? 1 : 0 },
            wins: { increment: teamAWon ? 1 : 0 },
            losses: { increment: teamAWon ? 0 : 1 },
            scoreDiff: { increment: dto.scoreA - dto.scoreB },
            opponents: { push: match.teamBId },
          },
        });
        await tx.eventTeam.update({
          where: { id: match.teamBId },
          data: {
            points: { increment: teamAWon ? 0 : 1 },
            wins: { increment: teamAWon ? 0 : 1 },
            losses: { increment: teamAWon ? 1 : 0 },
            scoreDiff: { increment: dto.scoreB - dto.scoreA },
            opponents: { push: match.teamAId },
          },
        });
        await tx.auditLog.create({
          data: {
            actorId: actor.sub,
            actorRole: actor.roles[0],
            action: 'EVENT_SCORE_SUBMITTED',
            objectType: 'EventMatch',
            objectId: matchId,
            oldValue: {
              status: match.status,
              scoreA: match.scoreA,
              scoreB: match.scoreB,
            } as never,
            newValue: {
              status: MatchStatus.CONFIRMED,
              scoreA: dto.scoreA,
              scoreB: dto.scoreB,
              startingScoreA: match.startingScoreA,
              startingScoreB: match.startingScoreB,
            } as never,
          },
        });
        return tx.eventMatch.findUniqueOrThrow({ where: { id: matchId } });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  } catch (error) {
    // PostgreSQL can reject a Serializable transaction at commit time with
    // P2034, outside the callback above.  Surface it as the same safe,
    // retryable business conflict instead of leaking a 500 response.
    if (isPrismaErrorCode(error, 'P2034')) {
      throw new ConflictException(SCORE_CONCURRENCY_MESSAGE);
    }
    throw error;
  }
}

export async function correctScore(
  prisma: PrismaService,
  matchId: string,
  dto: CorrectScoreDto,
  actor: AuthUser,
) {
  try {
    return await prisma.$transaction(
      async (tx) => {
        const match = await tx.eventMatch.findUnique({
          where: { id: matchId },
        });
        if (!match?.teamBId) throw new NotFoundException('对阵不存在');
        const event = await tx.event.findUnique({
          where: { id: match.eventId },
          select: { status: true },
        });
        if (!event) throw new NotFoundException('赛事不存在');
        if (event.status !== EventStatus.IN_PROGRESS) {
          throw new ConflictException(
            event.status === EventStatus.COMPLETED
              ? '赛事已完赛封账，不能再纠正比分'
              : '当前赛事不在进行中，不能纠正比分',
          );
        }
        if (match.round < 1 || match.round > EVENT_TOTAL_ROUNDS) {
          throw new ConflictException('赛事轮次数据无效，不能纠正比分');
        }
        if (!isTerminalMatch(match.status)) {
          throw new ConflictException('只有已确认比分才能发起纠错');
        }
        try {
          validateEventScore(
            dto.scoreA,
            dto.scoreB,
            match.startingScoreA,
            match.startingScoreB,
          );
        } catch (error) {
          throw new BadRequestException(
            error instanceof Error ? error.message : '比分无效',
          );
        }
        await tx.eventMatch.update({
          where: { id: matchId },
          data: {
            scoreA: dto.scoreA,
            scoreB: dto.scoreB,
            status: MatchStatus.CORRECTED,
            correctionReason: dto.reason,
            confirmedById: actor.sub,
            confirmedAt: new Date(),
          },
        });
        await recomputeStandings(tx, match.eventId);
        await tx.auditLog.create({
          data: {
            actorId: actor.sub,
            actorRole: actor.roles[0],
            action: 'EVENT_SCORE_CORRECTED',
            objectType: 'EventMatch',
            objectId: matchId,
            oldValue: {
              status: match.status,
              scoreA: match.scoreA,
              scoreB: match.scoreB,
              startingScoreA: match.startingScoreA,
              startingScoreB: match.startingScoreB,
            } as never,
            newValue: {
              status: MatchStatus.CORRECTED,
              scoreA: dto.scoreA,
              scoreB: dto.scoreB,
              startingScoreA: match.startingScoreA,
              startingScoreB: match.startingScoreB,
            } as never,
            reason: dto.reason,
          },
        });
        return tx.eventMatch.findUniqueOrThrow({ where: { id: matchId } });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  } catch (error) {
    if (isPrismaErrorCode(error, 'P2034')) {
      throw new ConflictException(
        '赛事封账或比分已被其他操作更新，请刷新后重试',
      );
    }
    throw error;
  }
}
