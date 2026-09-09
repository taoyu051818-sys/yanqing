import { stateTransition } from '../../common/state-transition.js';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import type { AuthUser } from '../../common/auth/auth-user.js';
import { PrismaService } from '../../database/prisma.service.js';
import { AppRole, HostStatus } from '../../generated/prisma/client.js';
import { type RejectHostDto, type ReviewHostDto } from '../games.dto.js';

export async function applyHost(prisma: PrismaService, actor: AuthUser) {
  if (!actor.roles.includes(AppRole.MEMBER)) {
    throw new ForbiddenException('仅会员可申请成为球局主理人');
  }
  return stateTransition(prisma, async (tx) => {
    const existing = await tx.hostProfile.findUnique({
      where: { userId: actor.sub },
    });
    if (existing?.status === HostStatus.APPROVED)
      throw new ConflictException('已经是球局主理人');
    if (existing?.status === HostStatus.APPLIED) return existing;
    const profile = await tx.hostProfile.upsert({
      where: { userId: actor.sub },
      update: {
        status: HostStatus.APPLIED,
        appliedAt: new Date(),
        approvedAt: null,
        suspendedReason: null,
      },
      create: { userId: actor.sub, status: HostStatus.APPLIED },
    });
    await tx.auditLog.create({
      data: {
        actorId: actor.sub,
        actorRole: actor.roles[0],
        action: 'HOST_APPLIED',
        objectType: 'HostProfile',
        objectId: profile.id,
        oldValue: existing ? ({ status: existing.status } as never) : undefined,
        newValue: { status: HostStatus.APPLIED } as never,
      },
    });
    return profile;
  });
}

export function hostApplications(prisma: PrismaService) {
  return prisma.hostProfile.findMany({
    where: { status: HostStatus.APPLIED },
    select: {
      id: true,
      userId: true,
      status: true,
      appliedAt: true,
      user: {
        select: {
          id: true,
          displayName: true,
          phone: true,
          memberProfile: { select: { level: true, visitCount: true } },
        },
      },
    },
    orderBy: { appliedAt: 'asc' },
  });
}

export async function approveHost(
  prisma: PrismaService,
  userId: string,
  dto: ReviewHostDto,
  actor: AuthUser,
) {
  return stateTransition(prisma, async (tx) => {
    const profile = await tx.hostProfile.findUnique({ where: { userId } });
    if (!profile) throw new NotFoundException('主理人申请不存在');
    if (profile.status === HostStatus.APPROVED) return profile;
    if (profile.status !== HostStatus.APPLIED)
      throw new ConflictException('只有待审批申请可以通过');
    const updated = await tx.hostProfile.update({
      where: {
        userId,
        status: HostStatus.APPLIED,
        appliedAt: profile.appliedAt,
      },
      data: {
        status: HostStatus.APPROVED,
        approvedAt: new Date(),
        suspendedReason: null,
      },
    });
    const role = await tx.userRole.findFirst({
      where: { userId, role: AppRole.HOST, merchantId: null },
    });
    if (!role)
      await tx.userRole.create({ data: { userId, role: AppRole.HOST } });
    await tx.auditLog.create({
      data: {
        actorId: actor.sub,
        actorRole: actor.roles[0],
        action: 'HOST_APPROVED',
        objectType: 'HostProfile',
        objectId: profile.id,
        reason: dto.reason,
      },
    });
    return updated;
  });
}

export async function rejectHost(
  prisma: PrismaService,
  userId: string,
  dto: RejectHostDto,
  actor: AuthUser,
) {
  const reason = dto.reason.trim();
  if (reason.length < 2) throw new BadRequestException('驳回原因不能为空');
  return stateTransition(prisma, async (tx) => {
    const profile = await tx.hostProfile.findUnique({ where: { userId } });
    if (!profile) throw new NotFoundException('主理人申请不存在');
    if (
      profile.status === HostStatus.REJECTED &&
      profile.suspendedReason === reason
    )
      return profile;
    if (profile.status !== HostStatus.APPLIED)
      throw new ConflictException('只有待审批申请可以驳回');
    const updated = await tx.hostProfile.update({
      where: {
        userId,
        status: HostStatus.APPLIED,
        appliedAt: profile.appliedAt,
      },
      data: {
        status: HostStatus.REJECTED,
        approvedAt: null,
        suspendedReason: reason,
      },
    });
    await tx.userRole.deleteMany({ where: { userId, role: AppRole.HOST } });
    await tx.auditLog.create({
      data: {
        actorId: actor.sub,
        actorRole: actor.roles[0],
        action: 'HOST_REJECTED',
        objectType: 'HostProfile',
        objectId: profile.id,
        oldValue: { status: profile.status } as never,
        newValue: { status: HostStatus.REJECTED } as never,
        reason,
      },
    });
    return updated;
  });
}
