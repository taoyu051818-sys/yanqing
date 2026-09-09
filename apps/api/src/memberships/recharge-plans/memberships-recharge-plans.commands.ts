import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import type { AuthUser } from '../../common/auth/auth-user.js';
import { PrismaService } from '../../database/prisma.service.js';
import { AppRole, Prisma } from '../../generated/prisma/client.js';
import type {
  CreateRechargePlanDto,
  SetRechargePlanStatusDto,
} from '../memberships.dto.js';
import {
  commandHash,
  isRetryableWriteConflict,
  rechargePlanView,
  rechargePlanTransitionView,
} from '../shared/memberships-support.js';

export function rechargePlans(prisma: PrismaService) {
  const now = new Date();
  return prisma.rechargePlan.findMany({
    where: {
      enabled: true,
      effectiveFrom: { lte: now },
      OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }],
    },
    select: {
      id: true,
      code: true,
      version: true,
      name: true,
      principalCents: true,
      giftCents: true,
      effectiveFrom: true,
      effectiveTo: true,
      enabled: true,
    },
    orderBy: [{ principalCents: 'asc' }, { version: 'desc' }],
  });
}

export function manageRechargePlans(prisma: PrismaService, actor: AuthUser) {
  assertRechargePlanAdministrator(actor);
  return prisma.rechargePlan.findMany({
    select: {
      id: true,
      code: true,
      version: true,
      name: true,
      principalCents: true,
      giftCents: true,
      effectiveFrom: true,
      effectiveTo: true,
      enabled: true,
      createdAt: true,
      updatedAt: true,
      createdBy: { select: { id: true, displayName: true } },
      transitions: {
        select: {
          id: true,
          oldEnabled: true,
          newEnabled: true,
          reason: true,
          createdAt: true,
          actor: { select: { id: true, displayName: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 20,
      },
    },
    orderBy: [{ code: 'asc' }, { version: 'desc' }],
  });
}

export async function createRechargePlan(
  prisma: PrismaService,
  dto: CreateRechargePlanDto,
  actor: AuthUser,
) {
  assertRechargePlanAdministrator(actor);
  const effectiveFrom = new Date(dto.effectiveFrom);
  const effectiveTo = dto.effectiveTo ? new Date(dto.effectiveTo) : null;
  if (effectiveTo && effectiveTo <= effectiveFrom)
    throw new BadRequestException('充值计划失效时间必须晚于生效时间');
  if (dto.giftCents > dto.principalCents)
    throw new BadRequestException('赠送金额不得超过充值本金');
  const reason = dto.reason.trim();
  const command = {
    code: dto.code,
    name: dto.name.trim(),
    principalCents: dto.principalCents,
    giftCents: dto.giftCents,
    effectiveFrom: effectiveFrom.toISOString(),
    effectiveTo: effectiveTo?.toISOString() ?? null,
    reason,
  };
  const hash = commandHash(command);

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await prisma.$transaction(
        async (tx) => {
          const existing = await tx.rechargePlan.findUnique({
            where: { creationIdempotencyKey: dto.idempotencyKey },
          });
          if (existing) {
            assertRechargePlanCreationReplay(existing, actor, hash);
            return rechargePlanView(existing);
          }
          const latest = await tx.rechargePlan.aggregate({
            where: { code: dto.code },
            _max: { version: true },
          });
          const created = await tx.rechargePlan.create({
            data: {
              code: dto.code,
              version: (latest._max.version ?? 0) + 1,
              name: command.name,
              principalCents: dto.principalCents,
              giftCents: dto.giftCents,
              effectiveFrom,
              effectiveTo,
              enabled: false,
              creationIdempotencyKey: dto.idempotencyKey,
              creationCommandHash: hash,
              createdById: actor.sub,
            },
          });
          await tx.auditLog.create({
            data: {
              actorId: actor.sub,
              actorRole: actor.roles[0],
              action: 'RECHARGE_PLAN_VERSION_CREATED',
              objectType: 'RechargePlan',
              objectId: created.id,
              reason,
              newValue: {
                code: created.code,
                version: created.version,
                name: created.name,
                principalCents: created.principalCents,
                giftCents: created.giftCents,
                effectiveFrom: created.effectiveFrom.toISOString(),
                effectiveTo: created.effectiveTo?.toISOString() ?? null,
                enabled: false,
              } as never,
            },
          });
          return rechargePlanView(created);
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (!isRetryableWriteConflict(error)) throw error;
      const existing = await prisma.rechargePlan.findUnique({
        where: { creationIdempotencyKey: dto.idempotencyKey },
      });
      if (existing) {
        assertRechargePlanCreationReplay(existing, actor, hash);
        return rechargePlanView(existing);
      }
      if (attempt === 3)
        throw new ConflictException('充值计划版本发生并发冲突，请刷新后重试');
    }
  }
  throw new ConflictException('充值计划版本发生并发冲突，请刷新后重试');
}

export async function setRechargePlanStatus(
  prisma: PrismaService,
  planId: string,
  dto: SetRechargePlanStatusDto,
  actor: AuthUser,
) {
  assertRechargePlanAdministrator(actor);
  const reason = dto.reason.trim();
  const hash = commandHash({ planId, enabled: dto.enabled, reason });

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await prisma.$transaction(
        async (tx) => {
          const existing = await tx.rechargePlanTransition.findUnique({
            where: { idempotencyKey: dto.idempotencyKey },
            include: { plan: true },
          });
          if (existing) {
            assertRechargePlanTransitionReplay(existing, planId, actor, hash);
            return {
              ...rechargePlanView(existing.plan),
              enabled: existing.newEnabled,
              transition: rechargePlanTransitionView(existing),
              idempotent: true,
            };
          }
          const plan = await tx.rechargePlan.findUnique({
            where: { id: planId },
          });
          if (!plan) throw new NotFoundException('充值计划不存在');
          if (plan.enabled === dto.enabled)
            throw new ConflictException(
              dto.enabled ? '充值计划已启用' : '充值计划已停用',
            );

          if (dto.enabled) {
            const overlapping = await tx.rechargePlan.findFirst({
              where: {
                id: { not: plan.id },
                code: plan.code,
                enabled: true,
                ...(plan.effectiveTo
                  ? { effectiveFrom: { lt: plan.effectiveTo } }
                  : {}),
                OR: [
                  { effectiveTo: null },
                  { effectiveTo: { gt: plan.effectiveFrom } },
                ],
              },
              select: { id: true, version: true },
            });
            if (overlapping) {
              throw new ConflictException(
                `同编码 v${overlapping.version} 的有效期与当前版本重叠，请先调整版本有效期`,
              );
            }
          } else {
            const now = new Date();
            const activeNow =
              plan.effectiveFrom <= now &&
              (!plan.effectiveTo || plan.effectiveTo > now);
            if (activeNow) {
              const alternativeCount = await tx.rechargePlan.count({
                where: {
                  id: { not: plan.id },
                  enabled: true,
                  effectiveFrom: { lte: now },
                  OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }],
                },
              });
              if (alternativeCount < 1) {
                throw new ConflictException(
                  '不能停用最后一个当前有效充值计划，请先启用替代计划',
                );
              }
            }
          }

          const changed = await tx.rechargePlan.updateMany({
            where: { id: plan.id, enabled: plan.enabled },
            data: { enabled: dto.enabled },
          });
          if (changed.count !== 1)
            throw new ConflictException('充值计划状态已变化，请刷新后重试');
          const transition = await tx.rechargePlanTransition.create({
            data: {
              planId: plan.id,
              oldEnabled: plan.enabled,
              newEnabled: dto.enabled,
              reason,
              actorId: actor.sub,
              idempotencyKey: dto.idempotencyKey,
              commandHash: hash,
            },
          });
          await tx.auditLog.create({
            data: {
              actorId: actor.sub,
              actorRole: actor.roles[0],
              action: 'RECHARGE_PLAN_STATUS_SET',
              objectType: 'RechargePlan',
              objectId: plan.id,
              reason,
              oldValue: { enabled: plan.enabled } as never,
              newValue: {
                enabled: dto.enabled,
                version: plan.version,
              } as never,
            },
          });
          return {
            ...rechargePlanView(plan),
            enabled: dto.enabled,
            transition: rechargePlanTransitionView(transition),
            idempotent: false,
          };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (!isRetryableWriteConflict(error)) throw error;
      const existing = await prisma.rechargePlanTransition.findUnique({
        where: { idempotencyKey: dto.idempotencyKey },
        include: { plan: true },
      });
      if (existing) {
        assertRechargePlanTransitionReplay(existing, planId, actor, hash);
        return {
          ...rechargePlanView(existing.plan),
          enabled: existing.newEnabled,
          transition: rechargePlanTransitionView(existing),
          idempotent: true,
        };
      }
      if (attempt === 3)
        throw new ConflictException('充值计划状态发生并发冲突，请刷新后重试');
    }
  }
  throw new ConflictException('充值计划状态发生并发冲突，请刷新后重试');
}

export function assertRechargePlanAdministrator(actor: AuthUser) {
  if (
    !actor.roles.some((role) =>
      [AppRole.ADMIN, AppRole.SUPER_ADMIN].includes(role as never),
    )
  )
    throw new ForbiddenException('仅管理员可管理充值计划');
}

export function assertRechargePlanCreationReplay(
  existing: { createdById: string; creationCommandHash: string },
  actor: AuthUser,
  hash: string,
) {
  if (
    existing.createdById !== actor.sub ||
    existing.creationCommandHash !== hash
  )
    throw new ConflictException('充值计划创建幂等键已用于其他命令或操作人');
}

export function assertRechargePlanTransitionReplay(
  existing: { planId: string; actorId: string; commandHash: string },
  planId: string,
  actor: AuthUser,
  hash: string,
) {
  if (
    existing.planId !== planId ||
    existing.actorId !== actor.sub ||
    existing.commandHash !== hash
  ) {
    throw new ConflictException('充值计划状态幂等键已用于其他命令或操作人');
  }
}
