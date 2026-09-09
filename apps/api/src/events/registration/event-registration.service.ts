import {
  assertEventConfiguration,
  assertFixedDoubles,
} from '../competition/event-competition-policy.js';
import {
  serial,
  isPrismaErrorCode,
  normaliseText,
  normaliseOptionalText,
  assertCommandKey,
} from '../shared/event-command-support.js';
import {
  EVENT_SEAT_STATUSES,
  eventPaymentDueAt,
} from './event-registration-policy.js';
import { membershipEligibility } from '../../memberships/membership-eligibility.js';
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
  BusinessType,
  EventStatus,
  OrderStatus,
  Prisma,
  RegistrationStatus,
  SourceChannel,
  SubjectAccount,
} from '../../generated/prisma/client.js';
import { orderCreationCommandHash } from '../../orders/order-creation-idempotency.js';
import type { RegisterEventTeamDto } from '../events.dto.js';
import { resolveOperatingShareSnapshot } from '../../common/finance/operating-share.js';
import { normalizeParticipantPhone } from '../events.dto.js';
import { eventRegistrationResponse } from '../shared/event-responses.js';
import {
  assertSignupContact,
  assertPhoneAvailable,
} from './event-participant-policy.js';
import {
  eventPartnerInviteHash,
  resolvePartnerInvite,
} from '../invitations/event-invite-policy.js';

const ASSISTED_EVENT_REGISTRATION_ROLES: readonly AppRole[] = [
  AppRole.FRONT_DESK,
  AppRole.EVENT_MANAGER,
  AppRole.ADMIN,
  AppRole.SUPER_ADMIN,
];

@Injectable()
export class EventRegistrationService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async register(eventId: string, dto: RegisterEventTeamDto, actor: AuthUser) {
    const canAssist = actor.roles.some((role) =>
      ASSISTED_EVENT_REGISTRATION_ROLES.includes(role),
    );
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
        assertSignupContact(playerAName, playerAPhone);
        assertSignupContact(playerBName, playerBPhone);
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
      if (creationIdempotencyKey.startsWith('SYSTEM:'))
        throw new BadRequestException('此幂等键前缀仅供系统使用');
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
            const partnerInvite = await resolvePartnerInvite(
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
            eligibility.eligible && event.memberFeeCents !== null
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
          await assertPhoneAvailable(
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
}
