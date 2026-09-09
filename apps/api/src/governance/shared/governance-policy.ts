import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import type { AuthUser } from '../../common/auth/auth-user.js';
import { AppRole, Prisma } from '../../generated/prisma/client.js';
import { GovernanceCommandReplay } from './governance-support.js';

export function writeGovernanceAudit(
  client: Pick<Prisma.TransactionClient, 'auditLog'>,
  input: {
    actor: AuthUser;
    actorRole?: AppRole;
    action: string;
    objectType: string;
    objectId: string;
    oldValue: unknown;
    newValue: unknown;
    reason: string;
    requestId?: string;
  },
) {
  return client.auditLog.create({
    data: {
      actorId: input.actor.sub,
      actorRole:
        input.actorRole ??
        input.actor.roles.find((role) => role === AppRole.SUPER_ADMIN) ??
        input.actor.roles[0],
      action: input.action,
      objectType: input.objectType,
      objectId: input.objectId,
      oldValue: input.oldValue as never,
      newValue: input.newValue as never,
      reason: input.reason,
      requestId: input.requestId,
    },
  });
}

export function findGovernanceCommandReplay(
  client: Pick<Prisma.TransactionClient, 'auditLog'>,
  requestId?: string,
): Promise<GovernanceCommandReplay | null> {
  if (!requestId) return Promise.resolve(null);
  return client.auditLog.findFirst({
    where: { requestId },
    select: {
      actorId: true,
      action: true,
      objectType: true,
      objectId: true,
      newValue: true,
    },
    orderBy: { createdAt: 'asc' },
  });
}

export function assertGovernanceCommandReplay(
  replay: GovernanceCommandReplay,
  expected: {
    actor: AuthUser;
    action: string;
    objectType: string;
    objectId: string;
    commandHash: string;
  },
) {
  const payload =
    replay.newValue &&
    typeof replay.newValue === 'object' &&
    !Array.isArray(replay.newValue)
      ? (replay.newValue as Record<string, unknown>)
      : null;
  if (
    replay.actorId !== expected.actor.sub ||
    replay.action !== expected.action ||
    replay.objectType !== expected.objectType ||
    replay.objectId !== expected.objectId ||
    payload?.commandHash !== expected.commandHash
  ) {
    throw new ConflictException('治理操作幂等键已用于不同命令');
  }
}

export function normalizedReason(reason: string, message: string) {
  const normalized = reason?.trim();
  if (!normalized || normalized.length < 2)
    throw new BadRequestException(message);
  return normalized;
}

export function normalizedIdempotencyKey(value?: string) {
  if (value === undefined) return undefined;
  const normalized = value.trim();
  if (normalized.length < 8 || normalized.length > 100) {
    throw new BadRequestException('幂等键长度必须为 8 至 100 个字符');
  }
  return normalized;
}

export function assertRoles(
  actor: AuthUser,
  allowed: AppRole[],
  message: string,
) {
  if (!actor.roles.some((role) => allowed.includes(role)))
    throw new ForbiddenException(message);
}
