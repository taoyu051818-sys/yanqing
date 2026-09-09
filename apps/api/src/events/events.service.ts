import {
  assertEventConfiguration,
  assertFixedDoubles,
  assertEventManager,
  EVENT_MANAGER_ROLES,
} from './event-competition-policy.js';
import { startNextRound, correctPairings } from './event-rounds.js';
import { submitScore, correctScore } from './event-scoring.js';
import { finish } from './event-completion.js';
import {
  serial,
  isPrismaErrorCode,
  normaliseText,
  normaliseOptionalText,
  assertCommandKey,
} from './event-command-support.js';
import {
  eventTeamCancellationRefundKey,
  EVENT_SEAT_STATUSES,
  eventPaymentDueAt,
} from './event-registration-policy.js';
import { promoteNextEventWaitlist } from './event-waitlist.js';
import { listPrizeAwards, issuePrize, receivePrize } from './event-prizes.js';
import { transitionOrder, requireOrderTransition } from '../orders/order-transition.js';
import { cancelZeroAmountActivityOrder, isZeroAmountConfirmedActivityOrder } from '../orders/zero-amount-activity-order.js';
import { createHash, randomBytes } from 'node:crypto';
import { stateTransition, lockAdmissionOrder } from '../common/state-transition.js';
import { membershipEligibility } from '../memberships/membership-eligibility.js';

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import type { AuthUser } from '../common/auth/auth-user.js';
import { PrismaService } from '../database/prisma.service.js';
import {
  AppRole,
  BusinessType,
  EventStatus,
  OrderStatus,
  PaymentStatus,
  Prisma,
  RefundStatus,
  RegistrationStatus,
  SourceChannel,
  SubjectAccount,
  UserStatus,
} from '../generated/prisma/client.js';
import { orderCreationCommandHash } from '../orders/order-creation-idempotency.js';
import { orderResponse } from '../orders/order-response.js';
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
  CreateEventTeamInviteDto,
  AcceptEventTeamInviteDto,
  SubmitScoreDto,
} from './events.dto.js';
import {
  assertOperationTimeWindow,
  EVENT_CHECK_IN_WINDOW_PARAMETER,
} from '../common/time-window/operation-time-window.js';
import { resolveOperatingShareSnapshot } from '../common/finance/operating-share.js';
import {
  EVENT_MAX_CAPACITY_PEOPLE,
  EVENT_MINIMUM_PEOPLE,
  EVENT_TOTAL_ROUNDS,
  normalizeParticipantPhone,
} from './events.dto.js';

const DEFAULT_RULES = [
  '固定搭档双打，男双、女双、混双同场',
  '每场一局 21 分，20 平后不加分',
  '男双对女双让 5 分，男双对混双让 2 分，混双对女双让 2 分',
  '五轮瑞士积分制，尽量避免重复对手',
];

const eventRegistrationResponse = (value: any) => {
  if (value?.orderNo || value?.businessType) return orderResponse(value);
  if (!value?.registration) return value;
  return {
    status: value.status ?? value.registration.status,
    waitlistPosition: value.waitlistPosition ?? null,
    registration: {
      name: value.registration.name,
      category: value.registration.category,
      status: value.registration.status,
      paymentDueAt: value.registration.paymentDueAt,
    },
  };
};

const eventCommandResponse = (event: any) => ({
  id: event.id,
  code: event.code,
  name: event.name,
  status: event.status,
  startsAt: event.startsAt,
  endsAt: event.endsAt,
  cancelReason: event.cancelReason,
  cancelledAt: event.cancelledAt,
});

const eventCancellationResponse = (value: any) => {
  const policy =
    value?.event?.cancelPolicySnapshot &&
    typeof value.event.cancelPolicySnapshot === 'object'
      ? value.event.cancelPolicySnapshot
      : {};
  return {
    event: eventCommandResponse(value.event),
    cancelledPendingOrders: Number(
      value.cancelledPendingOrders ?? policy.pendingOrders ?? 0,
    ),
    cancelledWaitlist: Number(
      value.cancelledWaitlist ?? policy.waitlistedTeams ?? 0,
    ),
    refundRequestCount: Number(
      value.refundRequestCount ??
        value.refundRequests?.length ??
        policy.refundRequestCount ??
        0,
    ),
    refundRequestedCents: Number(
      value.refundRequests?.reduce(
        (total: number, refund: any) => total + Number(refund.amountCents || 0),
        0,
      ) ??
        policy.refundRequestedCents ??
        0,
    ),
    idempotent: Boolean(value.idempotent),
  };
};

const eventTeamCommandResponse = (team: any) => ({
  id: team.id,
  name: team.name,
  category: team.category,
  status: team.status,
  checkedInAt: team.checkedInAt,
  cancellationPending: Boolean(team.cancellationPending),
  order: team.order ? { status: team.order.status } : undefined,
});
export const EVENT_PARTNER_INVITE_TTL_MINUTES = 15;

const eventPartnerInviteHash = (value: string): string =>
  createHash('sha256').update(value).digest('hex');

const ASSISTED_EVENT_REGISTRATION_ROLES: readonly AppRole[] = [
  AppRole.FRONT_DESK,
  AppRole.EVENT_MANAGER,
  AppRole.ADMIN,
  AppRole.SUPER_ADMIN,
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

  private async resolvePartnerInvite(
    client: Pick<Prisma.TransactionClient, 'eventPartnerInvite' | 'eventTeam'>,
    eventId: string,
    partnerInviteCode: string,
    actor: AuthUser,
    now: Date,
  ) {
    const invite = await client.eventPartnerInvite.findUnique({
      where: { tokenHash: eventPartnerInviteHash(partnerInviteCode) },
      include: {
        partner: {
          select: {
            id: true,
            displayName: true,
            status: true,
            deletedAt: true,
            memberProfile: { select: { id: true } },
          },
        },
      },
    });
    if (
      !invite ||
      invite.eventId !== eventId ||
      invite.revokedAt ||
      invite.consumedAt ||
      invite.expiresAt <= now
    ) {
      throw new ConflictException('搭档授权码无效、已使用或已过期');
    }
    if (
      !invite.partner ||
      invite.partner.status !== UserStatus.ACTIVE ||
      invite.partner.deletedAt ||
      !invite.partner.memberProfile
    ) {
      throw new ConflictException('搭档尚未确认邀请，或账号已停用');
    }
    if (invite.captainId && invite.captainId !== actor.sub)
      throw new ForbiddenException('这份邀请只能由发起的队长提交报名');
    if (invite.partnerId === actor.sub) {
      throw new ConflictException('不能使用自己生成的搭档授权码');
    }
    const duplicate = await client.eventTeam.findFirst({
      where: {
        eventId,
        status: {
          notIn: [RegistrationStatus.CANCELLED, RegistrationStatus.REFUNDED],
        },
        OR: [
          { captainId: invite.partnerId! },
          { playerAUserId: invite.partnerId },
          { playerBUserId: invite.partnerId },
        ],
      },
      select: { id: true },
    });
    if (duplicate) {
      throw new ConflictException('授权搭档已参加本赛事或正在候补');
    }
    return invite;
  }

  private assertSignupContact(name: string, phone: string) {
    if (!normaliseText(name) || !/^1[3-9]\d{9}$/.test(phone))
      throw new BadRequestException('两位选手均须填写姓名和11位联系电话');
  }

  private async assertPhoneAvailable(
    tx: Prisma.TransactionClient,
    eventId: string,
    phones: string[],
    userIds: string[] = [],
  ) {
    const contacts = phones.filter(Boolean);
    if (!contacts.length) return;
    if (new Set(contacts).size !== contacts.length)
      throw new ConflictException('两位选手不能使用相同的联系电话');
    // Compare with both guest contact snapshots and existing account-linked
    // registrations. A supplied phone never grants access to that account.
    const users = await tx.user.findMany({
      where: { phone: { in: contacts } },
      select: { id: true },
    });
    const ids = [...new Set([...userIds, ...users.map((user) => user.id)])];
    const existing = await tx.eventTeam.findFirst({
      where: {
        eventId,
        status: {
          notIn: [RegistrationStatus.CANCELLED, RegistrationStatus.REFUNDED],
        },
        OR: [
          { playerAPhone: { in: contacts } },
          { playerBPhone: { in: contacts } },
          ...ids.flatMap((id) => [
            { playerAUserId: id },
            { playerBUserId: id },
          ]),
        ],
      },
      select: { id: true },
    });
    if (existing)
      throw new ConflictException(
        '其中一位选手已报名本赛事或正在候补，请勿重复提交',
      );
  }

  private async teamInviteRecord(
    client: Pick<Prisma.TransactionClient, 'eventPartnerInvite'>,
    eventId: string,
    code: string,
  ) {
    const invite = await client.eventPartnerInvite.findUnique({
      where: { tokenHash: eventPartnerInviteHash(code) },
      include: {
        event: {
          select: {
            id: true,
            name: true,
            status: true,
            startsAt: true,
            registrationEndsAt: true,
            feeCents: true,
          },
        },
        captain: {
          select: {
            id: true,
            displayName: true,
            avatarUrl: true,
            status: true,
            deletedAt: true,
          },
        },
        partner: {
          select: {
            id: true,
            displayName: true,
            avatarUrl: true,
            status: true,
            deletedAt: true,
          },
        },
      },
    });
    if (
      !invite?.captain ||
      invite.eventId !== eventId ||
      invite.revokedAt ||
      invite.captain.status !== UserStatus.ACTIVE ||
      invite.captain.deletedAt
    ) {
      throw new NotFoundException('搭档邀请无效或已撤回，请好友重新分享');
    }
    return invite;
  }

  async createTeamInvite(
    eventId: string,
    dto: CreateEventTeamInviteDto,
    actor: AuthUser,
  ) {
    if (!actor.roles.includes(AppRole.MEMBER))
      throw new ForbiddenException('请使用会员身份邀请搭档');
    if (dto.consent !== true)
      throw new BadRequestException('请确认已征得参赛者同意');
    const name = normaliseText(dto.name),
      playerAName = normaliseText(dto.playerAName),
      playerAPhone = normalizeParticipantPhone(dto.playerAPhone);
    if (!name) throw new BadRequestException('请填写队伍名称');
    this.assertSignupContact(playerAName, playerAPhone);
    const code = `EP_${randomBytes(24).toString('base64url')}`;
    const expiresAt = await this.prisma
      .$transaction(
        async (tx) => {
          const event = await tx.event.findUnique({ where: { id: eventId } });
          const now = new Date();
          if (
            !event ||
            ![EventStatus.OPEN, EventStatus.FULL].includes(event.status as any)
          )
            throw new ConflictException('赛事不在报名期');
          if (event.registrationEndsAt <= now || event.startsAt <= now)
            throw new ConflictException('赛事报名已截止');
          await this.assertPhoneAvailable(
            tx,
            eventId,
            [playerAPhone],
            [actor.sub],
          );
          const duplicate = await tx.eventTeam.findFirst({
            where: {
              eventId,
              captainId: actor.sub,
              status: {
                notIn: [
                  RegistrationStatus.CANCELLED,
                  RegistrationStatus.REFUNDED,
                ],
              },
            },
            select: { id: true },
          });
          if (duplicate)
            throw new ConflictException('你已提交本赛事报名或候补');
          const expiry = new Date(
            Math.min(
              now.getTime() + 24 * 3_600_000,
              event.registrationEndsAt.getTime(),
              event.startsAt.getTime(),
            ),
          );
          await tx.eventPartnerInvite.updateMany({
            where: {
              eventId,
              captainId: actor.sub,
              consumedAt: null,
              revokedAt: null,
            },
            data: { revokedAt: now },
          });
          const invite = await tx.eventPartnerInvite.create({
            data: {
              eventId,
              captainId: actor.sub,
              teamName: name,
              playerAName,
              playerAPhone,
              category: dto.category,
              tokenHash: eventPartnerInviteHash(code),
              expiresAt: expiry,
            },
          });
          await tx.auditLog.create({
            data: {
              actorId: actor.sub,
              actorRole: actor.roles[0],
              action: 'EVENT_TEAM_INVITE_CREATED',
              objectType: 'EventPartnerInvite',
              objectId: invite.id,
              newValue: {
                eventId,
                expiresAt: expiry.toISOString(),
                consent: true,
              },
            },
          });
          return expiry;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      )
      .catch((error) => {
        if (isPrismaErrorCode(error, 'P2034'))
          throw new ConflictException('邀请状态发生并发变化，请重试');
        throw error;
      });
    return { partnerInviteCode: code, expiresAt };
  }

  async previewTeamInvite(eventId: string, code: string, actor?: AuthUser) {
    const invite = await this.teamInviteRecord(this.prisma, eventId, code);
    const now = new Date();
    const role =
      actor?.sub === invite.captainId
        ? 'CAPTAIN'
        : actor?.sub === invite.partnerId
          ? 'PARTNER'
          : 'VISITOR';
    const expired =
      invite.expiresAt <= now ||
      invite.event.registrationEndsAt <= now ||
      invite.event.startsAt <= now ||
      ![EventStatus.OPEN, EventStatus.FULL].includes(
        invite.event.status as any,
      );
    return {
      status: invite.consumedAt
        ? 'SUBMITTED'
        : expired
          ? 'EXPIRED'
          : invite.acceptedAt
            ? 'ACCEPTED'
            : 'PENDING',
      role,
      event: {
        id: invite.event.id,
        name: invite.event.name,
        startsAt: invite.event.startsAt,
        feeCents: invite.event.feeCents,
      },
      captain: {
        displayName: invite.captain!.displayName,
        avatarUrl: invite.captain!.avatarUrl,
      },
      teamName: invite.teamName,
      category: invite.category,
      expiresAt: invite.expiresAt,
      ...(role === 'CAPTAIN' || role === 'PARTNER'
        ? {
            playerAName: invite.playerAName,
            playerBName: invite.playerBName,
            partner: invite.partner
              ? {
                  displayName: invite.partner.displayName,
                  avatarUrl: invite.partner.avatarUrl,
                }
              : null,
          }
        : {}),
    };
  }

  async acceptTeamInvite(
    eventId: string,
    dto: AcceptEventTeamInviteDto,
    actor: AuthUser,
  ) {
    if (!actor.roles.includes(AppRole.MEMBER))
      throw new ForbiddenException('请使用会员身份确认搭档邀请');
    if (dto.consent !== true)
      throw new BadRequestException('请确认同意与该队长组队参赛');
    const name = normaliseText(dto.playerBName),
      phone = normalizeParticipantPhone(dto.playerBPhone);
    this.assertSignupContact(name, phone);
    await this.prisma
      .$transaction(
        async (tx) => {
          const invite = await this.teamInviteRecord(
            tx,
            eventId,
            dto.partnerInviteCode,
          );
          if (invite.captainId === actor.sub)
            throw new ConflictException('不能接受自己发出的搭档邀请');
          if (invite.partnerId === actor.sub && invite.acceptedAt) {
            if (invite.playerBName !== name || invite.playerBPhone !== phone)
              throw new ConflictException(
                '已确认的信息不能覆盖，请队长重新发起邀请',
              );
            return;
          }
          const now = new Date();
          if (invite.partnerId || invite.consumedAt)
            throw new ConflictException('这份邀请已由其他搭档确认');
          if (
            invite.expiresAt <= now ||
            invite.event.registrationEndsAt <= now ||
            invite.event.startsAt <= now ||
            ![EventStatus.OPEN, EventStatus.FULL].includes(
              invite.event.status as any,
            )
          )
            throw new ConflictException(
              '邀请已过期或赛事已截止，请队长重新发起',
            );
          const profile = await tx.memberProfile.findUnique({
            where: { userId: actor.sub },
            select: { id: true },
          });
          if (!profile)
            throw new ConflictException('会员资料尚未建立，请重新登录');
          await this.assertPhoneAvailable(
            tx,
            eventId,
            [invite.playerAPhone!, phone],
            [invite.captainId!, actor.sub],
          );
          const changed = await tx.eventPartnerInvite.updateMany({
            where: {
              id: invite.id,
              partnerId: null,
              consumedAt: null,
              revokedAt: null,
              expiresAt: { gt: now },
            },
            data: {
              partnerId: actor.sub,
              playerBName: name,
              playerBPhone: phone,
              acceptedAt: now,
            },
          });
          if (changed.count !== 1)
            throw new ConflictException('邀请状态已变化，请刷新后重试');
          await tx.auditLog.create({
            data: {
              actorId: actor.sub,
              actorRole: actor.roles[0],
              action: 'EVENT_TEAM_INVITE_ACCEPTED',
              objectType: 'EventPartnerInvite',
              objectId: invite.id,
              newValue: { eventId, consent: true },
            },
          });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      )
      .catch((error) => {
        if (isPrismaErrorCode(error, 'P2034'))
          throw new ConflictException('邀请正在被确认，请刷新后重试');
        throw error;
      });
    return this.previewTeamInvite(eventId, dto.partnerInviteCode, actor);
  }

  async createPartnerInvite(eventId: string, actor: AuthUser) {
    if (!actor.roles.includes(AppRole.MEMBER)) {
      throw new ForbiddenException('只有会员账号可以生成赛事搭档授权码');
    }
    const now = new Date();
    const [event, partner, duplicate] = await Promise.all([
      this.prisma.event.findUnique({
        where: { id: eventId },
        select: {
          id: true,
          status: true,
          startsAt: true,
          registrationEndsAt: true,
        },
      }),
      this.prisma.user.findUnique({
        where: { id: actor.sub },
        select: {
          id: true,
          displayName: true,
          status: true,
          deletedAt: true,
          memberProfile: { select: { id: true } },
        },
      }),
      this.prisma.eventTeam.findFirst({
        where: {
          eventId,
          status: {
            notIn: [RegistrationStatus.CANCELLED, RegistrationStatus.REFUNDED],
          },
          OR: [
            { captainId: actor.sub },
            { playerAUserId: actor.sub },
            { playerBUserId: actor.sub },
          ],
        },
        select: { id: true },
      }),
    ]);
    if (
      !event ||
      (event.status !== EventStatus.OPEN && event.status !== EventStatus.FULL)
    ) {
      throw new NotFoundException('赛事不在报名期');
    }
    if (now >= event.registrationEndsAt || now >= event.startsAt) {
      throw new ConflictException('赛事报名已截止');
    }
    if (
      !partner ||
      partner.status !== UserStatus.ACTIVE ||
      partner.deletedAt ||
      !partner.memberProfile
    ) {
      throw new NotFoundException('会员不存在或已停用');
    }
    if (duplicate) {
      throw new ConflictException('当前账号已参加本赛事或正在候补');
    }

    const partnerInviteCode = `EP_${randomBytes(18).toString('base64url')}`;
    const expiresAt = new Date(
      Math.min(
        now.getTime() + EVENT_PARTNER_INVITE_TTL_MINUTES * 60_000,
        event.registrationEndsAt.getTime(),
        event.startsAt.getTime(),
      ),
    );
    await this.prisma.$transaction(async (tx) => {
      await tx.eventPartnerInvite.updateMany({
        where: {
          eventId,
          partnerId: actor.sub,
          revokedAt: null,
          consumedAt: null,
        },
        data: { revokedAt: now },
      });
      const invite = await tx.eventPartnerInvite.create({
        data: {
          eventId,
          partnerId: actor.sub,
          tokenHash: eventPartnerInviteHash(partnerInviteCode),
          expiresAt,
        },
      });
      await tx.auditLog.create({
        data: {
          actorId: actor.sub,
          actorRole: actor.roles[0],
          action: 'EVENT_PARTNER_INVITE_CREATED',
          objectType: 'EventPartnerInvite',
          objectId: invite.id,
          newValue: {
            eventId,
            partnerId: actor.sub,
            expiresAt: expiresAt.toISOString(),
          } as never,
        },
      });
    });
    return {
      partnerInviteCode,
      partnerDisplayName: partner.displayName,
      expiresAt,
    };
  }

  async previewPartnerInvite(
    eventId: string,
    partnerInviteCode: string,
    actor: AuthUser,
  ) {
    if (!actor.roles.includes(AppRole.MEMBER)) {
      throw new ForbiddenException('只有会员账号可以确认赛事搭档');
    }
    const now = new Date();
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      select: {
        status: true,
        startsAt: true,
        registrationEndsAt: true,
      },
    });
    if (
      !event ||
      (event.status !== EventStatus.OPEN && event.status !== EventStatus.FULL)
    ) {
      throw new NotFoundException('赛事不在报名期');
    }
    if (now >= event.registrationEndsAt || now >= event.startsAt) {
      throw new ConflictException('赛事报名已截止');
    }
    const invite = await this.resolvePartnerInvite(
      this.prisma,
      eventId,
      normaliseText(partnerInviteCode),
      actor,
      now,
    );
    return {
      partnerDisplayName: invite.partner!.displayName,
      expiresAt: invite.expiresAt,
    };
  }

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
    const event = await this.prisma.event.findFirstOrThrow({
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
     }).catch((error: unknown) => {
      if (isPrismaErrorCode(error, 'P2025')) throw new NotFoundException('赛事不存在或已下架');
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
    const registrationView = {
      id: registration.id,
      isCaptain: registration.captainId === actor.sub,
      name: registration.name,
      playerAName: registration.playerAName,
      playerBName: registration.playerBName,
      category: registration.category,
      status: registration.status,
      paymentDueAt: registration.paymentDueAt,
      waitlistedAt: registration.waitlistedAt,
      promotedAt: registration.promotedAt,
      cancellationPending: registration.cancellationPending,
      cancelReason: registration.cancelReason,
      cancelRequestedAt: registration.cancelRequestedAt,
      cancellationResolvedAt: registration.cancellationResolvedAt,
      cancelledAt: registration.cancelledAt,
      checkedInAt: registration.checkedInAt,
      points: registration.points,
      wins: registration.wins,
      losses: registration.losses,
      scoreDiff: registration.scoreDiff,
      finalRank: registration.finalRank,
      eventPointsAwarded: registration.eventPointsAwarded,
      order: registration.order ? orderResponse(registration.order) : null,
    };
    if (registration.status !== RegistrationStatus.WAITLISTED) {
      return { registration: registrationView, waitlistPosition: null };
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
    return { registration: registrationView, waitlistPosition: ahead + 1 };
  }

  async listPrizeAwards(eventId: string) {
    return listPrizeAwards(this.prisma, eventId);
  }

  async issuePrize(eventId: string, dto: IssueEventPrizeDto, actor: AuthUser) {
    return issuePrize(this.prisma, eventId, dto, actor);
  }

  async receivePrize(
    eventId: string,
    awardId: string,
    dto: ReceiveEventPrizeDto,
    actor: AuthUser,
  ) {
    return receivePrize(this.prisma, eventId, awardId, dto, actor);
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

  async register(eventId: string, dto: RegisterEventTeamDto, actor: AuthUser) {
    const canAssist = actor.roles.some((role) => ASSISTED_EVENT_REGISTRATION_ROLES.includes(role));
    const memberSelfService = !canAssist || Boolean(dto.registrationMode);
    if (memberSelfService && !actor.roles.includes(AppRole.MEMBER))
      throw new ForbiddenException('请使用会员身份提交报名');
    const manual = dto.registrationMode === 'MANUAL';
    const captainPlays = manual ? dto.captainPlays !== false : true;
    const partnerInviteCode = normaliseOptionalText(dto.partnerInviteCode);
    let playerAPhone = normalizeParticipantPhone(dto.playerAPhone);
    let playerBPhone = normalizeParticipantPhone(dto.playerBPhone);
    let playerAName = normaliseText(dto.playerAName);
    let playerBName = normaliseText(dto.playerBName);
    const teamName = normaliseText(dto.name);
    if (!teamName) throw new BadRequestException('队伍名称不能为空');
    let playerAUserId = normaliseOptionalText(dto.playerAUserId);
    let playerBUserId = normaliseOptionalText(dto.playerBUserId);
    if (memberSelfService) {
      if (!manual && !partnerInviteCode) {
        throw new BadRequestException('会员报名必须填写搭档本人生成的授权码');
      }
      if (manual && partnerInviteCode)
        throw new BadRequestException('代填报名与搭档邀请不能同时提交');
      if (playerAUserId && playerAUserId !== actor.sub) {
        throw new ForbiddenException('会员报名不能替其他账号占用队长席位');
      }
      if (playerBUserId) {
        throw new ForbiddenException('会员报名不能直接指定搭档账号');
      }
      if (manual) {
        if (dto.consent !== true)
          throw new BadRequestException('请确认已征得两位参赛者同意');
        this.assertSignupContact(playerAName, playerAPhone);
        this.assertSignupContact(playerBName, playerBPhone);
        if (playerAPhone === playerBPhone)
          throw new BadRequestException('两位选手不能使用相同的联系电话');
      } else {
        playerAName = normaliseText(actor.displayName);
        playerBName = '';
        playerAPhone = '';
        playerBPhone = '';
      }
      playerAUserId = captainPlays ? actor.sub : undefined;
      playerBUserId = undefined;
    } else {
      assertFixedDoubles(
        {
          playerAName,
          playerBName,
          playerAUserId,
          playerBUserId,
        },
        'create',
      );
    }
    const sourceChannel = dto.sourceChannel ?? SourceChannel.MINI_PROGRAM;
    const creationIdempotencyKey = normaliseOptionalText(
      dto.creationIdempotencyKey,
    );
    if (creationIdempotencyKey) {
      if (creationIdempotencyKey.startsWith('SYSTEM:')) throw new BadRequestException('此幂等键前缀仅供系统使用');
      assertCommandKey(creationIdempotencyKey, '赛事报名幂等键');
    }
    const commandHash = orderCreationCommandHash({
      kind: 'EVENT_REGISTRATION',
      eventId,
      name: teamName,
      playerAName: memberSelfService && !manual ? null : playerAName,
      playerBName: memberSelfService && !manual ? null : playerBName,
      playerAUserId: playerAUserId ?? null,
      playerBUserId: playerBUserId ?? null,
      category: dto.category,
      sourceChannel,
      ...(manual
        ? {
            registrationMode: 'MANUAL',
            captainPlays,
            playerAPhone,
            playerBPhone,
            consent: true,
          }
        : {}),
      ...(memberSelfService && !manual
        ? {
            partnerInviteTokenHash: eventPartnerInviteHash(partnerInviteCode!),
          }
        : {}),
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
    if (existingReplay) return eventRegistrationResponse(existingReplay);

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
    assertEventConfiguration(preflightEvent);
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
      const result = await this.prisma.$transaction(
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
          assertEventConfiguration(event);
          const now = new Date();
          if (now >= event.registrationEndsAt || now >= event.startsAt) {
            throw new ConflictException('赛事报名已截止');
          }
          let resolvedPlayerAName = playerAName;
          let resolvedPlayerBName = playerBName;
          let resolvedPlayerAUserId = playerAUserId;
          let resolvedPlayerBUserId = playerBUserId;
          let partnerInviteId: string | undefined;
          if (memberSelfService && !manual) {
            const partnerInvite = await this.resolvePartnerInvite(
              tx,
              eventId,
              partnerInviteCode!,
              actor,
              now,
            );
            if (
              partnerInvite.captainId &&
              (partnerInvite.teamName !== teamName ||
                partnerInvite.category !== dto.category)
            )
              throw new ConflictException(
                '邀请中的队名或组别与提交不一致，请重新发起邀请',
              );
            resolvedPlayerAName =
              partnerInvite.playerAName || normaliseText(actor.displayName);
            resolvedPlayerBName = normaliseText(
              partnerInvite.playerBName || partnerInvite.partner!.displayName,
            );
            resolvedPlayerAUserId = actor.sub;
            resolvedPlayerBUserId = partnerInvite.partnerId!;
            playerAPhone = partnerInvite.playerAPhone || '';
            playerBPhone = partnerInvite.playerBPhone || '';
            partnerInviteId = partnerInvite.id;
          }
          assertFixedDoubles(
            {
              playerAName: resolvedPlayerAName,
              playerBName: resolvedPlayerBName,
              playerAUserId: resolvedPlayerAUserId,
              playerBUserId: resolvedPlayerBUserId,
              playerAPhone,
              playerBPhone,
            },
            'create',
          );
          const consumePartnerInvite = async (teamId: string) => {
            if (!partnerInviteId) {
              // Switching to manual signup supersedes outstanding share cards.
              // Revoke in the same transaction as the seat/order creation.
              if (manual)
                await tx.eventPartnerInvite.updateMany({
                  where: {
                    eventId,
                    captainId: actor.sub,
                    consumedAt: null,
                    revokedAt: null,
                  },
                  data: { revokedAt: now },
                });
              return;
            }
            const claimed = await tx.eventPartnerInvite.updateMany({
              where: {
                id: partnerInviteId,
                revokedAt: null,
                consumedAt: null,
                expiresAt: { gt: now },
              },
              data: { consumedAt: now, consumedTeamId: teamId },
            });
            if (claimed.count !== 1) {
              throw new ConflictException(
                '搭档授权码已被其他报名使用，请刷新后重试',
              );
            }
          };
          const profile = tx.memberProfile?.findUnique
            ? await tx.memberProfile.findUnique({
                where: { userId: actor.sub },
              })
            : preflightProfile;
          const eligibility = membershipEligibility(profile, now);
          const feeCents =
            eligibility.eligible &&
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

          const knownPlayerIds = [
            resolvedPlayerAUserId,
            resolvedPlayerBUserId,
          ].filter((value): value is string => Boolean(value));
          await this.assertPhoneAvailable(
            tx,
            eventId,
            [playerAPhone, playerBPhone],
            knownPlayerIds,
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
                  { captainId: userId },
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
            playerAName: resolvedPlayerAName,
            playerBName: resolvedPlayerBName,
            playerAUserId:
              resolvedPlayerAUserId ?? (captainPlays ? actor.sub : null),
            playerBUserId: resolvedPlayerBUserId ?? null,
            ...(manual || playerAPhone || playerBPhone
              ? {
                  playerAPhone: playerAPhone || null,
                  playerBPhone: playerBPhone || null,
                  captainPlays,
                  registrationMode: manual ? 'MANUAL' : 'INVITE',
                }
              : {}),
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
            await consumePartnerInvite(registration.id);
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
                  membershipEligibility: eligibility,
                  teamName,
                  ...(manual
                    ? {
                        registrationMode: 'MANUAL',
                        captainPlays,
                        participantConsent: true,
                      }
                    : {}),
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
          const operatingShare = await resolveOperatingShareSnapshot(
            tx,
            BusinessType.EVENT,
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
                membershipEligibility: eligibility,
                rules: event.rules,
                paymentDueAt: paymentDueAt.toISOString(),
                operatingShare,
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
          if (!created.eventTeam?.id) {
            throw new ConflictException('赛事报名队伍创建失败');
          }
          await consumePartnerInvite(created.eventTeam.id);
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
                ...(manual
                  ? {
                      registrationMode: 'MANUAL',
                      captainPlays,
                      participantConsent: true,
                    }
                  : {}),
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
      return eventRegistrationResponse(result);
    } catch (error) {
      if (creationIdempotencyKey && isPrismaErrorCode(error, 'P2002')) {
        const concurrent = await replay();
        if (concurrent) return eventRegistrationResponse(concurrent);
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
    assertCommandKey(idempotencyKey, '参赛退出幂等键');
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

          const zeroAmountOrder = team.status === RegistrationStatus.PAID &&
            isZeroAmountConfirmedActivityOrder(team.order);
          if (
            team.status === RegistrationStatus.WAITLISTED ||
            team.status === RegistrationStatus.REGISTERED || zeroAmountOrder
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
              if (zeroAmountOrder) {
                await cancelZeroAmountActivityOrder(tx, team.order, actor, reason, now);
              } else {
                const cancelled = await transitionOrder(tx, 'CANCEL_UNPAID', {
                  where: { id: team.order.id, status: OrderStatus.PENDING },
                  data: { status: OrderStatus.CANCELLED, cancelledAt: now },
                });
                if (cancelled.count !== 1) {
                  throw new ConflictException(
                    '待支付订单状态已变化，请刷新后重试',
                  );
                }
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
          const orderChanged = await transitionOrder(tx, 'REQUEST_REFUND', {
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
    assertEventManager(actor);
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
    assertEventManager(actor);
    const reason = normaliseText(dto.reason);
    const idempotencyKey = normaliseText(dto.idempotencyKey);
    if (reason.length < 2) throw new BadRequestException('取消原因至少2个字符');
    assertCommandKey(idempotencyKey, '赛事取消幂等键');
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
      return eventCancellationResponse({ event: existing, idempotent: true });
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
              return eventCancellationResponse({
                event: current,
                idempotent: true,
              });
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
            const pending = activeRefunds.reduce(
              (sum, refund) => sum + refund.amountCents,
              0,
            );
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
              throw new ConflictException('赛事退款缺少可恢复的原订单状态证据');
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
              const cancelled = await transitionOrder(tx, 'CANCEL_UNPAID', {
                where: { id: team.order.id, status: OrderStatus.PENDING },
                data: { status: OrderStatus.CANCELLED, cancelledAt: now },
              });
              if (cancelled.count !== 1) throw new ConflictException('待支付订单状态已变化，请重试取消');
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
            if (isZeroAmountConfirmedActivityOrder(team.order)) {
              await cancelZeroAmountActivityOrder(tx, team.order, actor, reason, now);
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
            // A whole-activity cancellation can top up an existing refund request.
            // Its order is already pending review; only new review states transition.
            if (plan.order.status !== OrderStatus.REFUND_PENDING) {
              await requireOrderTransition(tx, 'REQUEST_REFUND', {
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
            }
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
          return eventCancellationResponse({
            event,
            cancelledPendingOrders,
            cancelledWaitlist,
            refundRequests,
          });
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
    return stateTransition(this.prisma, async (tx) => {
      const team = await tx.eventTeam.findFirst({
        where: { id: teamId, eventId },
        include: {
          event: { select: { startsAt: true } },
          order: { select: { id: true, status: true } },
        },
      });
      if (!team) throw new NotFoundException('参赛组合不存在');
      assertFixedDoubles(team);
      if (
        ![RegistrationStatus.PAID, RegistrationStatus.CHECKED_IN].includes(
          team.status as never,
        )
      ) {
        throw new ConflictException('参赛报名尚未支付');
      }
      if (
        team.cancellationPending ||
        team.order?.status === OrderStatus.REFUND_PENDING
      ) {
        throw new ConflictException('该报名正在等待退款审批，暂不可签到');
      }
      if (team.order && [OrderStatus.REFUNDED, OrderStatus.CANCELLED].includes(team.order.status as never)) {
        throw new ConflictException('该报名已退款或取消，不能签到');
      }
      await lockAdmissionOrder(tx, team.order?.id);
      if (team.status === RegistrationStatus.CHECKED_IN)
        return eventTeamCommandResponse(team);
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
        where: {
          id: teamId, status: RegistrationStatus.PAID,
          AND: [{ orderId: team.orderId }], cancellationPending: false,
        },
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
      return eventTeamCommandResponse(updated);
    });
  }

  async startNextRound(eventId: string, actor: AuthUser) {
    return startNextRound(this.prisma, eventId, actor);
  }

  async correctPairings(
    eventId: string,
    round: number,
    dto: CorrectEventPairingsDto,
    actor: AuthUser,
  ) {
    return correctPairings(this.prisma, eventId, round, dto, actor);
  }

  async submitScore(matchId: string, dto: SubmitScoreDto, actor: AuthUser) {
    return submitScore(this.prisma, matchId, dto, actor);
  }

  async correctScore(matchId: string, dto: CorrectScoreDto, actor: AuthUser) {
    return correctScore(this.prisma, matchId, dto, actor);
  }

  async finish(eventId: string, actor: AuthUser) {
    return finish(this.prisma, eventId, actor);
  }
}
