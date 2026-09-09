import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { buildSwissPairings, startingScoreFor } from '@yanqing/shared';
import type { AuthUser } from '../common/auth/auth-user.js';
import type { PrismaService } from '../database/prisma.service.js';
import {
  EventStatus,
  MatchStatus,
  Prisma,
  RegistrationStatus,
} from '../generated/prisma/client.js';
import type { CorrectEventPairingsDto } from './events.dto.js';
import {
  assertCommandKey,
  isPrismaErrorCode,
  normaliseText,
  normaliseOptionalText,
} from './event-command-support.js';
import {
  assertEventManager,
  assertEventConfiguration,
  assertPeopleRange,
  assertParticipantIdsUnique,
  assertFixedDoubles,
  assertRoundMatches,
  assertPairings,
  EVENT_TOTAL_ROUNDS,
} from './event-competition-policy.js';
import { recomputeStandings } from './event-standings.js';

const EVENT_STATUSES_NOT_STARTABLE: readonly EventStatus[] = [
  EventStatus.DRAFT,
  EventStatus.CANCELLED,
  EventStatus.COMPLETED,
];

export async function startNextRound(
  prisma: PrismaService,
  eventId: string,
  actor: AuthUser,
) {
  assertEventManager(actor);
  return prisma.$transaction(
    async (tx) => {
      const event = await tx.event.findUnique({
        where: { id: eventId },
        include: {
          teams: { where: { status: RegistrationStatus.CHECKED_IN } },
          matches: { where: { round: { gt: 0 } } },
        },
      });
      if (!event) throw new NotFoundException('赛事不存在');
      assertEventConfiguration(event);
      if (EVENT_STATUSES_NOT_STARTABLE.includes(event.status)) {
        throw new ConflictException('当前赛事状态不允许生成下一轮配对');
      }
      const currentRound = event.currentRound ?? 0;
      if (
        !Number.isInteger(currentRound) ||
        currentRound < 0 ||
        currentRound > EVENT_TOTAL_ROUNDS
      ) {
        throw new ConflictException('赛事当前轮次数据无效，请先修复赛事配置');
      }
      if (currentRound >= EVENT_TOTAL_ROUNDS)
        throw new ConflictException('所有轮次已经完成');
      assertPeopleRange(event.teams.length, event.capacityPeople);
      assertParticipantIdsUnique(event.teams);
      for (const team of event.teams) assertFixedDoubles(team);

      if (currentRound > 0) {
        // Every team in the previous round must have a terminal result before
        // Swiss ranking is used to generate the next round.
        assertRoundMatches(event.teams, event.matches, currentRound);
      } else if (event.matches.some((match) => match.round > 0)) {
        throw new ConflictException('赛事首轮尚未开始却已存在配对记录');
      }

      const round = currentRound + 1;
      if (event.matches.some((match) => match.round === round)) {
        throw new ConflictException(`第${round}轮配对已经生成，请勿重复操作`);
      }

      let pairings;
      try {
        pairings = buildSwissPairings(
          event.teams.map((team) => ({ ...team, checkedIn: true })),
        );
      } catch (error) {
        throw new ConflictException(
          `无法生成第${round}轮瑞士配对：${error instanceof Error ? error.message : '队伍历史数据不完整'}`,
        );
      }
      assertPairings(
        event.teams.map((team) => team.id),
        pairings,
      );

      const created: Array<{
        id: string;
        round: number;
        teamAId: string;
        teamBId: string | null;
      }> = [];
      const pairingAudit: Array<Record<string, unknown>> = [];
      for (const [index, pairing] of pairings.entries()) {
        const teamA = event.teams.find((team) => team.id === pairing.pairAId);
        if (!teamA) throw new ConflictException('瑞士配对缺少队伍');
        if (pairing.isBye) {
          const match = await tx.eventMatch.create({
            data: {
              eventId,
              round,
              courtLabel: '轮空',
              teamAId: teamA.id,
              teamBId: null,
              scoreA: 21,
              scoreB: 0,
              status: MatchStatus.CONFIRMED,
              confirmedAt: new Date(),
            },
          });
          await tx.eventTeam.update({
            where: { id: teamA.id },
            data: {
              points: { increment: 1 },
              wins: { increment: 1 },
              opponents: { push: 'BYE' },
            },
          });
          created.push(match);
          pairingAudit.push({
            matchId: match.id,
            teamAId: teamA.id,
            teamBId: null,
            isBye: true,
            startingScoreA: 0,
            startingScoreB: 0,
          });
          continue;
        }
        const teamB = event.teams.find((team) => team.id === pairing.pairBId);
        if (!teamB) throw new ConflictException('瑞士配对缺少对手队伍');
        const [startingScoreA, startingScoreB] = startingScoreFor(
          teamA.category,
          teamB.category,
        );
        const match = await tx.eventMatch.create({
          data: {
            eventId,
            round,
            courtLabel: `${index + 1}号场`,
            teamAId: teamA.id,
            teamBId: teamB.id,
            startingScoreA,
            startingScoreB,
          },
        });
        created.push(match);
        pairingAudit.push({
          matchId: match.id,
          teamAId: teamA.id,
          teamBId: teamB.id,
          isBye: false,
          startingScoreA,
          startingScoreB,
        });
      }
      await tx.event.update({
        where: { id: eventId },
        data: { currentRound: round, status: EventStatus.IN_PROGRESS },
      });
      await tx.auditLog.create({
        data: {
          actorId: actor.sub,
          actorRole: actor.roles[0],
          action: 'EVENT_ROUND_STARTED',
          objectType: 'Event',
          objectId: eventId,
          oldValue: { currentRound, status: event.status } as never,
          newValue: {
            round,
            pairingCount: created.length,
            pairings: pairingAudit,
          } as never,
        },
      });
      return created;
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}

export async function correctPairings(
  prisma: PrismaService,
  eventId: string,
  round: number,
  dto: CorrectEventPairingsDto,
  actor: AuthUser,
) {
  assertEventManager(actor);
  if (!Number.isInteger(round) || round < 1 || round > EVENT_TOTAL_ROUNDS) {
    throw new BadRequestException(
      `赛事轮次必须在1-${EVENT_TOTAL_ROUNDS}轮之间`,
    );
  }
  const reason = normaliseText(dto.reason);
  if (reason.length < 2) {
    throw new BadRequestException('人工调整配对必须填写至少2个字的原因');
  }
  const idempotencyKey = normaliseText(dto.idempotencyKey);
  assertCommandKey(idempotencyKey, '配对调整幂等键');
  const pairings = dto.pairings.map((pairing, index) => ({
    pairAId: normaliseText(pairing.teamAId),
    pairBId: normaliseOptionalText(pairing.teamBId) ?? null,
    isBye: !normaliseOptionalText(pairing.teamBId),
    courtLabel:
      normaliseOptionalText(pairing.courtLabel) ??
      (!normaliseOptionalText(pairing.teamBId) ? '轮空' : `${index + 1}号场`),
  }));
  if (pairings.some((pairing) => !pairing.pairAId)) {
    throw new BadRequestException('人工配对缺少第一支队伍');
  }
  const requestId = `EVENT_PAIRINGS:${idempotencyKey}`;
  const commandHash = createHash('sha256')
    .update(JSON.stringify({ eventId, round, reason, pairings }))
    .digest('hex');

  const assertReplay = (audit: { newValue: unknown }) => {
    const value = audit.newValue as { commandHash?: unknown } | null;
    if (value?.commandHash !== commandHash) {
      throw new ConflictException('配对调整幂等键已用于其他指令，请更换幂等键');
    }
  };
  const loadRound = (client: Prisma.TransactionClient | PrismaService) =>
    client.eventMatch.findMany({
      where: { eventId, round },
      orderBy: { createdAt: 'asc' },
    });

  try {
    return await prisma.$transaction(
      async (tx) => {
        const replay = await tx.auditLog.findFirst({
          where: { requestId, action: 'EVENT_PAIRINGS_CORRECTED' },
        });
        if (replay) {
          assertReplay(replay);
          return loadRound(tx);
        }

        const event = await tx.event.findUnique({
          where: { id: eventId },
          include: {
            teams: { where: { status: RegistrationStatus.CHECKED_IN } },
            matches: { where: { round }, orderBy: { createdAt: 'asc' } },
          },
        });
        if (!event) throw new NotFoundException('赛事不存在');
        assertEventConfiguration(event);
        if (
          event.status !== EventStatus.IN_PROGRESS ||
          event.currentRound !== round
        ) {
          throw new ConflictException('只能调整当前进行中轮次的配对');
        }
        assertPeopleRange(event.teams.length, event.capacityPeople);
        assertParticipantIdsUnique(event.teams);
        for (const team of event.teams) assertFixedDoubles(team);
        if (!event.matches.length) {
          throw new ConflictException(`第${round}轮尚未生成配对`);
        }
        if (
          event.matches.some(
            (match) =>
              match.teamBId !== null &&
              (match.status !== MatchStatus.PENDING ||
                match.scoreA !== null ||
                match.scoreB !== null),
          )
        ) {
          throw new ConflictException(
            '本轮已有比分或已进入确认流程，不能再调整配对',
          );
        }

        assertPairings(
          event.teams.map((team) => team.id),
          pairings,
        );
        const oldPairings = event.matches.map((match) => ({
          teamAId: match.teamAId,
          teamBId: match.teamBId,
          courtLabel: match.courtLabel,
        }));
        const signature = (items: typeof oldPairings) =>
          JSON.stringify(
            [...items].sort((left, right) =>
              `${left.teamAId}:${left.teamBId ?? ''}`.localeCompare(
                `${right.teamAId}:${right.teamBId ?? ''}`,
              ),
            ),
          );
        const newPairings = pairings.map((pairing) => ({
          teamAId: pairing.pairAId,
          teamBId: pairing.pairBId,
          courtLabel: pairing.courtLabel,
        }));
        if (signature(oldPairings) === signature(newPairings)) {
          throw new BadRequestException('人工调整后的配对与当前配对相同');
        }

        await tx.eventMatch.deleteMany({ where: { eventId, round } });
        const created = [];
        for (const pairing of pairings) {
          const teamA = event.teams.find((team) => team.id === pairing.pairAId);
          const teamB = event.teams.find((team) => team.id === pairing.pairBId);
          if (!teamA) throw new ConflictException('人工配对缺少队伍');
          const startingScore = teamB
            ? startingScoreFor(teamA.category, teamB.category)
            : ([0, 0] as const);
          created.push(
            await tx.eventMatch.create({
              data: {
                eventId,
                round,
                courtLabel: pairing.courtLabel,
                teamAId: teamA.id,
                teamBId: teamB?.id ?? null,
                startingScoreA: startingScore[0],
                startingScoreB: startingScore[1],
                scoreA: teamB ? null : 21,
                scoreB: teamB ? null : 0,
                status: teamB ? MatchStatus.PENDING : MatchStatus.CONFIRMED,
                confirmedAt: teamB ? null : new Date(),
              },
            }),
          );
        }
        await recomputeStandings(tx, eventId);
        await tx.auditLog.create({
          data: {
            actorId: actor.sub,
            actorRole: actor.roles[0],
            action: 'EVENT_PAIRINGS_CORRECTED',
            objectType: 'Event',
            objectId: eventId,
            oldValue: { round, pairings: oldPairings } as never,
            newValue: {
              round,
              pairings: newPairings,
              commandHash,
            } as never,
            reason,
            requestId,
          },
        });
        return created;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  } catch (error) {
    if (isPrismaErrorCode(error, 'P2034')) {
      const replay = await prisma.auditLog.findFirst({
        where: { requestId, action: 'EVENT_PAIRINGS_CORRECTED' },
      });
      if (replay) {
        assertReplay(replay);
        return loadRound(prisma);
      }
      throw new ConflictException('配对调整发生并发冲突，请刷新后重试');
    }
    throw error;
  }
}
