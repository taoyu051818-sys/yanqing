import { createHash } from 'node:crypto';
import { ConflictException, ForbiddenException } from '@nestjs/common';
import type { AuthUser } from '../../common/auth/auth-user.js';
import {
  Prisma,
  RegistrationStatus,
  UserStatus,
} from '../../generated/prisma/client.js';

export const eventPartnerInviteHash = (value: string): string =>
  createHash('sha256').update(value).digest('hex');

export const EVENT_PARTNER_INVITE_TTL_MINUTES = 15;

export async function resolvePartnerInvite(
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
