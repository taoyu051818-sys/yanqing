import { ConflictException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import type { AuthUser } from '../common/auth/auth-user.js';
import {
  AppRole,
  EventStatus,
  MatchStatus,
  RegistrationStatus,
  TeamCategory,
} from '../generated/prisma/enums.js';
import type { CorrectEventPairingsDto } from './events.dto.js';
import { EventsService } from './events.service.js';

const manager: AuthUser = {
  sub: 'event-manager-1',
  displayName: '赛事管理员',
  roles: [AppRole.EVENT_MANAGER],
};

const teams = Array.from({ length: 12 }, (_, index) => ({
  id: `team-${index + 1}`,
  playerAName: `队员${index * 2 + 1}`,
  playerBName: `队员${index * 2 + 2}`,
  playerAUserId: `player-${index * 2 + 1}`,
  playerBUserId: `player-${index * 2 + 2}`,
  category:
    index % 3 === 0
      ? TeamCategory.MEN_DOUBLES
      : index % 3 === 1
        ? TeamCategory.WOMEN_DOUBLES
        : TeamCategory.MIXED_DOUBLES,
  status: RegistrationStatus.CHECKED_IN,
}));

const currentMatches = Array.from({ length: 6 }, (_, index) => ({
  id: `match-${index + 1}`,
  eventId: 'event-1',
  round: 2,
  teamAId: teams[index * 2].id,
  teamBId: teams[index * 2 + 1].id,
  courtLabel: `${index + 1}号场`,
  startingScoreA: 0,
  startingScoreB: 0,
  scoreA: null,
  scoreB: null,
  status: MatchStatus.PENDING,
  createdAt: new Date(`2026-08-30T01:0${index}:00.000Z`),
}));

const dto = (): CorrectEventPairingsDto => ({
  pairings: currentMatches.map((match, index) => ({
    teamAId: match.teamAId,
    teamBId:
      index === 0
        ? currentMatches[1].teamBId!
        : index === 1
          ? currentMatches[0].teamBId!
          : match.teamBId!,
    courtLabel: match.courtLabel,
  })),
  reason: '同俱乐部队伍首轮已相遇，现场复核后换对手',
  idempotencyKey: 'pairing-correction-key-1',
});

const event = (matches = currentMatches) => ({
  id: 'event-1',
  status: EventStatus.IN_PROGRESS,
  currentRound: 2,
  capacityPeople: 48,
  minimumPeople: 24,
  totalRounds: 5,
  teams,
  matches,
});

describe('EventsService manual pairing correction', () => {
  it('replaces the complete unplayed round, recalculates handicaps and writes one audit', async () => {
    const created: any[] = [];
    let audit: any = null;
    const tx = {
      auditLog: {
        findFirst: vi.fn(async () => audit),
        create: vi.fn(async ({ data }: any) => {
          audit = data;
          return data;
        }),
      },
      event: { findUnique: vi.fn().mockResolvedValue(event()) },
      eventMatch: {
        deleteMany: vi.fn().mockResolvedValue({ count: 6 }),
        create: vi.fn(async ({ data }: any) => {
          const row = {
            id: `corrected-${created.length + 1}`,
            createdAt: new Date(),
            ...data,
          };
          created.push(row);
          return row;
        }),
        findMany: vi.fn(async () => created),
      },
      eventTeam: {
        findMany: vi.fn().mockResolvedValue(teams),
        update: vi.fn().mockResolvedValue({}),
      },
    };
    const service = new EventsService({
      $transaction: vi.fn(async (work: (client: typeof tx) => unknown) =>
        work(tx),
      ),
      auditLog: tx.auditLog,
      eventMatch: tx.eventMatch,
    } as never);

    const first = await service.correctPairings('event-1', 2, dto(), manager);
    const replay = await service.correctPairings('event-1', 2, dto(), manager);

    expect(first).toHaveLength(6);
    expect(replay).toHaveLength(6);
    expect(tx.eventMatch.deleteMany).toHaveBeenCalledOnce();
    expect(tx.eventMatch.create).toHaveBeenCalledTimes(6);
    expect(created[0]).toMatchObject({
      teamAId: 'team-1',
      teamBId: 'team-4',
      startingScoreA: 0,
      startingScoreB: 0,
      status: MatchStatus.PENDING,
    });
    expect(created[1]).toMatchObject({
      teamAId: 'team-3',
      teamBId: 'team-2',
      startingScoreA: 0,
      startingScoreB: 2,
    });
    expect(tx.auditLog.create).toHaveBeenCalledOnce();
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'EVENT_PAIRINGS_CORRECTED',
        objectId: 'event-1',
        reason: dto().reason,
        requestId: 'EVENT_PAIRINGS:pairing-correction-key-1',
      }),
    });
  });

  it('locks pairings as soon as an actual match has a confirmed result', async () => {
    const locked = [
      { ...currentMatches[0], status: MatchStatus.CONFIRMED, scoreA: 21, scoreB: 18 },
      ...currentMatches.slice(1),
    ];
    const tx = {
      auditLog: { findFirst: vi.fn().mockResolvedValue(null), create: vi.fn() },
      event: { findUnique: vi.fn().mockResolvedValue(event(locked)) },
      eventMatch: { deleteMany: vi.fn(), create: vi.fn() },
    };
    const service = new EventsService({
      $transaction: vi.fn(async (work: (client: typeof tx) => unknown) => work(tx)),
    } as never);

    await expect(
      service.correctPairings('event-1', 2, dto(), manager),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(tx.eventMatch.deleteMany).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });
});
