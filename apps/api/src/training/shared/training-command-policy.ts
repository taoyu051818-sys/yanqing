import { randomBytes } from 'node:crypto';
import { ConflictException } from '@nestjs/common';
import type { AuthUser } from '../../common/auth/auth-user.js';
import { Prisma } from '../../generated/prisma/client.js';

export const serial = (prefix: string) =>
  `${prefix}${new Date().toISOString().replace(/\D/g, '').slice(0, 14)}${randomBytes(3).toString('hex').toUpperCase()}`;

export function findTrainingCommandReplay(
  client: Pick<Prisma.TransactionClient, 'auditLog'>,
  requestId?: string,
) {
  if (!requestId) return Promise.resolve(null);
  return client.auditLog.findFirst({
    where: {
      requestId,
      action: { startsWith: 'TRAINING_' },
    },
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

export function assertTrainingCommandReplay(
  replay: {
    actorId: string | null;
    action: string;
    objectType: string;
    objectId: string | null;
    newValue: unknown;
  },
  expected: {
    actor: AuthUser;
    action: string;
    objectType: string;
    objectId?: string;
    commandHash: string;
  },
): string {
  const payload =
    replay.newValue !== null &&
    typeof replay.newValue === 'object' &&
    !Array.isArray(replay.newValue)
      ? (replay.newValue as Record<string, unknown>)
      : null;
  if (
    replay.actorId !== expected.actor.sub ||
    replay.action !== expected.action ||
    replay.objectType !== expected.objectType ||
    (expected.objectId !== undefined &&
      replay.objectId !== expected.objectId) ||
    payload?.commandHash !== expected.commandHash
  ) {
    throw new ConflictException('培训操作幂等键已用于不同命令');
  }
  if (!replay.objectId) {
    throw new ConflictException('培训操作幂等记录缺少业务对象');
  }
  return replay.objectId;
}
