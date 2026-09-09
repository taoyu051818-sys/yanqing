import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { validateEventScore } from '@yanqing/shared';
import type { AuthUser } from '../common/auth/auth-user.js';
import { AppRole, MatchStatus } from '../generated/prisma/enums.js';
import {
  normaliseText,
  normaliseOptionalText,
} from './event-command-support.js';

/** Fixed tournament format shared by transport validation and domain commands. */
export const EVENT_MINIMUM_PEOPLE = 24 as const;

export const EVENT_MAX_CAPACITY_PEOPLE = 48 as const;

export const EVENT_TOTAL_ROUNDS = 5 as const;

export const TERMINAL_MATCH_STATUSES: MatchStatus[] = [
  MatchStatus.CONFIRMED,
  MatchStatus.CORRECTED,
];

export const isTerminalMatch = (status: MatchStatus): boolean =>
  TERMINAL_MATCH_STATUSES.includes(status);

export const EVENT_MANAGER_ROLES: readonly AppRole[] = [
  AppRole.EVENT_MANAGER,
  AppRole.ADMIN,
  AppRole.SUPER_ADMIN,
];

/**
 * Validate the locked tournament format at the API boundary.  The database
 * schema predates these invariants, so the service must also validate values
 * loaded from existing rows before using them for pairing or scoring.
 */
export function assertEventConfiguration(
  event: {
    capacityPeople: number;
    minimumPeople: number;
    totalRounds: number;
  },
  mode: 'create' | 'stored' = 'stored',
): void {
  const fail = (message: string): never => {
    if (mode === 'create') throw new BadRequestException(message);
    throw new ConflictException(message);
  };

  if (
    !Number.isInteger(event.totalRounds) ||
    event.totalRounds !== EVENT_TOTAL_ROUNDS
  ) {
    fail(`赛事必须固定为${EVENT_TOTAL_ROUNDS}轮瑞士制`);
  }
  if (
    !Number.isInteger(event.minimumPeople) ||
    event.minimumPeople !== EVENT_MINIMUM_PEOPLE
  ) {
    fail(`赛事成赛人数必须固定为${EVENT_MINIMUM_PEOPLE}人`);
  }
  if (
    !Number.isInteger(event.capacityPeople) ||
    event.capacityPeople < EVENT_MINIMUM_PEOPLE ||
    event.capacityPeople > EVENT_MAX_CAPACITY_PEOPLE ||
    event.capacityPeople % 2 !== 0
  ) {
    fail(
      `赛事容量必须为${EVENT_MINIMUM_PEOPLE}-${EVENT_MAX_CAPACITY_PEOPLE}人且为双数`,
    );
  }
}

export function assertFixedDoubles(
  team: {
    playerAName: string | null | undefined;
    playerBName: string | null | undefined;
    playerAUserId?: string | null;
    playerBUserId?: string | null;
    playerAPhone?: string | null;
    playerBPhone?: string | null;
  },
  mode: 'create' | 'stored' = 'stored',
): void {
  const fail = (message: string): never => {
    if (mode === 'create') throw new BadRequestException(message);
    throw new ConflictException(message);
  };
  const playerAName = normaliseText(team.playerAName);
  const playerBName = normaliseText(team.playerBName);
  if (!playerAName || !playerBName) fail('固定双打必须填写两名队员');
  if (
    playerAName.toLocaleLowerCase() === playerBName.toLocaleLowerCase() &&
    !(
      team.playerAPhone &&
      team.playerBPhone &&
      team.playerAPhone !== team.playerBPhone
    )
  ) {
    fail('固定双打的两名队员不能相同');
  }
  const playerAUserId = normaliseOptionalText(team.playerAUserId);
  const playerBUserId = normaliseOptionalText(team.playerBUserId);
  if (playerAUserId && playerBUserId && playerAUserId === playerBUserId) {
    fail('固定双打的两名账号不能相同');
  }
}

export function assertParticipantIdsUnique(
  teams: ReadonlyArray<{
    playerAUserId?: string | null;
    playerBUserId?: string | null;
  }>,
): void {
  const seen = new Set<string>();
  for (const team of teams) {
    for (const userId of [team.playerAUserId, team.playerBUserId]) {
      const normalized = normaliseOptionalText(userId);
      if (!normalized) continue;
      if (seen.has(normalized)) {
        throw new ConflictException(
          '同一账号不能参加同一赛事的多个固定双打队伍',
        );
      }
      seen.add(normalized);
    }
  }
}

export function assertPeopleRange(
  teamCount: number,
  capacityPeople: number,
): void {
  const people = teamCount * 2;
  if (people < EVENT_MINIMUM_PEOPLE) {
    throw new ConflictException(
      `签到人数不足${EVENT_MINIMUM_PEOPLE}人，暂不能开赛`,
    );
  }
  if (people > capacityPeople || people > EVENT_MAX_CAPACITY_PEOPLE) {
    throw new ConflictException(`签到人数超过赛事${capacityPeople}人容量`);
  }
}

export function assertRoundMatches(
  teams: ReadonlyArray<{
    id: string;
    playerAName: string;
    playerBName: string;
    playerAUserId: string | null;
    playerBUserId: string | null;
  }>,
  matches: ReadonlyArray<{
    id: string;
    round: number;
    teamAId: string;
    teamBId: string | null;
    startingScoreA: number;
    startingScoreB: number;
    scoreA: number | null;
    scoreB: number | null;
    status: MatchStatus;
  }>,
  round: number,
  options: { requireTerminal: boolean } = { requireTerminal: true },
): void {
  if (!Number.isInteger(round) || round < 1 || round > EVENT_TOTAL_ROUNDS) {
    throw new ConflictException(`赛事轮次必须在1-${EVENT_TOTAL_ROUNDS}轮之间`);
  }
  const teamIds = new Set(teams.map((team) => team.id));
  const roundMatches = matches.filter((match) => match.round === round);
  const expectedMatchCount = Math.ceil(teams.length / 2);
  if (roundMatches.length !== expectedMatchCount) {
    throw new ConflictException(
      `第${round}轮配对记录不完整，应有${expectedMatchCount}场，实际${roundMatches.length}场`,
    );
  }

  const appearances = new Set<string>();
  const pairKeys = new Set<string>();
  let byeCount = 0;
  for (const match of roundMatches) {
    if (!teamIds.has(match.teamAId)) {
      throw new ConflictException(`第${round}轮存在不在签到名单中的队伍`);
    }
    if (appearances.has(match.teamAId)) {
      throw new ConflictException(`第${round}轮队伍重复配对`);
    }
    appearances.add(match.teamAId);

    if (match.teamBId === null) {
      byeCount += 1;
      if (match.scoreA !== 21 || match.scoreB !== 0) {
        throw new ConflictException(`第${round}轮轮空结果必须为21-0`);
      }
    } else {
      if (!teamIds.has(match.teamBId) || match.teamAId === match.teamBId) {
        throw new ConflictException(`第${round}轮存在无效对阵`);
      }
      if (appearances.has(match.teamBId)) {
        throw new ConflictException(`第${round}轮队伍重复配对`);
      }
      appearances.add(match.teamBId);
      const pairKey = [match.teamAId, match.teamBId].sort().join(':');
      if (pairKeys.has(pairKey)) {
        throw new ConflictException(`第${round}轮存在重复对阵`);
      }
      pairKeys.add(pairKey);
      if (options.requireTerminal && !isTerminalMatch(match.status)) {
        throw new ConflictException(`第${round}轮仍有未确认比分`);
      }
      if (match.scoreA === null || match.scoreB === null) {
        throw new ConflictException(`第${round}轮存在空比分`);
      }
      try {
        validateEventScore(
          match.scoreA,
          match.scoreB,
          match.startingScoreA,
          match.startingScoreB,
        );
      } catch (error) {
        throw new ConflictException(
          `第${round}轮存在无效比分：${error instanceof Error ? error.message : '请重新录入'}`,
        );
      }
    }
  }

  if (appearances.size !== teams.length) {
    throw new ConflictException(`第${round}轮未覆盖全部签到队伍`);
  }
  if (byeCount !== teams.length % 2) {
    throw new ConflictException(`第${round}轮轮空数量不正确`);
  }
}

export function assertPairings(
  teamIds: readonly string[],
  pairings: ReadonlyArray<{
    pairAId: string;
    pairBId: string | null;
    isBye: boolean;
  }>,
): void {
  const allowed = new Set(teamIds);
  const seen = new Set<string>();
  let byeCount = 0;
  for (const pairing of pairings) {
    if (!allowed.has(pairing.pairAId) || seen.has(pairing.pairAId)) {
      throw new ConflictException('瑞士配对包含重复或无效队伍');
    }
    seen.add(pairing.pairAId);
    if (pairing.isBye || pairing.pairBId === null) {
      byeCount += 1;
      if (pairing.pairBId !== null) {
        throw new ConflictException('轮空配对不能包含第二支队伍');
      }
      continue;
    }
    if (
      !allowed.has(pairing.pairBId) ||
      seen.has(pairing.pairBId) ||
      pairing.pairAId === pairing.pairBId
    ) {
      throw new ConflictException('瑞士配对包含重复或无效队伍');
    }
    seen.add(pairing.pairBId);
  }
  if (seen.size !== teamIds.length || byeCount !== teamIds.length % 2) {
    throw new ConflictException('瑞士配对未覆盖全部签到队伍');
  }
}

export function assertEventManager(actor: AuthUser): void {
  if (!actor.roles.some((role) => EVENT_MANAGER_ROLES.includes(role))) {
    throw new ForbiddenException('仅赛事管理员或管理员可创建、发布赛事');
  }
}
