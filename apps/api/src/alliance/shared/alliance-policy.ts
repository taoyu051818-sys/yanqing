import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import type { AuthUser } from '../../common/auth/auth-user.js';
import { PrismaService } from '../../database/prisma.service.js';
import { AppRole, Prisma } from '../../generated/prisma/client.js';

export async function assertMerchantAccess(
  prisma: PrismaService,
  merchantId: string,
  actor: AuthUser,
  message = '只能操作本商户的数据',
): Promise<void> {
  if (
    actor.roles.some((role) =>
      [AppRole.ADMIN, AppRole.SUPER_ADMIN].includes(role as never),
    )
  )
    return;
  const role = await prisma.userRole.findFirst({
    where: { userId: actor.sub, role: AppRole.MERCHANT, merchantId },
  });
  if (!role) throw new ForbiddenException(message);
}

export function assertAllianceAdministrator(actor: AuthUser) {
  if (
    !actor.roles.some((role) =>
      [AppRole.ADMIN, AppRole.SUPER_ADMIN].includes(role as never),
    )
  ) {
    throw new ForbiddenException('仅联盟管理员可以变更启停状态');
  }
}

export function allianceAdministratorRole(actor: AuthUser): AppRole {
  return actor.roles.includes(AppRole.SUPER_ADMIN)
    ? AppRole.SUPER_ADMIN
    : AppRole.ADMIN;
}

export function lifecycleReason(value: string): string {
  const reason = value.trim();
  if (reason.length < 2 || reason.length > 300) {
    throw new BadRequestException('状态变更原因需要2-300个字符');
  }
  return reason;
}

export function allianceRequestId(value: string): string {
  const requestId = value.trim();
  if (requestId.length < 8 || requestId.length > 100) {
    throw new BadRequestException('联盟操作幂等键需要8-100个字符');
  }
  return requestId;
}

export function assertAllianceCommandReplay(
  replay: {
    actorId: string | null;
    action: string;
    objectType: string;
    objectId: string | null;
    newValue: Prisma.JsonValue;
  },
  expected: {
    actor: AuthUser;
    action: string;
    objectType: string;
    objectId: string;
    commandHash: string;
  },
) {
  const newValue =
    replay.newValue &&
    typeof replay.newValue === 'object' &&
    !Array.isArray(replay.newValue)
      ? (replay.newValue as Record<string, unknown>)
      : {};
  if (
    replay.actorId !== expected.actor.sub ||
    replay.action !== expected.action ||
    replay.objectType !== expected.objectType ||
    replay.objectId !== expected.objectId ||
    newValue.commandHash !== expected.commandHash
  ) {
    throw new ConflictException('幂等键已用于其他联盟操作');
  }
}
