import { createHash, randomBytes } from 'node:crypto';

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
  PaymentStatus,
  Prisma,
  RefundStatus,
  RegistrationStatus,
  SourceChannel,
  SubjectAccount,
} from '../generated/prisma/client.js';
import { applyInventoryDelta } from '../inventory/inventory-balance.js';
import { orderCreationCommandHash } from '../orders/order-creation-idempotency.js';
import { completeOrderFulfillment } from '../orders/order-fulfillment.js';
import type {
  CancelEventDto,
  CancelEventRegistrationDto,
  CorrectScoreDto,
  CorrectEventPairingsDto,
  CreateEventDto,
  EventTeamCheckInDto,
  IssueEventPrizeDto,
  PublishEventDto,
  ReceiveEventPrizeDto,
  RegisterEventTeamDto,
  SubmitScoreDto,
} from './events.dto.js';
import {
  assertOperationTimeWindow,
  EVENT_CHECK_IN_WINDOW_PARAMETER,
} from '../common/time-window/operation-time-window.js';
import {
  EVENT_MAX_CAPACITY_PEOPLE,
  EVENT_MINIMUM_PEOPLE,
  EVENT_TOTAL_ROUNDS,
} from './events.dto.js';

const serial = (prefix: string) =>
  `${prefix}${new Date().toISOString().replace(/\D/g, '').slice(0, 14)}${randomBytes(3).toString('hex').toUpperCase()}`;

export const eventTeamCancellationRefundKey = (
  teamId: string,
  commandKey: string,
) => `EVENT_TEAM_CANCEL:${teamId}:${commandKey}`;

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

const EVENT_MANAGER_ROLES: readonly AppRole[] = [
  AppRole.EVENT_MANAGER,
  AppRole.ADMIN,
  AppRole.SUPER_ADMIN,
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

export const EVENT_PAYMENT_RESERVATION_MINUTES = 15;

const EVENT_SEAT_STATUSES: readonly RegistrationStatus[] = [
  RegistrationStatus.REGISTERED,
  RegistrationStatus.PAID,
  RegistrationStatus.CHECKED_IN,
  RegistrationStatus.COMPLETED,
];

const EVENT_CANCELLABLE_STATUSES: readonly EventStatus[] = [
  EventStatus.DRAFT,
  EventStatus.OPEN,
  EventStatus.FULL,
];

const ACTIVE_REFUND_STATUSES: readonly RefundStatus[] = [
  RefundStatus.REQUESTED,
  RefundStatus.APPROVED,
  RefundStatus.PROCESSING,
];

const EVENT_NO_SHOW_ORDER_STATUSES: ReadonlySet<OrderStatus> = new Set([
  OrderStatus.PAID,
  OrderStatus.CHECKED_IN,
  OrderStatus.COMPLETED,
  OrderStatus.PARTIALLY_REFUNDED,
]);

const EVENT_COMPLETED_ORDER_STATUSES: ReadonlySet<OrderStatus> = new Set(
  EVENT_NO_SHOW_ORDER_STATUSES,
);

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

const eventPaymentDueAt = (
  registrationEndsAt: Date,
  startsAt: Date,
  now: Date,
): Date =>
  new Date(
    Math.min(
      now.getTime() + EVENT_PAYMENT_RESERVATION_MINUTES * 60_000,
      registrationEndsAt.getTime(),
      startsAt.getTime(),
    ),
  );

/**
 * Release expired unpaid event reservations inside the caller's serializable
 * transaction.  Each row is claimed with a conditional update; a payment
 * worker that already moved the team to PAID therefore wins cleanly.
 */
async function expireEventReservations(
  tx: Prisma.TransactionClient,
  eventId: string,
  actorId: string,
  actorRole: AppRole,
  now: Date,
) {
  const expired = await tx.eventTeam.findMany({
    where: {
      eventId,
      status: RegistrationStatus.REGISTERED,
      paymentDueAt: { lte: now },
      order: { status: OrderStatus.PENDING },
    },
    select: { id: true, orderId: true, paymentDueAt: true },
    orderBy: [{ paymentDueAt: 'asc' }, { id: 'asc' }],
  });
  let released = 0;
  for (const team of expired) {
    const claimed = await tx.eventTeam.updateMany({
      where: {
        id: team.id,
        status: RegistrationStatus.REGISTERED,
        paymentDueAt: { lte: now },
      },
      data: {
        status: RegistrationStatus.CANCELLED,
        paymentDueAt: null,
        cancelledAt: now,
      },
    });
    if (claimed.count !== 1) continue;
    if (team.orderId) {
      await tx.order.updateMany({
        where: { id: team.orderId, status: OrderStatus.PENDING },
        data: { status: OrderStatus.CANCELLED, cancelledAt: now },
      });
      await tx.payment.updateMany({
        where: {
          orderId: team.orderId,
          status: {
            in: [
              PaymentStatus.CREATED,
              PaymentStatus.PROCESSING,
              PaymentStatus.FAILED,
            ],
          },
        },
        data: { status: PaymentStatus.CLOSED },
      });
    }
    released += 1;
    await tx.auditLog.create({
      data: {
        actorId,
        actorRole,
        action: 'EVENT_PAYMENT_RESERVATION_EXPIRED',
        objectType: 'EventTeam',
        objectId: team.id,
        oldValue: {
          status: RegistrationStatus.REGISTERED,
          paymentDueAt: team.paymentDueAt?.toISOString(),
        } as never,
        newValue: {
          status: RegistrationStatus.CANCELLED,
          orderId: team.orderId,
        } as never,
        reason: '报名支付保留期届满',
      },
    });
  }
  return released;
}

/**
 * Fill every currently available event-team seat from the persistent FIFO
 * queue.  It is shared by operations, timeout cleanup and refund finalisers.
 */
export async function promoteNextEventWaitlist(
  tx: Prisma.TransactionClient,
  eventId: string,
  actorId: string,
  actorRole: AppRole,
  now = new Date(),
) {
  const event = await tx.event.findUnique({
    where: { id: eventId },
    select: {
      id: true,
      name: true,
      status: true,
      capacityPeople: true,
      registrationEndsAt: true,
      startsAt: true,
    },
  });
  if (
    !event ||
    (event.status !== EventStatus.OPEN && event.status !== EventStatus.FULL)
  ) {
    return { expiredCount: 0, promotions: [] };
  }

  const expiredCount = await expireEventReservations(
    tx,
    eventId,
    actorId,
    actorRole,
    now,
  );
  if (event.registrationEndsAt <= now || event.startsAt <= now) {
    return { expiredCount, promotions: [] };
  }
  const capacityTeams = Math.floor(event.capacityPeople / 2);
  let seated = await tx.eventTeam.count({
    where: { eventId, status: { in: [...EVENT_SEAT_STATUSES] } },
  });
  const promotions: Array<{
    order: { id: string };
    registration: { id: string };
  }> = [];

  while (seated < capacityTeams) {
    const next = await tx.eventTeam.findFirst({
      where: {
        eventId,
        status: RegistrationStatus.WAITLISTED,
        orderId: null,
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    if (!next) break;
    const paymentDueAt = eventPaymentDueAt(
      event.registrationEndsAt,
      event.startsAt,
      now,
    );
    const payableCents = next.payableCents ?? 0;
    const listAmountCents = next.listAmountCents ?? payableCents;
    const promotionOrderKey = `SYSTEM:EVENT_WAITLIST:${next.id}`;
    const order = await tx.order.upsert({
      where: { creationIdempotencyKey: promotionOrderKey },
      update: {},
      create: {
        creationIdempotencyKey: promotionOrderKey,
        creationCommandHash: orderCreationCommandHash({
          kind: 'EVENT_WAITLIST_PROMOTION',
          eventId,
          teamId: next.id,
          captainId: next.captainId,
        }),
        orderNo: serial('EV'),
        memberId: next.captainId,
        createdById: actorId,
        businessType: BusinessType.EVENT,
        subjectAccount: SubjectAccount.VENUE,
        sourceChannel: next.sourceChannel ?? SourceChannel.MINI_PROGRAM,
        status: OrderStatus.PENDING,
        title: `${event.name} 报名`,
        listAmountCents,
        discountCents: Math.max(0, listAmountCents - payableCents),
        payableCents,
        parameterSnapshot: {
          eventId,
          eventTeamId: next.id,
          promotedFromWaitlist: true,
          paymentDueAt: paymentDueAt.toISOString(),
          memberFeeApplied: next.memberFeeApplied,
        },
        items: {
          create: {
            itemType: 'EVENT_REGISTRATION',
            itemId: eventId,
            name: event.name,
            unitPriceCents: payableCents,
            amountCents: payableCents,
          },
        },
      },
    });
    // The database deliberately rejects a REGISTERED row without both its
    // order and payment deadline.  Bind all reservation fields in the same
    // CAS update so neither readers nor constraints can observe a half-
    // promoted team.
    const claimed = await tx.eventTeam.updateMany({
      where: {
        id: next.id,
        status: RegistrationStatus.WAITLISTED,
        orderId: null,
      },
      data: {
        status: RegistrationStatus.REGISTERED,
        orderId: order.id,
        promotedAt: now,
        paymentDueAt,
      },
    });
    if (claimed.count !== 1) {
      const latest = await tx.eventTeam.findUnique({
        where: { id: next.id },
        select: { status: true, orderId: true },
      });
      // A concurrent retry may already have attached this deterministic
      // order. Treat that as a completed promotion; any genuinely conflicting
      // snapshot is left for the serializable transaction to retry safely.
      if (
        latest?.status === RegistrationStatus.REGISTERED &&
        latest.orderId === order.id
      ) {
        seated += 1;
        continue;
      }
      throw new ConflictException('候补晋级状态已变化，请重试');
    }
    const registration = {
      ...next,
      status: RegistrationStatus.REGISTERED,
      orderId: order.id,
      promotedAt: now,
      paymentDueAt,
    };
    seated += 1;
    promotions.push({ order, registration });
    await tx.auditLog.create({
      data: {
        actorId,
        actorRole,
        action: 'EVENT_WAITLIST_PROMOTED',
        objectType: 'EventTeam',
        objectId: registration.id,
        oldValue: { status: RegistrationStatus.WAITLISTED } as never,
        newValue: {
          status: RegistrationStatus.REGISTERED,
          eventId,
          orderId: order.id,
          paymentDueAt: paymentDueAt.toISOString(),
        } as never,
      },
    });
  }

  await tx.event.updateMany({
    where: {
      id: eventId,
      status: { in: [EventStatus.OPEN, EventStatus.FULL] },
    },
    data: {
      status: seated >= capacityTeams ? EventStatus.FULL : EventStatus.OPEN,
    },
  });
  return { expiredCount, promotions };
}

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
          include: { order: { select: { status: true } } },
          orderBy: [{ points: 'desc' }, { scoreDiff: 'desc' }, { seed: 'asc' }],
        },
        matches: { orderBy: [{ round: 'asc' }, { createdAt: 'asc' }] },
      },
    });
  }

  async myRegistration(eventId: string, actor: AuthUser) {
    const registration = await this.prisma.eventTeam.findFirst({
      where: {
        eventId,
        OR: [
          { captainId: actor.sub },
          { playerAUserId: actor.sub },
          { playerBUserId: actor.sub },
        ],
      },
      include: {
        order: {
          select: {
            id: true,
            orderNo: true,
            status: true,
            payableCents: true,
            paidCents: true,
            refunds: {
              orderBy: { requestedAt: 'desc' },
              select: {
                id: true,
                idempotencyKey: true,
                amountCents: true,
                reason: true,
                status: true,
                requestedAt: true,
                completedAt: true,
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (!registration) return null;
    if (registration.status !== RegistrationStatus.WAITLISTED) {
      return { registration, waitlistPosition: null };
    }
    const ahead = await this.prisma.eventTeam.count({
      where: {
        eventId,
        status: RegistrationStatus.WAITLISTED,
        OR: [
          { createdAt: { lt: registration.createdAt } },
          {
            createdAt: registration.createdAt,
            id: { lt: registration.id },
          },
        ],
      },
    });
    return { registration, waitlistPosition: ahead + 1 };
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

  create(dto: CreateEventDto, actor: AuthUser) {
    this.assertEventManager(actor);
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
    const now = new Date();
    if (startsAt <= now) {
      throw new BadRequestException('赛事开始时间必须晚于当前时间');
    }
    if (registrationEndsAt <= now) {
      throw new BadRequestException('报名截止时间必须晚于当前时间');
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

    return this.prisma.$transaction(
      async (tx) => {
        const event = await tx.event.create({
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
            rules: (dto.rules
              ?.map((rule) => normaliseText(rule))
              .filter(Boolean) ?? DEFAULT_RULES) as never,
            prizePool: dto.prizePool as never,
            sponsor: normaliseOptionalText(dto.sponsor) ?? null,
            // Events are deliberately not open for registration on creation.
            // Publishing is a separate, audited state transition so an operator
            // cannot accidentally expose an incomplete configuration.
            status: EventStatus.DRAFT,
          },
        });
        await tx.auditLog.create({
          data: {
            actorId: actor.sub,
            actorRole: actor.roles[0],
            action: 'EVENT_CREATED',
            objectType: 'Event',
            objectId: event.id,
            newValue: {
              status: EventStatus.DRAFT,
              code,
              name,
              startsAt: startsAt.toISOString(),
              registrationEndsAt: registrationEndsAt.toISOString(),
              capacityPeople,
              minimumPeople,
              totalRounds,
              feeCents: dto.feeCents,
            } as never,
          },
        });
        return event;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
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
    this.assertEventManager(actor);
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
        const now = new Date();
        if (current.startsAt <= now) {
          throw new ConflictException('赛事开始时间必须晚于当前时间');
        }
        if (current.registrationEndsAt <= now) {
          throw new ConflictException('报名截止时间必须晚于当前时间');
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
    this.assertFixedDoubles(dto, 'create');
    const playerAName = normaliseText(dto.playerAName);
    const playerBName = normaliseText(dto.playerBName);
    const teamName = normaliseText(dto.name);
    if (!teamName) throw new BadRequestException('队伍名称不能为空');
    const playerAUserId = normaliseOptionalText(dto.playerAUserId);
    const playerBUserId = normaliseOptionalText(dto.playerBUserId);
    const sourceChannel = dto.sourceChannel ?? SourceChannel.MINI_PROGRAM;
    const creationIdempotencyKey = normaliseOptionalText(
      dto.creationIdempotencyKey,
    );
    if (creationIdempotencyKey) {
      this.assertCommandKey(creationIdempotencyKey, '赛事报名幂等键');
    }
    const commandHash = orderCreationCommandHash({
      kind: 'EVENT_REGISTRATION',
      eventId,
      name: teamName,
      playerAName,
      playerBName,
      playerAUserId: playerAUserId ?? null,
      playerBUserId: playerBUserId ?? null,
      category: dto.category,
      sourceChannel,
    });

    const replay = async () => {
      if (!creationIdempotencyKey) return null;
      const existing = this.prisma.eventTeam?.findUnique
        ? await this.prisma.eventTeam.findUnique({
            where: { creationIdempotencyKey },
          })
        : null;
      if (!existing && this.prisma.order?.findUnique) {
        const legacyOrder = await this.prisma.order.findUnique({
          where: { creationIdempotencyKey },
          select: {
            id: true,
            memberId: true,
            creationCommandHash: true,
          },
        });
        if (legacyOrder) {
          if (
            legacyOrder.memberId !== actor.sub ||
            legacyOrder.creationCommandHash !== commandHash
          ) {
            throw new ConflictException('赛事报名幂等键已用于不同命令');
          }
          return this.prisma.order.findUniqueOrThrow({
            where: { id: legacyOrder.id },
            include: { eventTeam: true },
          });
        }
      }
      if (!existing) return null;
      if (
        existing.captainId !== actor.sub ||
        existing.creationCommandHash !== commandHash
      ) {
        throw new ConflictException('赛事报名幂等键已用于不同命令');
      }
      if (existing.status === RegistrationStatus.WAITLISTED) {
        const ahead = await this.prisma.eventTeam.count({
          where: {
            eventId: existing.eventId,
            status: RegistrationStatus.WAITLISTED,
            OR: [
              { createdAt: { lt: existing.createdAt } },
              { createdAt: existing.createdAt, id: { lt: existing.id } },
            ],
          },
        });
        return {
          registration: existing,
          waitlistPosition: ahead + 1,
          status: RegistrationStatus.WAITLISTED,
        };
      }
      if (!existing.orderId) {
        return { registration: existing, status: existing.status };
      }
      return this.prisma.order.findUniqueOrThrow({
        where: { id: existing.orderId },
        include: { eventTeam: true },
      });
    };
    const existingReplay = await replay();
    if (existingReplay) return existingReplay;

    const preflightEvent = await this.prisma.event.findUnique({
      where: { id: eventId },
    });
    if (
      !preflightEvent ||
      (preflightEvent.status !== EventStatus.OPEN &&
        preflightEvent.status !== EventStatus.FULL)
    ) {
      throw new NotFoundException('赛事不在报名期');
    }
    this.assertEventConfiguration(preflightEvent);
    const preflightNow = new Date();
    if (
      preflightNow >= preflightEvent.registrationEndsAt ||
      preflightNow >= preflightEvent.startsAt
    ) {
      throw new ConflictException('赛事报名已截止');
    }
    const preflightProfile = await this.prisma.memberProfile.findUnique({
      where: { userId: actor.sub },
    });

    try {
      return await this.prisma.$transaction(
        async (tx) => {
          const event = tx.event?.findUnique
            ? await tx.event.findUnique({ where: { id: eventId } })
            : preflightEvent;
          if (
            !event ||
            (event.status !== EventStatus.OPEN &&
              event.status !== EventStatus.FULL)
          ) {
            throw new NotFoundException('赛事不在报名期');
          }
          this.assertEventConfiguration(event);
          const now = new Date();
          if (now >= event.registrationEndsAt || now >= event.startsAt) {
            throw new ConflictException('赛事报名已截止');
          }
          const profile = tx.memberProfile?.findUnique
            ? await tx.memberProfile.findUnique({
                where: { userId: actor.sub },
              })
            : preflightProfile;
          const feeCents =
            profile &&
            ['GOLD', 'BLACK'].includes(profile.level) &&
            event.memberFeeCents !== null
              ? event.memberFeeCents
              : event.feeCents;
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
          if (duplicate)
            throw new ConflictException('当前用户已参加本赛事或正在候补');
          const countedTeams = await tx.eventTeam.count({
            where: {
              eventId,
              status: { in: [...EVENT_SEAT_STATUSES] },
            },
          });
          const waitlistedTeams = await tx.eventTeam.count({
            where: { eventId, status: RegistrationStatus.WAITLISTED },
          });

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
          const commonTeamData = {
            // Keep lifecycle timestamps on the same application clock. Prisma
            // otherwise materializes `createdAt` a few milliseconds after
            // `waitlistedAt` for the direct WAITLISTED create, which can violate
            // the database ordering constraint even though this is one command.
            createdAt: now,
            eventId,
            captainId: actor.sub,
            name: teamName,
            playerAName,
            playerBName,
            playerAUserId: playerAUserId ?? actor.sub,
            playerBUserId: playerBUserId ?? null,
            category: dto.category,
            sourceChannel,
            listAmountCents: event.feeCents,
            payableCents: feeCents,
            memberFeeApplied: feeCents !== event.feeCents,
            seed,
            opponents: [],
            creationIdempotencyKey,
            creationCommandHash: creationIdempotencyKey ? commandHash : null,
          };
          const capacityTeams = Math.floor(event.capacityPeople / 2);
          // Never allow a new request to jump an older queue entry, even when a
          // seat has just been released and the promotion worker has not run.
          if (countedTeams >= capacityTeams || waitlistedTeams > 0) {
            const registration = await tx.eventTeam.create({
              data: {
                ...commonTeamData,
                status: RegistrationStatus.WAITLISTED,
                waitlistedAt: now,
              },
            });
            await tx.event.updateMany({
              where: {
                id: eventId,
                status: { in: [EventStatus.OPEN, EventStatus.FULL] },
              },
              data: { status: EventStatus.FULL },
            });
            await tx.auditLog.create({
              data: {
                actorId: actor.sub,
                actorRole: actor.roles[0],
                action: 'EVENT_WAITLISTED',
                objectType: 'EventTeam',
                objectId: registration.id,
                newValue: {
                  eventId,
                  status: RegistrationStatus.WAITLISTED,
                  position: waitlistedTeams + 1,
                  teamName,
                  category: dto.category,
                } as never,
              },
            });
            return {
              registration,
              waitlistPosition: waitlistedTeams + 1,
              status: RegistrationStatus.WAITLISTED,
            };
          }

          const paymentDueAt = eventPaymentDueAt(
            event.registrationEndsAt,
            event.startsAt,
            now,
          );
          const created = await tx.order.create({
            data: {
              creationIdempotencyKey,
              creationCommandHash: creationIdempotencyKey ? commandHash : null,
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
                paymentDueAt: paymentDueAt.toISOString(),
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
                  ...commonTeamData,
                  paymentDueAt,
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
                creationIdempotencyKeyPresent: Boolean(creationIdempotencyKey),
                eventId,
                eventTeamId: created.eventTeam?.id,
                category: dto.category,
                seed,
                memberFeeApplied: feeCents !== event.feeCents,
                sourceChannel: dto.sourceChannel,
                paymentDueAt: paymentDueAt.toISOString(),
              } as never,
            },
          });
          if (countedTeams + 1 >= capacityTeams) {
            await tx.event.updateMany({
              where: { id: eventId, status: EventStatus.OPEN },
              data: { status: EventStatus.FULL },
            });
          }
          return created;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (creationIdempotencyKey && isPrismaErrorCode(error, 'P2002')) {
        const concurrent = await replay();
        if (concurrent) return concurrent;
      }
      if (isPrismaErrorCode(error, 'P2034')) {
        throw new ConflictException('赛事报名发生并发冲突，请使用原命令重试');
      }
      throw error;
    }
  }

  /** Withdraw one fixed-doubles registration without bypassing finance. */
  async cancelRegistration(
    eventId: string,
    dto: CancelEventRegistrationDto,
    actor: AuthUser,
  ) {
    const reason = normaliseText(dto.reason);
    const idempotencyKey = normaliseText(dto.idempotencyKey);
    if (reason.length < 2) {
      throw new BadRequestException('退出原因至少2个字符');
    }
    this.assertCommandKey(idempotencyKey, '参赛退出幂等键');
    const commandHashFor = (teamId: string) =>
      orderCreationCommandHash({
        kind: 'EVENT_REGISTRATION_CANCEL',
        eventId,
        teamId,
        reason,
        actorId: actor.sub,
      });
    const refundKeyFor = (teamId: string) =>
      eventTeamCancellationRefundKey(teamId, idempotencyKey);

    const replay = async () => {
      const existing = await this.prisma.eventTeam.findUnique({
        where: { cancelIdempotencyKey: idempotencyKey },
        include: {
          order: { include: { refunds: true } },
        },
      });
      if (!existing) return null;
      if (
        existing.eventId !== eventId ||
        existing.cancelledById !== actor.sub ||
        existing.cancelCommandHash !== commandHashFor(existing.id)
      ) {
        throw new ConflictException('参赛退出幂等键已用于不同命令');
      }
      const refund =
        existing.order?.refunds.find(
          (item) => item.idempotencyKey === refundKeyFor(existing.id),
        ) ?? null;
      return {
        registration: existing,
        refund,
        outcome: existing.cancellationPending
          ? 'REFUND_REQUESTED'
          : refund?.status === RefundStatus.REJECTED
            ? 'REFUND_REJECTED'
            : existing.status === RegistrationStatus.REFUNDED
              ? 'REFUNDED'
              : 'CANCELLED',
        idempotent: true,
      };
    };
    const existingReplay = await replay();
    if (existingReplay) return existingReplay;

    try {
      return await this.prisma.$transaction(
        async (tx) => {
          const event = await tx.event.findUnique({
            where: { id: eventId },
            select: { id: true, status: true, startsAt: true },
          });
          if (!event) throw new NotFoundException('赛事不存在');
          const now = new Date();
          if (
            event.status !== EventStatus.OPEN &&
            event.status !== EventStatus.FULL
          ) {
            throw new ConflictException('赛事当前状态不允许退出报名');
          }
          if (event.startsAt <= now) {
            throw new ConflictException('赛事已开赛，不能自助退出');
          }
          const isManager = actor.roles.some((role) =>
            EVENT_MANAGER_ROLES.includes(role),
          );
          const requestedTeamId = normaliseOptionalText(dto.teamId);
          const team = await tx.eventTeam.findFirst({
            where: {
              eventId,
              id: requestedTeamId,
              status: {
                in: [
                  RegistrationStatus.WAITLISTED,
                  RegistrationStatus.REGISTERED,
                  RegistrationStatus.PAID,
                ],
              },
              captainId: isManager && requestedTeamId ? undefined : actor.sub,
            },
            include: {
              order: {
                include: {
                  refunds: true,
                },
              },
            },
            orderBy: { createdAt: 'desc' },
          });
          if (!team) {
            throw new NotFoundException('没有可退出的赛事报名');
          }
          if (team.captainId !== actor.sub && !isManager) {
            throw new ForbiddenException('仅队长或赛事管理员可退出报名');
          }
          if (team.cancelIdempotencyKey) {
            if (
              team.cancelIdempotencyKey === idempotencyKey &&
              team.cancelledById === actor.sub &&
              team.cancelCommandHash === commandHashFor(team.id)
            ) {
              const refund =
                team.order?.refunds.find(
                  (item) => item.idempotencyKey === refundKeyFor(team.id),
                ) ?? null;
              return {
                registration: team,
                refund,
                outcome: team.cancellationPending
                  ? 'REFUND_REQUESTED'
                  : refund?.status === RefundStatus.REJECTED
                    ? 'REFUND_REJECTED'
                    : team.status === RegistrationStatus.REFUNDED
                      ? 'REFUNDED'
                      : 'CANCELLED',
                idempotent: true,
              };
            }
            throw new ConflictException('该报名已经提交过另一退出命令');
          }
          const commandHash = commandHashFor(team.id);
          const evidence = {
            cancelReason: reason,
            cancelIdempotencyKey: idempotencyKey,
            cancelCommandHash: commandHash,
            cancelledById: actor.sub,
            cancelRequestedAt: now,
          };

          if (
            team.status === RegistrationStatus.WAITLISTED ||
            team.status === RegistrationStatus.REGISTERED
          ) {
            if (
              team.status === RegistrationStatus.REGISTERED &&
              (!team.order || team.order.status !== OrderStatus.PENDING)
            ) {
              throw new ConflictException('待支付订单状态已变化，请刷新后重试');
            }
            const changed = await tx.eventTeam.updateMany({
              where: {
                id: team.id,
                status: team.status,
                cancelIdempotencyKey: null,
              },
              data: {
                ...evidence,
                status: RegistrationStatus.CANCELLED,
                paymentDueAt: null,
                cancellationPending: false,
                cancellationResolvedAt: now,
                cancelledAt: now,
              },
            });
            if (changed.count !== 1) {
              throw new ConflictException('报名状态已变化，请使用原命令重试');
            }
            if (team.order) {
              const cancelled = await tx.order.updateMany({
                where: { id: team.order.id, status: OrderStatus.PENDING },
                data: { status: OrderStatus.CANCELLED, cancelledAt: now },
              });
              if (cancelled.count !== 1) {
                throw new ConflictException(
                  '待支付订单状态已变化，请刷新后重试',
                );
              }
              await tx.payment.updateMany({
                where: {
                  orderId: team.order.id,
                  status: {
                    in: [
                      PaymentStatus.CREATED,
                      PaymentStatus.PROCESSING,
                      PaymentStatus.FAILED,
                    ],
                  },
                },
                data: { status: PaymentStatus.CLOSED },
              });
            }
            const promotion = await promoteNextEventWaitlist(
              tx,
              eventId,
              actor.sub,
              actor.roles[0],
              now,
            );
            const registration = {
              ...team,
              ...evidence,
              status: RegistrationStatus.CANCELLED,
              paymentDueAt: null,
              cancellationPending: false,
              cancellationResolvedAt: now,
              cancelledAt: now,
            };
            await tx.auditLog.create({
              data: {
                actorId: actor.sub,
                actorRole: actor.roles[0],
                action: 'EVENT_REGISTRATION_CANCELLED',
                objectType: 'EventTeam',
                objectId: team.id,
                reason,
                oldValue: { status: team.status } as never,
                newValue: {
                  status: RegistrationStatus.CANCELLED,
                  orderId: team.orderId,
                  promotedTeamIds: promotion.promotions.map(
                    (item) => item.registration.id,
                  ),
                } as never,
              },
            });
            return {
              registration,
              refund: null,
              outcome: 'CANCELLED',
              promotion,
            };
          }

          if (!team.order || team.order.status !== OrderStatus.PAID) {
            throw new ConflictException('已支付订单状态已变化，请刷新后重试');
          }
          const activeRefunds = team.order.refunds.filter((refund) =>
            ACTIVE_REFUND_STATUSES.includes(refund.status),
          );
          if (activeRefunds.length) {
            throw new ConflictException('订单已有待处理退款，不能重复申请退出');
          }
          const amountCents = team.order.paidCents - team.order.refundedCents;
          if (amountCents <= 0) {
            throw new ConflictException('订单已无可退金额');
          }
          const changed = await tx.eventTeam.updateMany({
            where: {
              id: team.id,
              status: RegistrationStatus.PAID,
              cancellationPending: false,
              cancelIdempotencyKey: null,
            },
            data: {
              ...evidence,
              cancellationPending: true,
              cancellationResolvedAt: null,
            },
          });
          if (changed.count !== 1) {
            throw new ConflictException('报名状态已变化，请使用原命令重试');
          }
          const refund = await tx.refund.create({
            data: {
              refundNo: serial('RF'),
              idempotencyKey: refundKeyFor(team.id),
              orderId: team.order.id,
              requestedById: actor.sub,
              amountCents,
              reason: `赛事报名退出：${reason}`,
              status: RefundStatus.REQUESTED,
              originalOrderStatus: team.order.status,
            },
          });
          const orderChanged = await tx.order.updateMany({
            where: { id: team.order.id, status: OrderStatus.PAID },
            data: { status: OrderStatus.REFUND_PENDING },
          });
          if (orderChanged.count !== 1) {
            throw new ConflictException('订单状态已变化，请使用原命令重试');
          }
          await tx.auditLog.create({
            data: {
              actorId: actor.sub,
              actorRole: actor.roles[0],
              action: 'EVENT_REGISTRATION_REFUND_REQUESTED',
              objectType: 'Refund',
              objectId: refund.id,
              reason,
              newValue: {
                eventId,
                eventTeamId: team.id,
                orderId: team.order.id,
                amountCents,
                financeApprovalRequired: true,
                seatRetainedUntilRefundSuccess: true,
              } as never,
            },
          });
          return {
            registration: {
              ...team,
              ...evidence,
              cancellationPending: true,
              cancellationResolvedAt: null,
            },
            refund,
            outcome: 'REFUND_REQUESTED',
          };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (
        isPrismaErrorCode(error, 'P2002') ||
        isPrismaErrorCode(error, 'P2034')
      ) {
        const concurrent = await replay();
        if (concurrent) return concurrent;
        throw new ConflictException('参赛退出发生并发冲突，请使用原命令重试');
      }
      throw error;
    }
  }

  /** Manually retry timeout cleanup and FIFO promotion from event operations. */
  async promoteWaitlist(eventId: string, actor: AuthUser) {
    this.assertEventManager(actor);
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        return await this.prisma.$transaction(
          async (tx) => {
            const event = await tx.event.findUnique({
              where: { id: eventId },
              select: { id: true },
            });
            if (!event) throw new NotFoundException('赛事不存在');
            return promoteNextEventWaitlist(
              tx,
              eventId,
              actor.sub,
              actor.roles[0],
            );
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        );
      } catch (error) {
        if (
          attempt < 3 &&
          (isPrismaErrorCode(error, 'P2002') ||
            isPrismaErrorCode(error, 'P2034'))
        ) {
          continue;
        }
        if (
          isPrismaErrorCode(error, 'P2002') ||
          isPrismaErrorCode(error, 'P2034')
        ) {
          throw new ConflictException('候补晋级发生并发冲突，请稍后重试');
        }
        throw error;
      }
    }
    throw new ConflictException('候补晋级发生并发冲突，请稍后重试');
  }

  async cancel(eventId: string, dto: CancelEventDto, actor: AuthUser) {
    this.assertEventManager(actor);
    const reason = normaliseText(dto.reason);
    const idempotencyKey = normaliseText(dto.idempotencyKey);
    if (reason.length < 2) throw new BadRequestException('取消原因至少2个字符');
    this.assertCommandKey(idempotencyKey, '赛事取消幂等键');
    const commandHash = orderCreationCommandHash({
      kind: 'EVENT_CANCEL',
      eventId,
      reason,
      actorId: actor.sub,
    });

    const replay = async () => {
      const existing = await this.prisma.event.findUnique({
        where: { cancelIdempotencyKey: idempotencyKey },
      });
      if (!existing) return null;
      if (
        existing.id !== eventId ||
        existing.cancelledById !== actor.sub ||
        existing.cancelCommandHash !== commandHash
      ) {
        throw new ConflictException('赛事取消幂等键已用于不同命令');
      }
      return { event: existing, idempotent: true };
    };
    const existingReplay = await replay();
    if (existingReplay) return existingReplay;

    try {
      return await this.prisma.$transaction(
        async (tx) => {
          const current = await tx.event.findUnique({
            where: { id: eventId },
          });
          if (!current) throw new NotFoundException('赛事不存在');
          if (current.status === EventStatus.CANCELLED) {
            if (
              current.cancelIdempotencyKey === idempotencyKey &&
              current.cancelledById === actor.sub &&
              current.cancelCommandHash === commandHash
            ) {
              return { event: current, idempotent: true };
            }
            throw new ConflictException('赛事已经由另一取消命令处理');
          }
          if (!EVENT_CANCELLABLE_STATUSES.includes(current.status)) {
            throw new ConflictException(
              `赛事当前状态为 ${current.status}，不可取消`,
            );
          }
          const now = new Date();
          if (current.startsAt <= now) {
            throw new ConflictException('赛事已开赛，不能执行开赛前取消');
          }

          const teams = await tx.eventTeam.findMany({
            where: {
              eventId,
              status: {
                in: [
                  RegistrationStatus.WAITLISTED,
                  RegistrationStatus.REGISTERED,
                  RegistrationStatus.PAID,
                  RegistrationStatus.CHECKED_IN,
                ],
              },
            },
            include: { order: { include: { refunds: true } } },
            orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          });
          const refundPlans = teams.flatMap((team) => {
            const order = team.order;
            if (!order || order.paidCents <= order.refundedCents) return [];
            const activeRefunds = order.refunds.filter((refund) =>
              ACTIVE_REFUND_STATUSES.includes(refund.status),
            );
            const pending = activeRefunds
              .reduce((sum, refund) => sum + refund.amountCents, 0);
            const amountCents = Math.max(
              0,
              order.paidCents - order.refundedCents - pending,
            );
            const originalOrderStatus =
              order.refundedCents > 0
                ? OrderStatus.PARTIALLY_REFUNDED
                : order.status === OrderStatus.REFUND_PENDING
                  ? activeRefunds[0]?.originalOrderStatus
                  : order.status;
            if (
              !originalOrderStatus ||
              ![
                OrderStatus.PAID,
                OrderStatus.CHECKED_IN,
                OrderStatus.COMPLETED,
                OrderStatus.PARTIALLY_REFUNDED,
              ].includes(originalOrderStatus as never)
            ) {
              throw new ConflictException(
                '赛事退款缺少可恢复的原订单状态证据',
              );
            }
            return amountCents > 0
              ? [{ team, order, amountCents, originalOrderStatus }]
              : [];
          });
          const cancelPolicySnapshot = {
            version: 1,
            decidedAt: now.toISOString(),
            eligibility: 'FULL_REMAINING_PAID_AMOUNT',
            approvalRequired: true,
            approvalRoles: [
              AppRole.FINANCE,
              AppRole.ADMIN,
              AppRole.SUPER_ADMIN,
            ],
            pendingOrders: teams.filter(
              (team) => team.order?.status === OrderStatus.PENDING,
            ).length,
            waitlistedTeams: teams.filter(
              (team) => team.status === RegistrationStatus.WAITLISTED,
            ).length,
            refundRequestCount: refundPlans.length,
            refundRequestedCents: refundPlans.reduce(
              (sum, plan) => sum + plan.amountCents,
              0,
            ),
          };
          const changed = await tx.event.updateMany({
            where: {
              id: eventId,
              status: current.status,
              startsAt: { gt: now },
            },
            data: {
              status: EventStatus.CANCELLED,
              cancelReason: reason,
              cancelPolicySnapshot,
              cancelIdempotencyKey: idempotencyKey,
              cancelCommandHash: commandHash,
              cancelledById: actor.sub,
              cancelledAt: now,
            },
          });
          if (changed.count !== 1) {
            throw new ConflictException('赛事状态已变化，请刷新后重试取消');
          }

          let cancelledPendingOrders = 0;
          let cancelledWaitlist = 0;
          for (const team of teams) {
            if (team.status === RegistrationStatus.WAITLISTED) {
              cancelledWaitlist += 1;
            }
            if (team.order?.status === OrderStatus.PENDING) {
              const cancelled = await tx.order.updateMany({
                where: { id: team.order.id, status: OrderStatus.PENDING },
                data: { status: OrderStatus.CANCELLED, cancelledAt: now },
              });
              cancelledPendingOrders += cancelled.count;
              await tx.payment.updateMany({
                where: {
                  orderId: team.order.id,
                  status: {
                    in: [
                      PaymentStatus.CREATED,
                      PaymentStatus.PROCESSING,
                      PaymentStatus.FAILED,
                    ],
                  },
                },
                data: { status: PaymentStatus.CLOSED },
              });
            }
            await tx.eventTeam.updateMany({
              where: {
                id: team.id,
                status: team.status,
              },
              data: {
                status: RegistrationStatus.CANCELLED,
                paymentDueAt: null,
                cancellationPending: false,
                cancellationResolvedAt: team.cancelRequestedAt
                  ? (team.cancellationResolvedAt ?? now)
                  : undefined,
                cancelledAt: now,
              },
            });
          }

          const refundRequests = [];
          for (const plan of refundPlans) {
            const refundIdempotencyKey = `EVENT_CANCEL:${eventId}:${plan.order.id}`;
            const refundReason = `赛事取消：${reason}`;
            const existingRefund = await tx.refund.findUnique({
              where: { idempotencyKey: refundIdempotencyKey },
            });
            if (
              existingRefund &&
              (existingRefund.orderId !== plan.order.id ||
                existingRefund.requestedById !== actor.sub ||
                existingRefund.amountCents !== plan.amountCents ||
                existingRefund.reason !== refundReason)
            ) {
              throw new ConflictException(
                '赛事取消退款幂等键已用于不同退款命令',
              );
            }
            const refund =
              existingRefund ??
              (await tx.refund.create({
                data: {
                  refundNo: serial('RF'),
                  idempotencyKey: refundIdempotencyKey,
                  orderId: plan.order.id,
                  requestedById: actor.sub,
                  amountCents: plan.amountCents,
                  reason: refundReason,
                  status: RefundStatus.REQUESTED,
                  originalOrderStatus: plan.originalOrderStatus,
                },
              }));
            await tx.order.updateMany({
              where: {
                id: plan.order.id,
                status: {
                  in: [
                    OrderStatus.PAID,
                    OrderStatus.CHECKED_IN,
                    OrderStatus.COMPLETED,
                    OrderStatus.PARTIALLY_REFUNDED,
                  ],
                },
              },
              data: { status: OrderStatus.REFUND_PENDING },
            });
            await tx.auditLog.create({
              data: {
                actorId: actor.sub,
                actorRole: actor.roles[0],
                action: 'EVENT_CANCELLATION_REFUND_REQUESTED',
                objectType: 'Refund',
                objectId: refund.id,
                reason,
                newValue: {
                  eventId,
                  eventTeamId: plan.team.id,
                  orderId: plan.order.id,
                  amountCents: plan.amountCents,
                  status: RefundStatus.REQUESTED,
                  financeApprovalRequired: true,
                } as never,
              },
            });
            refundRequests.push(refund);
          }

          const event = await tx.event.findUniqueOrThrow({
            where: { id: eventId },
          });
          await tx.auditLog.create({
            data: {
              actorId: actor.sub,
              actorRole: actor.roles[0],
              action: 'EVENT_CANCELLED',
              objectType: 'Event',
              objectId: eventId,
              reason,
              oldValue: { status: current.status } as never,
              newValue: {
                status: EventStatus.CANCELLED,
                cancelPolicySnapshot,
                cancelledPendingOrders,
                cancelledWaitlist,
                refundRequestIds: refundRequests.map((refund) => refund.id),
              } as never,
            },
          });
          return {
            event,
            cancelledPendingOrders,
            cancelledWaitlist,
            refundRequests,
          };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (isPrismaErrorCode(error, 'P2002')) {
        const concurrent = await replay();
        if (concurrent) return concurrent;
      }
      if (isPrismaErrorCode(error, 'P2034')) {
        throw new ConflictException('赛事取消发生并发冲突，请使用原命令重试');
      }
      throw error;
    }
  }

  async checkIn(
    eventId: string,
    teamId: string,
    actor: AuthUser,
    dto: EventTeamCheckInDto = {},
  ) {
    return this.prisma.$transaction(async (tx) => {
      const team = await tx.eventTeam.findFirst({
        where: { id: teamId, eventId },
        include: {
          event: { select: { startsAt: true } },
          order: { select: { status: true } },
        },
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
      if (
        team.cancellationPending ||
        team.order?.status === OrderStatus.REFUND_PENDING
      ) {
        throw new ConflictException('该报名正在等待退款审批，暂不可签到');
      }
      const checkedInAt = new Date();
      const timeWindowPolicy = await assertOperationTimeWindow(tx, {
        actor,
        parameterKey: EVENT_CHECK_IN_WINDOW_PARAMETER,
        defaults: { earlyMinutes: 30, lateMinutes: 30 },
        scheduledStartsAt: team.event.startsAt,
        scheduledEndsAt: team.event.startsAt,
        action: 'EVENT_TEAM_CHECK_IN',
        objectType: 'EventTeam',
        objectId: teamId,
        overrideReason: dto.overrideReason,
        observedAt: checkedInAt,
      });
      const updated = await tx.eventTeam.update({
        where: { id: teamId },
        data: {
          status: RegistrationStatus.CHECKED_IN,
          checkedInAt,
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
          newValue: {
            status: RegistrationStatus.CHECKED_IN,
            checkedInAt: checkedInAt.toISOString(),
            timeWindowPolicy,
          } as never,
        },
      });
      return updated;
    });
  }

  async startNextRound(eventId: string, actor: AuthUser) {
    this.assertEventManager(actor);
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

  async correctPairings(
    eventId: string,
    round: number,
    dto: CorrectEventPairingsDto,
    actor: AuthUser,
  ) {
    this.assertEventManager(actor);
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
    this.assertCommandKey(idempotencyKey, '配对调整幂等键');
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
        throw new ConflictException(
          '配对调整幂等键已用于其他指令，请更换幂等键',
        );
      }
    };
    const loadRound = (client: Prisma.TransactionClient | PrismaService) =>
      client.eventMatch.findMany({
        where: { eventId, round },
        orderBy: { createdAt: 'asc' },
      });

    try {
      return await this.prisma.$transaction(
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
          this.assertEventConfiguration(event);
          if (
            event.status !== EventStatus.IN_PROGRESS ||
            event.currentRound !== round
          ) {
            throw new ConflictException('只能调整当前进行中轮次的配对');
          }
          this.assertPeopleRange(event.teams.length, event.capacityPeople);
          this.assertParticipantIdsUnique(event.teams);
          for (const team of event.teams) this.assertFixedDoubles(team);
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

          this.assertPairings(
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
            const teamA = event.teams.find(
              (team) => team.id === pairing.pairAId,
            );
            const teamB = event.teams.find(
              (team) => team.id === pairing.pairBId,
            );
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
          await this.recomputeStandings(tx, eventId);
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
        const replay = await this.prisma.auditLog.findFirst({
          where: { requestId, action: 'EVENT_PAIRINGS_CORRECTED' },
        });
        if (replay) {
          assertReplay(replay);
          return loadRound(this.prisma);
        }
        throw new ConflictException('配对调整发生并发冲突，请刷新后重试');
      }
      throw error;
    }
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
          include: {
            teams: {
              include: {
                order: {
                  select: {
                    id: true,
                    status: true,
                    completedAt: true,
                    paidCents: true,
                    refundedCents: true,
                  },
                },
              },
            },
            matches: true,
          },
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
          await this.completeTerminalEventOrders(tx, event.id, event.teams, actor);
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
        if (
          event.teams.some(
            (team) => team.order?.status === OrderStatus.REFUND_PENDING,
          )
        ) {
          throw new ConflictException(
            '赛事存在待审退款报名，请先处理退款再完赛',
          );
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
        const participantOutcomes = await this.finalizeEventNonParticipants(
          tx,
          event.id,
          event.teams,
          actor,
          new Date(),
        );
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
          if (
            team.order &&
            EVENT_COMPLETED_ORDER_STATUSES.has(team.order.status)
          ) {
            await completeOrderFulfillment(tx, {
              orderId: team.order.id,
              actor,
              objectType: 'EventTeam',
              objectId: team.id,
              outcome: 'COMPLETED',
              reason: '赛事完赛且队伍有签到及完整赛果',
              metadata: {
                eventId: event.id,
                finalRank: rank,
                eventPointsAwarded: points,
              },
            });
          }
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
              noShowTeamIds: participantOutcomes.noShowTeamIds,
              expiredTeamIds: participantOutcomes.expiredTeamIds,
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

  private async completeTerminalEventOrders(
    tx: Prisma.TransactionClient,
    eventId: string,
    teams: Array<{
      id: string;
      status: RegistrationStatus;
      finalRank: number | null;
      order?: {
        id: string;
        status: OrderStatus;
        completedAt: Date | null;
      } | null;
    }>,
    actor: AuthUser,
  ): Promise<void> {
    for (const team of teams) {
      if (
        !team.order ||
        team.order.completedAt ||
        (team.status !== RegistrationStatus.COMPLETED &&
          team.status !== RegistrationStatus.NO_SHOW)
      ) {
        continue;
      }
      const allowed = team.status === RegistrationStatus.NO_SHOW
        ? EVENT_NO_SHOW_ORDER_STATUSES
        : EVENT_COMPLETED_ORDER_STATUSES;
      if (!allowed.has(team.order.status)) continue;
      await completeOrderFulfillment(tx, {
        orderId: team.order.id,
        actor,
        objectType: 'EventTeam',
        objectId: team.id,
        outcome: team.status === RegistrationStatus.NO_SHOW
          ? 'NO_SHOW'
          : 'COMPLETED',
        reason: team.status === RegistrationStatus.NO_SHOW
          ? '赛事结束且队伍无签到记录'
          : '补全历史完赛订单履约时间',
        metadata: { eventId, finalRank: team.finalRank },
      });
    }
  }

  private async finalizeEventNonParticipants(
    tx: Prisma.TransactionClient,
    eventId: string,
    teams: Array<{
      id: string;
      status: RegistrationStatus;
      orderId: string | null;
      paymentDueAt: Date | null;
      order?: {
        id: string;
        status: OrderStatus;
        completedAt: Date | null;
      } | null;
    }>,
    actor: AuthUser,
    completedAt: Date,
  ): Promise<{ noShowTeamIds: string[]; expiredTeamIds: string[] }> {
    const noShowTeamIds: string[] = [];
    const expiredTeamIds: string[] = [];
    for (const team of teams) {
      let outcome: RegistrationStatus | null = null;
      if (
        team.status === RegistrationStatus.PAID &&
        (!team.order || EVENT_NO_SHOW_ORDER_STATUSES.has(team.order.status))
      ) {
        outcome = RegistrationStatus.NO_SHOW;
      } else if (
        team.status === RegistrationStatus.REGISTERED ||
        team.status === RegistrationStatus.WAITLISTED
      ) {
        outcome = RegistrationStatus.CANCELLED;
      }
      if (!outcome) continue;

      const changed = await tx.eventTeam.updateMany({
        where: { id: team.id, eventId, status: team.status },
        data: outcome === RegistrationStatus.NO_SHOW
          ? { status: outcome, paymentDueAt: null }
          : { status: outcome, paymentDueAt: null, cancelledAt: completedAt },
      });
      if (changed.count !== 1) continue;

      if (
        outcome === RegistrationStatus.CANCELLED &&
        team.order?.status === OrderStatus.PENDING
      ) {
        await tx.order.updateMany({
          where: { id: team.order.id, status: OrderStatus.PENDING },
          data: { status: OrderStatus.CANCELLED, cancelledAt: completedAt },
        });
        await tx.payment.updateMany({
          where: {
            orderId: team.order.id,
            status: {
              in: [
                PaymentStatus.CREATED,
                PaymentStatus.PROCESSING,
                PaymentStatus.FAILED,
              ],
            },
          },
          data: { status: PaymentStatus.CLOSED },
        });
      } else if (
        outcome === RegistrationStatus.NO_SHOW &&
        team.order
      ) {
        await completeOrderFulfillment(tx, {
          orderId: team.order.id,
          actor,
          objectType: 'EventTeam',
          objectId: team.id,
          outcome: 'NO_SHOW',
          completedAt,
          reason: '赛事结束且队伍无签到记录',
          metadata: { eventId },
        });
      }

      if (outcome === RegistrationStatus.NO_SHOW) noShowTeamIds.push(team.id);
      else expiredTeamIds.push(team.id);
      await tx.auditLog.create({
        data: {
          actorId: actor.sub,
          actorRole: actor.roles[0],
          action: outcome === RegistrationStatus.NO_SHOW
            ? 'EVENT_TEAM_NO_SHOW'
            : 'EVENT_REGISTRATION_EXPIRED',
          objectType: 'EventTeam',
          objectId: team.id,
          oldValue: {
            status: team.status,
            paymentDueAt: team.paymentDueAt?.toISOString() ?? null,
          } as never,
          newValue: {
            status: outcome,
            eventId,
            orderId: team.order?.id ?? null,
            completedAt: completedAt.toISOString(),
          } as never,
        },
      });
    }
    return { noShowTeamIds, expiredTeamIds };
  }

  private assertPrizeOperator(actor: AuthUser): void {
    if (
      !actor.roles.some((role) => EVENT_PRIZE_OPERATOR_ROLES.includes(role))
    ) {
      throw new ForbiddenException('当前角色无权发放或签收赛事奖品');
    }
  }

  private assertEventManager(actor: AuthUser): void {
    if (!actor.roles.some((role) => EVENT_MANAGER_ROLES.includes(role))) {
      throw new ForbiddenException('仅赛事管理员或管理员可创建、发布赛事');
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
