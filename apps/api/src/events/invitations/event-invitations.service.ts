import {
  isPrismaErrorCode,
  normaliseText,
} from '../shared/event-command-support.js';
import { randomBytes } from 'node:crypto';
import {
  Inject,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { AuthUser } from '../../common/auth/auth-user.js';
import { PrismaService } from '../../database/prisma.service.js';
import {
  AppRole,
  EventStatus,
  Prisma,
  RegistrationStatus,
  UserStatus,
} from '../../generated/prisma/client.js';
import type {
  CreateEventTeamInviteDto,
  AcceptEventTeamInviteDto,
} from '../events.dto.js';
import { normalizeParticipantPhone } from '../events.dto.js';
import {
  assertSignupContact,
  assertPhoneAvailable,
} from '../registration/event-participant-policy.js';
import {
  eventPartnerInviteHash,
  EVENT_PARTNER_INVITE_TTL_MINUTES,
  resolvePartnerInvite,
} from './event-invite-policy.js';

@Injectable()
export class EventInvitationsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

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
    assertSignupContact(playerAName, playerAPhone);
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
          await assertPhoneAvailable(tx, eventId, [playerAPhone], [actor.sub]);
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
    assertSignupContact(name, phone);
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
          await assertPhoneAvailable(
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
    const invite = await resolvePartnerInvite(
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
}
