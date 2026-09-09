import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { validateDirectReferral } from '@yanqing/shared';
import type { AuthUser } from '../../common/auth/auth-user.js';
import { PrismaService } from '../../database/prisma.service.js';
import { AppRole, Prisma, UserStatus } from '../../generated/prisma/client.js';
import type { BindReferralDto } from '../members.dto.js';
import { referralInviteTokenHash } from '../shared/members-support.js';

export async function bindReferral(
  prisma: PrismaService,
  dto: BindReferralDto,
  actor: AuthUser,
) {
  const userId = actor.sub;
  const inviteCode = dto.inviteCode.trim();
  const inviteHash = referralInviteTokenHash(inviteCode);
  const now = new Date();
  // Binding is an immutable, single-write relationship.  Perform the
  // validation and conditional update in one serializable transaction so
  // two first-login requests cannot race and silently choose different
  // direct referrers.  Repeating the same binding remains idempotent.
  try {
    return await prisma.$transaction(
      async (tx) => {
        const [user, invite] = await Promise.all([
          tx.user.findUnique({
            where: { id: userId },
            select: {
              id: true,
              referrerId: true,
              status: true,
              deletedAt: true,
              memberProfile: { select: { id: true } },
            },
          }),
          tx.referralInvite.findUnique({
            where: { tokenHash: inviteHash },
            select: {
              id: true,
              expiresAt: true,
              revokedAt: true,
              inviter: {
                select: {
                  id: true,
                  referrerId: true,
                  status: true,
                  deletedAt: true,
                  memberProfile: { select: { id: true } },
                },
              },
            },
          }),
        ]);
        if (
          !user ||
          user.status !== UserStatus.ACTIVE ||
          user.deletedAt ||
          !user.memberProfile
        ) {
          throw new NotFoundException('会员不存在或已停用');
        }
        if (!invite || invite.revokedAt || invite.expiresAt <= now) {
          throw new BadRequestException('邀请码无效或已过期');
        }
        const referrer = invite.inviter;
        if (
          !referrer ||
          referrer.status !== UserStatus.ACTIVE ||
          referrer.deletedAt ||
          !referrer.memberProfile
        ) {
          throw new NotFoundException('推荐人不存在或已停用');
        }
        try {
          validateDirectReferral({
            userId,
            requestedReferrerId: referrer.id,
            existingReferrerId: user.referrerId,
          });
        } catch (error) {
          throw new BadRequestException(
            error instanceof Error ? error.message : '推荐关系无效',
          );
        }
        await assertReferralAcyclic(tx, userId, referrer);

        const changed = await tx.user.updateMany({
          where: {
            id: userId,
            referrerId: null,
            status: UserStatus.ACTIVE,
            deletedAt: null,
          },
          data: { referrerId: referrer.id },
        });
        if (changed.count === 1) {
          await tx.referralInvite.update({
            where: { id: invite.id },
            data: {
              useCount: { increment: 1 },
              lastUsedAt: now,
            },
          });
          await tx.auditLog.create({
            data: {
              actorId: userId,
              actorRole:
                actor.roles.find((role) => role === AppRole.MEMBER) ??
                actor.roles[0],
              action: 'DIRECT_REFERRAL_BOUND',
              objectType: 'User',
              objectId: userId,
              oldValue: { referrerId: null } as never,
              newValue: {
                referrerId: referrer.id,
                referralInviteId: invite.id,
              } as never,
              reason: '会员本人确认一层直接推荐关系',
            },
          });
          return { bound: true };
        }

        // A concurrent request may have won the conditional write.  Return
        // success only when it chose the same referrer; a different choice is
        // an immutable-binding conflict and must be visible to the caller.
        const latest = await tx.user.findUnique({
          where: { id: userId },
          select: { id: true, referrerId: true },
        });
        if (latest?.referrerId === referrer.id) return { bound: true };
        throw new ConflictException('直接推荐人已绑定，不能更换');
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  } catch (error) {
    if (!isPrismaErrorCode(error, 'P2034')) throw error;
    const [invite, latest] = await Promise.all([
      prisma.referralInvite.findUnique({
        where: { tokenHash: inviteHash },
        select: { inviterId: true, expiresAt: true, revokedAt: true },
      }),
      prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, referrerId: true },
      }),
    ]);
    if (!invite || invite.revokedAt || invite.expiresAt <= now) {
      throw new BadRequestException('邀请码无效或已过期');
    }
    if (latest?.referrerId === invite.inviterId) return { bound: true };
    throw new ConflictException('推荐关系刚刚发生变化，请刷新后重试');
  }
}

export async function assertReferralAcyclic(
  tx: Prisma.TransactionClient,
  userId: string,
  initialReferrer: { id: string; referrerId: string | null },
) {
  const visited = new Set<string>();
  let current: { id: string; referrerId: string | null } | null =
    initialReferrer;
  while (current) {
    if (current.id === userId || visited.has(current.id)) {
      throw new BadRequestException('推荐关系不能形成闭环');
    }
    visited.add(current.id);
    if (!current.referrerId) return;
    current = await tx.user.findUnique({
      where: { id: current.referrerId },
      select: { id: true, referrerId: true },
    });
  }
}

export function isPrismaErrorCode(error: unknown, code: string) {
  return Boolean(
    error &&
    typeof error === 'object' &&
    'code' in error &&
    error.code === code,
  );
}
