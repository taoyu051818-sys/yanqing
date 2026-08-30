import { randomBytes } from 'node:crypto';

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  buildSwissPairings,
  eventPointsForRank,
  rankSwissPairs,
  startingScoreFor,
  validateEventScore,
} from '@yanqing/shared';

import type { AuthUser } from '../common/auth/auth-user.js';
import { PrismaService } from '../database/prisma.service.js';
import {
  AccountTxnKind,
  AccountType,
  AppRole,
  BusinessType,
  EventPrizeStatus,
  EventStatus,
  InventoryTxnType,
  MatchStatus,
  OrderStatus,
  Prisma,
  RegistrationStatus,
  SubjectAccount,
} from '../generated/prisma/client.js';
import { applyInventoryDelta } from '../inventory/inventory-balance.js';
import {
  executeOrderCreation,
  type OrderCreationFields,
} from '../orders/order-creation-idempotency.js';
import type {
  CorrectScoreDto,
  CreateEventDto,
  IssueEventPrizeDto,
  PublishEventDto,
  ReceiveEventPrizeDto,
  RegisterEventTeamDto,
  SubmitScoreDto,
} from './events.dto.js';
import {
  EVENT_MAX_CAPACITY_PEOPLE,
  EVENT_MINIMUM_PEOPLE,
  EVENT_TOTAL_ROUNDS,
} from './events.dto.js';

const serial = (prefix: string) =>
  `${prefix}${new Date().toISOString().replace(/\D/g, '').slice(0, 14)}${randomBytes(3).toString('hex').toUpperCase()}`;

const DEFAULT_RULES = [
  '固定搭档双打，男双、女双、混双同场',
  '每场一局 21 分，20 平后不加分',
  '男双对女双让 5 分，男双对混双让 2 分，混双对女双让 2 分',
  '五轮瑞士积分制，尽量避免重复对手',
];

const TERMINAL_MATCH_STATUSES: MatchStatus[] = [
  MatchStatus.CONFIRMED,
  MatchStatus.CORRECTED,
];

const isTerminalMatch = (status: MatchStatus): boolean =>
  TERMINAL_MATCH_STATUSES.includes(status);

const isPrismaErrorCode = (error: unknown, code: string): boolean =>
  typeof error === 'object' &&
  error !== null &&
  'code' in error &&
  (error as { code?: unknown }).code === code;

const SCORE_CONCURRENCY_MESSAGE = '比分已被其他操作提交，请刷新后重试';

const EVENT_STATUSES_NOT_STARTABLE: readonly EventStatus[] = [
  EventStatus.DRAFT,
  EventStatus.CANCELLED,
  EventStatus.COMPLETED,
];

const EVENT_STATUSES_NOT_FINISHABLE: readonly EventStatus[] = [
  EventStatus.DRAFT,
  EventStatus.CANCELLED,
];

// FRONT_DESK is the current inventory-custodian role used by the stock
// centre.  Prize hand-over is shared with event operations, while members,
// coaches and finance cannot mutate prize inventory.
const EVENT_PRIZE_OPERATOR_ROLES: readonly AppRole[] = [
  AppRole.EVENT_MANAGER,
  AppRole.FRONT_DESK,
  AppRole.ADMIN,
  AppRole.SUPER_ADMIN,
];

const MATCH_STATUSES_ACCEPTING_SCORE: readonly MatchStatus[] = [
  MatchStatus.PENDING,
  MatchStatus.IN_PROGRESS,
  MatchStatus.SUBMITTED,
];

const normaliseText = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const normaliseOptionalText = (value: unknown): string | undefined => {
  const text = normaliseText(value);
  return text || undefined;
};

const parseDate = (value: unknown, field: string): Date => {
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) {
    throw new BadRequestException(`${field} 不是有效时间`);
  }
  return date;
};

@Injectable()
export class EventsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Validate the locked tournament format at the API boundary.  The database
   * schema predates these invariants, so the service must also validate values
   * loaded from existing rows before using them for pairing or scoring.
   */
  private assertEventConfiguration(
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

  private assertFixedDoubles(
    team: {
      playerAName: string | null | undefined;
      playerBName: string | null | undefined;
      playerAUserId?: string | null;
      playerBUserId?: string | null;
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
    if (playerAName.toLocaleLowerCase() === playerBName.toLocaleLowerCase()) {
      fail('固定双打的两名队员不能相同');
    }
    const playerAUserId = normaliseOptionalText(team.playerAUserId);
    const playerBUserId = normaliseOptionalText(team.playerBUserId);
    if (playerAUserId && playerBUserId && playerAUserId === playerBUserId) {
      fail('固定双打的两名账号不能相同');
    }
  }

  private assertParticipantIdsUnique(
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

  private assertPeopleRange(teamCount: number, capacityPeople: number): void {
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

  private assertRoundMatches(
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
      throw new ConflictException(
        `赛事轮次必须在1-${EVENT_TOTAL_ROUNDS}轮之间`,
      );
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

  private assertPairings(
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

  list() {
    return this.prisma.event.findMany({
      include: { _count: { select: { teams: true } } },
      orderBy: { startsAt: 'desc' },
    });
  }

  detail(eventId: string) {
    return this.prisma.event.findUniqueOrThrow({
      where: { id: eventId },
      include: {
        teams: {
          orderBy: [{ points: 'desc' }, { scoreDiff: 'desc' }, { seed: 'asc' }],
        },
        matches: { orderBy: [{ round: 'asc' }, { createdAt: 'asc' }] },
      },
    });
  }

  async listPrizeAwards(eventId: string) {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      select: { id: true },
    });
    if (!event) throw new NotFoundException('赛事不存在');
    return this.prisma.eventPrizeAward.findMany({
      where: { eventId },
      include: {
        team: { select: { id: true, name: true, finalRank: true } },
        inventoryItem: { select: { id: true, sku: true, name: true } },
        operator: { select: { id: true, displayName: true } },
        signedBy: { select: { id: true, displayName: true } },
      },
      orderBy: [{ finalRank: 'asc' }, { issuedAt: 'asc' }],
    });
  }

  async issuePrize(eventId: string, dto: IssueEventPrizeDto, actor: AuthUser) {
    this.assertPrizeOperator(actor);
    const idempotencyKey = normaliseText(dto.idempotencyKey);
    const awardName = normaliseText(dto.awardName);
    const teamId = normaliseText(dto.teamId);
    const inventoryItemId = normaliseText(dto.inventoryItemId);
    const note = normaliseOptionalText(dto.note);
    if (!awardName) throw new BadRequestException('奖项名称不能为空');
    if (!teamId || !inventoryItemId)
      throw new BadRequestException('获奖队伍和库存商品不能为空');
    this.assertCommandKey(idempotencyKey, '奖品发放幂等键');
    if (
      !Number.isSafeInteger(dto.quantity) ||
      dto.quantity < 1 ||
      dto.quantity > 999
    ) {
      throw new BadRequestException('奖品数量必须为1-999的整数');
    }

    const existing = await this.prisma.eventPrizeAward.findUnique({
      where: { idempotencyKey },
      include: {
        team: true,
        inventoryItem: true,
        operator: true,
        signedBy: true,
      },
    });
    if (existing) {
      this.assertPrizeReplay(existing, eventId, dto, awardName, note);
      return existing;
    }

    try {
      return await this.prisma.$transaction(
        async (tx) => {
          const duplicate = await tx.eventPrizeAward.findUnique({
            where: { idempotencyKey },
          });
          if (duplicate) {
            this.assertPrizeReplay(duplicate, eventId, dto, awardName, note);
            return duplicate;
          }

          const event = await tx.event.findUnique({
            where: { id: eventId },
            select: { id: true, name: true, status: true, prizePool: true },
          });
          if (!event) throw new NotFoundException('赛事不存在');
          if (event.status !== EventStatus.COMPLETED) {
            throw new ConflictException('赛事尚未完赛，不能发放奖品');
          }
          const team = await tx.eventTeam.findFirst({
            where: { id: teamId, eventId },
            select: {
              id: true,
              name: true,
              status: true,
              finalRank: true,
              playerAName: true,
              playerBName: true,
            },
          });
          if (!team) throw new NotFoundException('获奖队伍不存在');
          if (
            team.status !== RegistrationStatus.COMPLETED ||
            !team.finalRank ||
            team.finalRank < 1
          ) {
            throw new ConflictException('获奖队伍尚未生成有效最终名次');
          }
          const recipientNames = this.prizeRecipients(team, dto.recipientNames);

          const item = await tx.inventoryItem.findUnique({
            where: { id: inventoryItemId },
          });
          if (!item?.enabled)
            throw new NotFoundException('奖品库存商品不存在或已停用');
          if (item.stock < dto.quantity)
            throw new BadRequestException('奖品库存不足');
          const { stockAfter } = await applyInventoryDelta(
            tx,
            item,
            -dto.quantity,
          );

          const stockTransaction = await tx.inventoryTransaction.create({
            data: {
              itemId: item.id,
              type: InventoryTxnType.EVENT_USAGE,
              quantity: -dto.quantity,
              stockBefore: item.stock,
              stockAfter,
              unitCostCents: item.purchasePriceCents,
              operatorId: actor.sub,
              reason: `${event.name} · ${awardName} · ${team.name}`,
              idempotencyKey: `EVENT_PRIZE:${idempotencyKey}`,
              metadata: {
                referenceType: 'EventPrizeAward',
                eventId,
                teamId: team.id,
                finalRank: team.finalRank,
                awardName,
                recipientNames,
                prizeIssueIdempotencyKey: idempotencyKey,
              } as never,
            },
          });
          const award = await tx.eventPrizeAward.create({
            data: {
              eventId,
              teamId: team.id,
              awardName,
              finalRank: team.finalRank,
              recipientNames,
              inventoryItemId: item.id,
              quantity: dto.quantity,
              operatorId: actor.sub,
              inventoryTransactionId: stockTransaction.id,
              idempotencyKey,
              note,
              prizePoolSnapshot: event.prizePool as never,
            },
            include: {
              team: true,
              inventoryItem: true,
              operator: true,
              signedBy: true,
            },
          });
          await tx.auditLog.create({
            data: {
              actorId: actor.sub,
              actorRole: actor.roles[0],
              action: 'EVENT_PRIZE_ISSUED',
              objectType: 'EventPrizeAward',
              objectId: award.id,
              oldValue: { stock: item.stock } as never,
              newValue: {
                eventId,
                teamId: team.id,
                finalRank: team.finalRank,
                awardName,
                recipientNames,
                inventoryItemId: item.id,
                quantity: dto.quantity,
                stockAfter,
                inventoryTransactionId: stockTransaction.id,
                status: EventPrizeStatus.ISSUED,
              } as never,
              reason: note,
            },
          });
          return award;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (
        isPrismaErrorCode(error, 'P2002') ||
        isPrismaErrorCode(error, 'P2034')
      ) {
        const replay = await this.prisma.eventPrizeAward.findUnique({
          where: { idempotencyKey },
          include: {
            team: true,
            inventoryItem: true,
            operator: true,
            signedBy: true,
          },
        });
        if (replay) {
          this.assertPrizeReplay(replay, eventId, dto, awardName, note);
          return replay;
        }
        const sameAward = await this.prisma.eventPrizeAward.findUnique({
          where: {
            eventId_teamId_awardName_inventoryItemId: {
              eventId,
              teamId,
              awardName,
              inventoryItemId,
            },
          },
        });
        if (sameAward)
          throw new ConflictException('该队伍的同一奖项和SKU已经发放');
        throw new ConflictException('奖品发放发生并发冲突，请刷新后重试');
      }
      throw error;
    }
  }

  async receivePrize(
    eventId: string,
    awardId: string,
    dto: ReceiveEventPrizeDto,
    actor: AuthUser,
  ) {
    this.assertPrizeOperator(actor);
    const receivedByName = normaliseText(dto.receivedByName);
    const receiptIdempotencyKey = normaliseText(dto.idempotencyKey);
    const receiptNote = normaliseOptionalText(dto.note);
    if (!receivedByName) throw new BadRequestException('签收人不能为空');
    this.assertCommandKey(receiptIdempotencyKey, '奖品签收幂等键');

    try {
      return await this.prisma.$transaction(
        async (tx) => {
          const current = await tx.eventPrizeAward.findFirst({
            where: { id: awardId, eventId },
          });
          if (!current) throw new NotFoundException('赛事奖品发放记录不存在');
          if (current.status === EventPrizeStatus.RECEIVED) {
            this.assertReceiptReplay(
              current,
              receivedByName,
              receiptIdempotencyKey,
              receiptNote,
            );
            return current;
          }
          const receivedAt = new Date();
          const changed = await tx.eventPrizeAward.updateMany({
            where: { id: awardId, eventId, status: EventPrizeStatus.ISSUED },
            data: {
              status: EventPrizeStatus.RECEIVED,
              receivedByName,
              signedById: actor.sub,
              receiptNote,
              receiptIdempotencyKey,
              receivedAt,
            },
          });
          if (changed.count !== 1) {
            const latest = await tx.eventPrizeAward.findFirst({
              where: { id: awardId, eventId },
            });
            if (latest?.status === EventPrizeStatus.RECEIVED) {
              this.assertReceiptReplay(
                latest,
                receivedByName,
                receiptIdempotencyKey,
                receiptNote,
              );
              return latest;
            }
            throw new ConflictException(
              '奖品签收状态已被其他操作更新，请刷新后重试',
            );
          }
          const received = await tx.eventPrizeAward.findUniqueOrThrow({
            where: { id: awardId },
          });
          await tx.auditLog.create({
            data: {
              actorId: actor.sub,
              actorRole: actor.roles[0],
              action: 'EVENT_PRIZE_RECEIVED',
              objectType: 'EventPrizeAward',
              objectId: awardId,
              oldValue: { status: current.status } as never,
              newValue: {
                status: EventPrizeStatus.RECEIVED,
                receivedByName,
                signedById: actor.sub,
                receivedAt: receivedAt.toISOString(),
              } as never,
              reason: receiptNote,
            },
          });
          return received;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (
        isPrismaErrorCode(error, 'P2002') ||
        isPrismaErrorCode(error, 'P2034')
      ) {
        const latest = await this.prisma.eventPrizeAward.findFirst({
          where: { id: awardId, eventId },
        });
        if (latest?.status === EventPrizeStatus.RECEIVED) {
          this.assertReceiptReplay(
            latest,
            receivedByName,
            receiptIdempotencyKey,
            receiptNote,
          );
          return latest;
        }
        const duplicateReceipt = await this.prisma.eventPrizeAward.findUnique({
          where: { receiptIdempotencyKey },
        });
        if (duplicateReceipt && duplicateReceipt.id !== awardId) {
          throw new ConflictException('奖品签收幂等键已用于其他发放记录');
        }
        throw new ConflictException('奖品签收发生并发冲突，请刷新后重试');
      }
      throw error;
    }
  }

  create(dto: CreateEventDto) {
    const capacityPeople = dto.capacityPeople ?? EVENT_MAX_CAPACITY_PEOPLE;
    const minimumPeople = dto.minimumPeople ?? EVENT_MINIMUM_PEOPLE;
    const totalRounds = dto.totalRounds ?? EVENT_TOTAL_ROUNDS;
    this.assertEventConfiguration(
      { capacityPeople, minimumPeople, totalRounds },
      'create',
    );

    const code = normaliseText(dto.code);
    const name = normaliseText(dto.name);
    if (!code || !name) throw new BadRequestException('赛事编码和名称不能为空');
    const startsAt = parseDate(dto.startsAt, 'startsAt');
    const registrationEndsAt = parseDate(
      dto.registrationEndsAt,
      'registrationEndsAt',
    );
    if (registrationEndsAt >= startsAt) {
      throw new BadRequestException('报名截止时间必须早于开赛时间');
    }
    if (!Number.isSafeInteger(dto.feeCents) || dto.feeCents < 0) {
      throw new BadRequestException('报名费用必须为非负整数');
    }
    if (
      dto.memberFeeCents !== undefined &&
      (!Number.isSafeInteger(dto.memberFeeCents) || dto.memberFeeCents < 0)
    ) {
      throw new BadRequestException('会员报名费用必须为非负整数');
    }

    return this.prisma.event.create({
      data: {
        code,
        name,
        startsAt,
        registrationEndsAt,
        capacityPeople,
        minimumPeople,
        totalRounds,
        feeCents: dto.feeCents,
        memberFeeCents: dto.memberFeeCents ?? null,
        rules: (dto.rules?.map((rule) => normaliseText(rule)).filter(Boolean) ??
          DEFAULT_RULES) as never,
        prizePool: dto.prizePool as never,
        sponsor: normaliseOptionalText(dto.sponsor) ?? null,
        // Events are deliberately not open for registration on creation.
        // Publishing is a separate, audited state transition so an operator
        // cannot accidentally expose an incomplete configuration.
        status: EventStatus.DRAFT,
      },
    });
  }

  /**
   * Move a reviewed draft into the registration period.  The conditional
   * update is the idempotency/concurrency boundary: only one request can win
   * DRAFT -> OPEN, while retries after a successful publish simply return the
   * already-open event and do not append duplicate audit records.
   */
  async publish(
    eventId: string,
    dto: PublishEventDto | undefined,
    actor: AuthUser,
  ) {
    const reason = normaliseOptionalText(dto?.reason);
    return this.prisma.$transaction(
      async (tx) => {
        const current = await tx.event.findUnique({ where: { id: eventId } });
        if (!current) throw new NotFoundException('赛事不存在');

        // A retry from a timed-out client is safe and side-effect free.
        if (current.status === EventStatus.OPEN) return current;
        if (current.status !== EventStatus.DRAFT) {
          throw new ConflictException(
            `赛事当前状态为 ${current.status}，不能发布`,
          );
        }

        // Re-validate persisted values at the workflow boundary.  This also
        // protects drafts created by an older client or a direct database seed.
        this.assertEventConfiguration(current);
        if (current.registrationEndsAt >= current.startsAt) {
          throw new ConflictException('报名截止时间必须早于开赛时间');
        }
        if (!normaliseText(current.code) || !normaliseText(current.name)) {
          throw new ConflictException('赛事编码和名称不能为空');
        }
        if (!Number.isSafeInteger(current.feeCents) || current.feeCents < 0) {
          throw new ConflictException('报名费用必须为非负整数');
        }
        if (
          current.memberFeeCents !== null &&
          (!Number.isSafeInteger(current.memberFeeCents) ||
            current.memberFeeCents < 0)
        ) {
          throw new ConflictException('会员报名费用必须为非负整数');
        }

        const changed = await tx.event.updateMany({
          where: { id: eventId, status: EventStatus.DRAFT },
          data: { status: EventStatus.OPEN },
        });
        if (changed.count !== 1) {
          // Another request may have published between our read and the
          // conditional update.  Treat that outcome as an idempotent success.
          const latest = await tx.event.findUnique({ where: { id: eventId } });
          if (latest?.status === EventStatus.OPEN) return latest;
          throw new ConflictException('赛事已被其他操作更新，请刷新后重试');
        }

        const published = await tx.event.findUniqueOrThrow({
          where: { id: eventId },
        });
        await tx.auditLog.create({
          data: {
            actorId: actor.sub,
            actorRole: actor.roles[0],
            action: 'EVENT_PUBLISHED',
            objectType: 'Event',
            objectId: eventId,
            oldValue: { status: EventStatus.DRAFT } as never,
            newValue: { status: EventStatus.OPEN, reason } as never,
            reason,
          },
        });
        return published;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  async register(eventId: string, dto: RegisterEventTeamDto, actor: AuthUser) {
    return executeOrderCreation(this.prisma, {
      memberId: actor.sub,
      creationIdempotencyKey: dto.creationIdempotencyKey,
      command: {
        kind: 'EVENT_REGISTRATION',
        eventId,
        name: normaliseText(dto.name),
        playerAName: normaliseText(dto.playerAName),
        playerBName: normaliseText(dto.playerBName),
        playerAUserId: normaliseOptionalText(dto.playerAUserId) ?? null,
        playerBUserId: normaliseOptionalText(dto.playerBUserId) ?? null,
        category: dto.category,
        sourceChannel: dto.sourceChannel,
      },
      loadExisting: (id) =>
        this.prisma.order.findUniqueOrThrow({
          where: { id },
          include: { eventTeam: true },
        }),
      create: (creation) => this.registerOnce(eventId, dto, actor, creation),
    });
  }

  private async registerOnce(
    eventId: string,
    dto: RegisterEventTeamDto,
    actor: AuthUser,
    creation: OrderCreationFields,
  ) {
    this.assertFixedDoubles(dto, 'create');
    const playerAName = normaliseText(dto.playerAName);
    const playerBName = normaliseText(dto.playerBName);
    const teamName = normaliseText(dto.name);
    if (!teamName) throw new BadRequestException('队伍名称不能为空');
    const playerAUserId = normaliseOptionalText(dto.playerAUserId);
    const playerBUserId = normaliseOptionalText(dto.playerBUserId);
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      include: { _count: { select: { teams: true } } },
    });
    if (!event || event.status !== EventStatus.OPEN)
      throw new NotFoundException('赛事不在报名期');
    this.assertEventConfiguration(event);
    if (new Date() >= event.registrationEndsAt)
      throw new ConflictException('赛事报名已截止');
    const profile = await this.prisma.memberProfile.findUnique({
      where: { userId: actor.sub },
    });
    const feeCents =
      profile &&
      ['GOLD', 'BLACK'].includes(profile.level) &&
      event.memberFeeCents !== null
        ? event.memberFeeCents
        : event.feeCents;

    return this.prisma.$transaction(
      async (tx) => {
        const duplicate = await tx.eventTeam.findFirst({
          where: {
            eventId,
            // Historical cancelled/refunded registrations must not block a
            // member from registering again.  Active statuses are the only
            // ones that represent a current seat or participation.
            status: {
              notIn: [
                RegistrationStatus.CANCELLED,
                RegistrationStatus.REFUNDED,
              ],
            },
            OR: [
              { captainId: actor.sub },
              { playerAUserId: actor.sub },
              { playerBUserId: actor.sub },
            ],
          },
        });
        if (duplicate) throw new ConflictException('当前用户已参加本赛事');
        const countedTeams = await tx.eventTeam.count({
          where: {
            eventId,
            status: {
              in: [
                RegistrationStatus.REGISTERED,
                RegistrationStatus.PAID,
                RegistrationStatus.CHECKED_IN,
                RegistrationStatus.COMPLETED,
              ],
            },
          },
        });
        if ((countedTeams + 1) * 2 > event.capacityPeople) {
          throw new ConflictException(
            `赛事名额已满（最多${event.capacityPeople}人）`,
          );
        }

        const knownPlayerIds = [playerAUserId, playerBUserId].filter(
          (value): value is string => Boolean(value),
        );
        if (knownPlayerIds.length) {
          const duplicateParticipant = await tx.eventTeam.findFirst({
            where: {
              eventId,
              status: {
                notIn: [
                  RegistrationStatus.CANCELLED,
                  RegistrationStatus.REFUNDED,
                ],
              },
              OR: knownPlayerIds.flatMap((userId) => [
                { playerAUserId: userId },
                { playerBUserId: userId },
              ]),
            },
          });
          if (duplicateParticipant) {
            throw new ConflictException(
              '同一账号不能参加同一赛事的多个固定双打队伍',
            );
          }
        }

        // Keep seeds monotonic even after a cancelled/refunded team, because
        // EventTeam(eventId, seed) is a unique key and historical pairings
        // must remain reproducible.
        const seed = (await tx.eventTeam.count({ where: { eventId } })) + 1;
        const created = await tx.order.create({
          data: {
            ...creation,
            orderNo: serial('EV'),
            memberId: actor.sub,
            createdById: actor.sub,
            businessType: BusinessType.EVENT,
            subjectAccount: SubjectAccount.VENUE,
            sourceChannel: dto.sourceChannel,
            status: OrderStatus.PENDING,
            title: `${event.name} 报名`,
            listAmountCents: event.feeCents,
            discountCents: event.feeCents - feeCents,
            payableCents: feeCents,
            parameterSnapshot: {
              eventId,
              memberFeeApplied: feeCents !== event.feeCents,
              rules: event.rules,
            },
            items: {
              create: {
                itemType: 'EVENT_REGISTRATION',
                itemId: eventId,
                name: event.name,
                unitPriceCents: feeCents,
                amountCents: feeCents,
              },
            },
            eventTeam: {
              create: {
                eventId,
                captainId: actor.sub,
                name: teamName,
                playerAName,
                playerBName,
                playerAUserId: playerAUserId ?? actor.sub,
                playerBUserId: playerBUserId ?? null,
                category: dto.category,
                seed,
                opponents: [],
              },
            },
          },
          include: { eventTeam: true },
        });
        await tx.auditLog.create({
          data: {
            actorId: actor.sub,
            actorRole: actor.roles[0],
            action: 'EVENT_ORDER_CREATED',
            objectType: 'Order',
            objectId: created.id,
            newValue: {
              memberId: actor.sub,
              createdById: actor.sub,
              businessType: BusinessType.EVENT,
              amountCents: feeCents,
              creationIdempotencyKeyPresent: Boolean(
                creation.creationIdempotencyKey,
              ),
              eventId,
              eventTeamId: created.eventTeam?.id,
              category: dto.category,
              seed,
              memberFeeApplied: feeCents !== event.feeCents,
              sourceChannel: dto.sourceChannel,
            } as never,
          },
        });
        return created;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  async checkIn(eventId: string, teamId: string, actor: AuthUser) {
    return this.prisma.$transaction(async (tx) => {
      const team = await tx.eventTeam.findFirst({
        where: { id: teamId, eventId },
      });
      if (!team) throw new NotFoundException('参赛组合不存在');
      this.assertFixedDoubles(team);
      if (
        ![RegistrationStatus.PAID, RegistrationStatus.CHECKED_IN].includes(
          team.status as never,
        )
      ) {
        throw new ConflictException('参赛报名尚未支付');
      }
      if (team.status === RegistrationStatus.CHECKED_IN) return team;
      const updated = await tx.eventTeam.update({
        where: { id: teamId },
        data: {
          status: RegistrationStatus.CHECKED_IN,
          checkedInAt: new Date(),
        },
      });
      await tx.auditLog.create({
        data: {
          actorId: actor.sub,
          actorRole: actor.roles[0],
          action: 'EVENT_TEAM_CHECKED_IN',
          objectType: 'EventTeam',
          objectId: teamId,
          oldValue: { status: team.status } as never,
          newValue: { status: RegistrationStatus.CHECKED_IN } as never,
        },
      });
      return updated;
    });
  }

  async startNextRound(eventId: string, actor: AuthUser) {
    return this.prisma.$transaction(
      async (tx) => {
        const event = await tx.event.findUnique({
          where: { id: eventId },
          include: {
            teams: { where: { status: RegistrationStatus.CHECKED_IN } },
            matches: { where: { round: { gt: 0 } } },
          },
        });
        if (!event) throw new NotFoundException('赛事不存在');
        this.assertEventConfiguration(event);
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
        this.assertPeopleRange(event.teams.length, event.capacityPeople);
        this.assertParticipantIdsUnique(event.teams);
        for (const team of event.teams) this.assertFixedDoubles(team);

        if (currentRound > 0) {
          // Every team in the previous round must have a terminal result before
          // Swiss ranking is used to generate the next round.
          this.assertRoundMatches(event.teams, event.matches, currentRound);
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
        this.assertPairings(
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

  async submitScore(matchId: string, dto: SubmitScoreDto, actor: AuthUser) {
    try {
      return await this.prisma.$transaction(
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

  async correctScore(matchId: string, dto: CorrectScoreDto, actor: AuthUser) {
    return this.prisma.$transaction(
      async (tx) => {
        const match = await tx.eventMatch.findUnique({
          where: { id: matchId },
        });
        if (!match?.teamBId) throw new NotFoundException('对阵不存在');
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
        await this.recomputeStandings(tx, match.eventId);
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
  }

  async finish(eventId: string, actor: AuthUser) {
    return this.prisma.$transaction(
      async (tx) => {
        const event = await tx.event.findUnique({
          where: { id: eventId },
          // Include completed teams as well: finish marks the participant rows
          // COMPLETED, and a retry must still be able to rebuild the ranking
          // from those immutable rows.
          include: { teams: true, matches: true },
        });
        if (!event) throw new NotFoundException('赛事不存在');

        this.assertEventConfiguration(event);
        const teams = event.teams.filter((team) =>
          event.status === EventStatus.COMPLETED
            ? team.status === RegistrationStatus.CHECKED_IN ||
              team.status === RegistrationStatus.COMPLETED
            : team.status === RegistrationStatus.CHECKED_IN,
        );

        // Completion is the idempotency boundary.  Once the event is marked
        // completed, all award writes from the same transaction have committed
        // and a retry must only return the persisted ranking.
        if (event.status === EventStatus.COMPLETED) {
          const ranked = rankSwissPairs(teams);
          return ranked.map((team, index) => ({
            ...team,
            finalRank: team.finalRank ?? index + 1,
            eventPointsAwarded:
              team.eventPointsAwarded ||
              eventPointsForRank(index + 1, ranked.length),
          }));
        }
        if (EVENT_STATUSES_NOT_FINISHABLE.includes(event.status)) {
          throw new ConflictException('当前赛事状态不允许完赛');
        }
        if (event.currentRound !== EVENT_TOTAL_ROUNDS) {
          throw new ConflictException(
            `赛事必须完成${EVENT_TOTAL_ROUNDS}轮后才能完赛`,
          );
        }
        this.assertPeopleRange(teams.length, event.capacityPeople);
        this.assertParticipantIdsUnique(teams);
        for (const team of teams) this.assertFixedDoubles(team);
        for (let round = 1; round <= EVENT_TOTAL_ROUNDS; round += 1) {
          this.assertRoundMatches(teams, event.matches, round);
        }

        const ranked = rankSwissPairs(teams);
        let awardedCount = 0;
        for (const [index, team] of ranked.entries()) {
          const rank = index + 1;
          const points = eventPointsForRank(rank, ranked.length);
          await tx.eventTeam.update({
            where: { id: team.id },
            data: {
              finalRank: rank,
              eventPointsAwarded: points,
              status: RegistrationStatus.COMPLETED,
            },
          });
          const playerIds = [
            ...new Set(
              [team.playerAUserId, team.playerBUserId, team.captainId].filter(
                Boolean,
              ),
            ),
          ] as string[];
          for (const userId of playerIds) {
            const idempotencyKey = `EVENT:${event.id}:${userId}`;
            // AccountTransaction.idempotencyKey is unique.  Check it before
            // changing the balance so an operator retry cannot issue points a
            // second time.  The optional guard keeps lightweight unit-test
            // doubles compatible while the real Prisma client always exposes
            // findUnique.
            const findAward = tx.accountTransaction?.findUnique;
            const existingAward =
              typeof findAward === 'function'
                ? await findAward.call(tx.accountTransaction, {
                    where: { idempotencyKey },
                  })
                : null;
            if (existingAward) {
              if (
                existingAward.amount !== points ||
                existingAward.reasonCode !== 'EVENT_RANK_POINTS'
              ) {
                throw new ConflictException(
                  `赛事积分幂等流水 ${idempotencyKey} 与本次发放不一致`,
                );
              }
              continue;
            }
            const account = await tx.account.upsert({
              where: {
                userId_type: { userId, type: AccountType.EVENT_POINTS },
              },
              update: {},
              create: { userId, type: AccountType.EVENT_POINTS },
            });
            const balanceBefore = Number(account.balance ?? 0);
            await tx.account.update({
              where: { id: account.id },
              data: {
                balance: { increment: points },
                version: { increment: 1 },
              },
            });
            await tx.accountTransaction.create({
              data: {
                accountId: account.id,
                kind: AccountTxnKind.CREDIT,
                amount: points,
                balanceBefore,
                balanceAfter: balanceBefore + points,
                reasonCode: 'EVENT_RANK_POINTS',
                reason: `${event.name} 第${rank}名`,
                operatorId: actor.sub,
                idempotencyKey,
              },
            });
            awardedCount += 1;
          }
        }
        await tx.event.update({
          where: { id: eventId },
          data: { status: EventStatus.COMPLETED },
        });
        await tx.auditLog.create({
          data: {
            actorId: actor.sub,
            actorRole: actor.roles[0],
            action: 'EVENT_FINISHED',
            objectType: 'Event',
            objectId: eventId,
            oldValue: {
              status: event.status,
              currentRound: event.currentRound,
            } as never,
            newValue: {
              status: EventStatus.COMPLETED,
              currentRound: EVENT_TOTAL_ROUNDS,
              ranking: ranked.map((team, index) => ({
                teamId: team.id,
                finalRank: index + 1,
                eventPointsAwarded: eventPointsForRank(
                  index + 1,
                  ranked.length,
                ),
              })),
              awardedCount,
            } as never,
          },
        });
        return ranked.map((team, index) => ({
          ...team,
          finalRank: index + 1,
          eventPointsAwarded: eventPointsForRank(index + 1, ranked.length),
        }));
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  private assertPrizeOperator(actor: AuthUser): void {
    if (
      !actor.roles.some((role) => EVENT_PRIZE_OPERATOR_ROLES.includes(role))
    ) {
      throw new ForbiddenException('当前角色无权发放或签收赛事奖品');
    }
  }

  private assertCommandKey(value: string, label: string): void {
    if (value.length < 8 || value.length > 100) {
      throw new BadRequestException(`${label}长度必须为8-100个字符`);
    }
  }

  private prizeRecipients(
    team: { playerAName: string; playerBName: string },
    requested: string[] | undefined,
  ): string[] {
    const available = [
      normaliseText(team.playerAName),
      normaliseText(team.playerBName),
    ];
    const byNormalized = new Map(
      available.map((name) => [name.toLocaleLowerCase(), name]),
    );
    const supplied = requested?.map(normaliseText).filter(Boolean);
    if (!supplied?.length) return [...new Set(available)];
    if (
      new Set(supplied.map((name) => name.toLocaleLowerCase())).size !==
      supplied.length
    ) {
      throw new BadRequestException('奖品领取人不能重复');
    }
    return supplied.map((name) => {
      const canonical = byNormalized.get(name.toLocaleLowerCase());
      if (!canonical)
        throw new BadRequestException('奖品领取人必须属于获奖队伍');
      return canonical;
    });
  }

  private assertPrizeReplay(
    existing: {
      eventId: string;
      teamId: string;
      awardName: string;
      recipientNames: string[];
      inventoryItemId: string;
      quantity: number;
      note: string | null;
    },
    eventId: string,
    dto: IssueEventPrizeDto,
    awardName: string,
    note: string | undefined,
  ): void {
    const requestedRecipients = dto.recipientNames
      ?.map(normaliseText)
      .filter(Boolean);
    const recipientsConflict = requestedRecipients?.length
      ? requestedRecipients.length !== existing.recipientNames.length ||
        requestedRecipients.some(
          (name, index) => name !== existing.recipientNames[index],
        )
      : false;
    if (
      existing.eventId !== eventId ||
      existing.teamId !== normaliseText(dto.teamId) ||
      existing.awardName !== awardName ||
      existing.inventoryItemId !== normaliseText(dto.inventoryItemId) ||
      existing.quantity !== dto.quantity ||
      existing.note !== (note ?? null) ||
      recipientsConflict
    ) {
      throw new ConflictException('幂等键已用于其他赛事奖品指令，请更换幂等键');
    }
  }

  private assertReceiptReplay(
    existing: {
      receivedByName: string | null;
      receiptIdempotencyKey: string | null;
      receiptNote: string | null;
    },
    receivedByName: string,
    receiptIdempotencyKey: string,
    receiptNote: string | undefined,
  ): void {
    if (
      existing.receivedByName !== receivedByName ||
      existing.receiptIdempotencyKey !== receiptIdempotencyKey ||
      existing.receiptNote !== (receiptNote ?? null)
    ) {
      throw new ConflictException('奖品已经签收，签收信息与本次请求不一致');
    }
  }

  private async recomputeStandings(
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
}
