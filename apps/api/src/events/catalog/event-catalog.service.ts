import {
  assertEventConfiguration,
  assertEventManager,
} from '../competition/event-competition-policy.js';
import {
  isPrismaErrorCode,
  normaliseText,
  normaliseOptionalText,
} from '../shared/event-command-support.js';
import {
  Inject,
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { AuthUser } from '../../common/auth/auth-user.js';
import { PrismaService } from '../../database/prisma.service.js';
import {
  EventStatus,
  Prisma,
  RegistrationStatus,
} from '../../generated/prisma/client.js';
import type { CreateEventDto, PublishEventDto } from '../events.dto.js';
import {
  EVENT_MAX_CAPACITY_PEOPLE,
  EVENT_MINIMUM_PEOPLE,
  EVENT_TOTAL_ROUNDS,
} from '../events.dto.js';

const DEFAULT_RULES = [
  '固定搭档双打，男双、女双、混双同场',
  '每场一局 21 分，20 平后不加分',
  '男双对女双让 5 分，男双对混双让 2 分，混双对女双让 2 分',
  '五轮瑞士积分制，尽量避免重复对手',
];

const parseDate = (value: unknown, field: string): Date => {
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) {
    throw new BadRequestException(`${field} 不是有效时间`);
  }
  return date;
};

@Injectable()
export class EventCatalogService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async list() {
    return this.prisma.event.findMany({
      where: {
        status: {
          in: [
            EventStatus.OPEN,
            EventStatus.FULL,
            EventStatus.IN_PROGRESS,
            EventStatus.COMPLETED,
          ],
        },
      },
      select: {
        id: true,
        code: true,
        name: true,
        startsAt: true,
        registrationEndsAt: true,
        status: true,
        capacityPeople: true,
        minimumPeople: true,
        totalRounds: true,
        currentRound: true,
        feeCents: true,
        memberFeeCents: true,
        sponsor: true,
      },
      orderBy: { startsAt: 'desc' },
    });
  }

  async detail(eventId: string) {
    const event = await this.prisma.event
      .findFirstOrThrow({
        where: {
          id: eventId,
          status: {
            in: [
              EventStatus.OPEN,
              EventStatus.FULL,
              EventStatus.IN_PROGRESS,
              EventStatus.COMPLETED,
            ],
          },
        },
        select: {
          id: true,
          code: true,
          name: true,
          startsAt: true,
          registrationEndsAt: true,
          status: true,
          capacityPeople: true,
          minimumPeople: true,
          totalRounds: true,
          currentRound: true,
          feeCents: true,
          memberFeeCents: true,
          sponsor: true,
          teams: {
            where: {
              status: RegistrationStatus.COMPLETED,
              finalRank: { not: null },
            },
            select: {
              name: true,
              category: true,
              points: true,
              wins: true,
              losses: true,
              scoreDiff: true,
              finalRank: true,
            },
            orderBy: { finalRank: 'asc' },
          },
        },
      })
      .catch((error: unknown) => {
        if (isPrismaErrorCode(error, 'P2025'))
          throw new NotFoundException('赛事不存在或已下架');
        throw error;
      });
    const { teams, ...summary } = event;
    return {
      ...summary,
      standings: event.status === EventStatus.COMPLETED ? teams : [],
    };
  }

  managedList() {
    return this.prisma.event.findMany({
      select: {
        id: true,
        code: true,
        name: true,
        startsAt: true,
        registrationEndsAt: true,
        status: true,
        capacityPeople: true,
        minimumPeople: true,
        totalRounds: true,
        currentRound: true,
        feeCents: true,
        memberFeeCents: true,
        prizePool: true,
        sponsor: true,
        cancelReason: true,
        cancelledAt: true,
        _count: { select: { teams: true } },
      },
      orderBy: { startsAt: 'desc' },
    });
  }

  managedDetail(eventId: string) {
    return this.prisma.event.findUniqueOrThrow({
      where: { id: eventId },
      select: {
        id: true,
        code: true,
        name: true,
        startsAt: true,
        registrationEndsAt: true,
        status: true,
        capacityPeople: true,
        minimumPeople: true,
        totalRounds: true,
        currentRound: true,
        feeCents: true,
        memberFeeCents: true,
        prizePool: true,
        sponsor: true,
        cancelReason: true,
        cancelledAt: true,
        teams: {
          select: {
            id: true,
            name: true,
            playerAName: true,
            playerBName: true,
            playerAPhone: true,
            playerBPhone: true,
            captainPlays: true,
            registrationMode: true,
            category: true,
            seed: true,
            status: true,
            waitlistedAt: true,
            promotedAt: true,
            paymentDueAt: true,
            cancelReason: true,
            cancelRequestedAt: true,
            cancellationPending: true,
            cancellationResolvedAt: true,
            cancelledAt: true,
            checkedInAt: true,
            points: true,
            wins: true,
            losses: true,
            scoreDiff: true,
            finalRank: true,
            eventPointsAwarded: true,
            order: { select: { status: true } },
          },
          orderBy: [{ points: 'desc' }, { scoreDiff: 'desc' }, { seed: 'asc' }],
        },
        matches: {
          select: {
            id: true,
            round: true,
            courtLabel: true,
            teamAId: true,
            teamBId: true,
            startingScoreA: true,
            startingScoreB: true,
            scoreA: true,
            scoreB: true,
            status: true,
            correctionReason: true,
            submittedAt: true,
            confirmedAt: true,
          },
          orderBy: [{ round: 'asc' }, { createdAt: 'asc' }],
        },
      },
    });
  }

  create(dto: CreateEventDto, actor: AuthUser) {
    assertEventManager(actor);
    const capacityPeople = dto.capacityPeople ?? EVENT_MAX_CAPACITY_PEOPLE;
    const minimumPeople = dto.minimumPeople ?? EVENT_MINIMUM_PEOPLE;
    const totalRounds = dto.totalRounds ?? EVENT_TOTAL_ROUNDS;
    assertEventConfiguration(
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
    assertEventManager(actor);
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
        assertEventConfiguration(current);
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
}
