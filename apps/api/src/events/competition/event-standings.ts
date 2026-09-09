import { ConflictException } from '@nestjs/common';
import { validateEventScore } from '@yanqing/shared';
import { MatchStatus, type Prisma } from '../../generated/prisma/client.js';

export async function recomputeStandings(
  tx: Prisma.TransactionClient,
  eventId: string,
): Promise<void> {
  const [teams, matches] = await Promise.all([
    tx.eventTeam.findMany({ where: { eventId } }),
    tx.eventMatch.findMany({
      where: {
        eventId,
        status: { in: [MatchStatus.CONFIRMED, MatchStatus.CORRECTED] },
      },
      orderBy: [{ round: 'asc' }, { createdAt: 'asc' }],
    }),
  ]);
  const state = new Map(
    teams.map((team) => [
      team.id,
      {
        points: 0,
        wins: 0,
        losses: 0,
        scoreDiff: 0,
        opponents: [] as string[],
      },
    ]),
  );
  for (const match of matches) {
    const a = state.get(match.teamAId);
    if (!a) continue;
    if (!match.teamBId) {
      a.points += 1;
      a.wins += 1;
      a.opponents.push('BYE');
      continue;
    }
    const b = state.get(match.teamBId);
    if (!b || match.scoreA === null || match.scoreB === null) continue;
    try {
      validateEventScore(
        match.scoreA,
        match.scoreB,
        match.startingScoreA,
        match.startingScoreB,
      );
    } catch (error) {
      throw new ConflictException(
        `赛事存在无效比分（${match.id}）：${error instanceof Error ? error.message : '请重新录入'}`,
      );
    }
    const aWon = match.scoreA > match.scoreB;
    a.points += aWon ? 1 : 0;
    b.points += aWon ? 0 : 1;
    a.wins += aWon ? 1 : 0;
    b.wins += aWon ? 0 : 1;
    a.losses += aWon ? 0 : 1;
    b.losses += aWon ? 1 : 0;
    a.scoreDiff += match.scoreA - match.scoreB;
    b.scoreDiff += match.scoreB - match.scoreA;
    a.opponents.push(match.teamBId);
    b.opponents.push(match.teamAId);
  }
  for (const [teamId, values] of state) {
    await tx.eventTeam.update({ where: { id: teamId }, data: values });
  }
}
