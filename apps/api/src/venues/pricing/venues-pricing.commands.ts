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
  CreatePriceRuleDto,
  CreatePriceRuleVersionDto,
  SetPriceRuleStatusDto,
  UpdateCourtDto,
} from '../venues.dto.js';
import { orderCreationCommandHash } from '../../orders/order-creation-idempotency.js';
import {
  PRICE_RULE_READ_ROLES,
  PRICE_RULE_WRITE_ROLES,
  isRetryableMasterDataConflict,
  priceRuleView,
  priceRuleTransitionView,
} from '../shared/venues-support.js';

export function updateCourt(
  prisma: PrismaService,
  id: string,
  dto: UpdateCourtDto,
  actor: AuthUser,
) {
  return prisma.$transaction(async (tx) => {
    const before = await tx.court.findUniqueOrThrow({ where: { id } });
    const after = await tx.court.update({ where: { id }, data: dto });
    await tx.auditLog.create({
      data: {
        actorId: actor.sub,
        actorRole: actor.roles[0],
        action: 'COURT_UPDATED',
        objectType: 'Court',
        objectId: id,
        oldValue: before as never,
        newValue: after as never,
      },
    });
    return after;
  });
}

export function listTimeSlots(prisma: PrismaService, actor: AuthUser) {
  assertPriceRuleRole(
    actor,
    PRICE_RULE_READ_ROLES,
    '仅前台或管理员可查看计价时段',
  );
  return prisma.timeSlot.findMany({
    select: {
      id: true,
      code: true,
      label: true,
      startMinutes: true,
      endMinutes: true,
      period: true,
      enabled: true,
      sortOrder: true,
    },
    orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }],
  });
}

export function listPriceRules(prisma: PrismaService, actor: AuthUser) {
  assertPriceRuleRole(
    actor,
    PRICE_RULE_READ_ROLES,
    '仅前台或管理员可查看价格规则',
  );
  return prisma.priceRule.findMany({
    select: {
      id: true,
      code: true,
      version: true,
      name: true,
      timeSlotId: true,
      weekdayMask: true,
      priceCents: true,
      newcomerPriceCents: true,
      effectiveFrom: true,
      effectiveTo: true,
      enabled: true,
      createdAt: true,
      updatedAt: true,
      timeSlot: {
        select: {
          id: true,
          code: true,
          label: true,
          startMinutes: true,
          endMinutes: true,
          period: true,
          enabled: true,
        },
      },
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

export function createPriceRule(
  prisma: PrismaService,
  dto: CreatePriceRuleDto,
  actor: AuthUser,
) {
  return createPriceRuleVersionRecord(prisma, dto.code, null, dto, actor);
}

export async function createPriceRuleVersion(
  prisma: PrismaService,
  sourceRuleId: string,
  dto: CreatePriceRuleVersionDto,
  actor: AuthUser,
) {
  assertPriceRuleRole(actor, PRICE_RULE_WRITE_ROLES, '仅管理员可管理价格规则');
  const source = await prisma.priceRule.findUnique({
    where: { id: sourceRuleId },
    select: { code: true },
  });
  if (!source) throw new NotFoundException('价格规则源版本不存在');
  return createPriceRuleVersionRecord(
    prisma,
    source.code,
    sourceRuleId,
    dto,
    actor,
  );
}

export async function setPriceRuleStatus(
  prisma: PrismaService,
  priceRuleId: string,
  dto: SetPriceRuleStatusDto,
  actor: AuthUser,
) {
  assertPriceRuleRole(actor, PRICE_RULE_WRITE_ROLES, '仅管理员可管理价格规则');
  const reason = dto.reason.trim();
  const hash = orderCreationCommandHash({
    priceRuleId,
    enabled: dto.enabled,
    reason,
  });

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await prisma.$transaction(
        async (tx) => {
          const replay = await tx.priceRuleTransition.findUnique({
            where: { idempotencyKey: dto.idempotencyKey },
            include: { priceRule: true },
          });
          if (replay) {
            assertPriceRuleTransitionReplay(replay, priceRuleId, actor, hash);
            return {
              ...priceRuleView(replay.priceRule),
              enabled: replay.newEnabled,
              transition: priceRuleTransitionView(replay),
              idempotent: true,
            };
          }

          const rule = await tx.priceRule.findUnique({
            where: { id: priceRuleId },
          });
          if (!rule) throw new NotFoundException('价格规则不存在');
          if (rule.enabled === dto.enabled)
            throw new ConflictException(
              dto.enabled ? '价格规则已启用' : '价格规则已停用',
            );

          if (dto.enabled) {
            const periodWhere = {
              ...(rule.effectiveTo
                ? { effectiveFrom: { lt: rule.effectiveTo } }
                : {}),
              OR: [
                { effectiveTo: null },
                { effectiveTo: { gt: rule.effectiveFrom } },
              ],
            };
            const overlappingVersion = await tx.priceRule.findFirst({
              where: {
                id: { not: rule.id },
                code: rule.code,
                enabled: true,
                ...periodWhere,
              },
              select: { id: true, version: true },
            });
            if (overlappingVersion) {
              throw new ConflictException(
                `同编码 v${overlappingVersion.version} 的有效期与当前版本重叠，请先停用旧版本或调整新版本有效期`,
              );
            }

            const competingScopes = await tx.priceRule.findMany({
              where: {
                id: { not: rule.id },
                timeSlotId: rule.timeSlotId,
                enabled: true,
                ...periodWhere,
              },
              select: {
                id: true,
                code: true,
                version: true,
                weekdayMask: true,
              },
            });
            const competing = competingScopes.find(
              (candidate) => (candidate.weekdayMask & rule.weekdayMask) !== 0,
            );
            if (competing) {
              throw new ConflictException(
                `相同计价时段与星期范围已有 ${competing.code} v${competing.version} 生效，不能产生不确定价格`,
              );
            }
          }

          const changed = await tx.priceRule.updateMany({
            where: { id: rule.id, enabled: rule.enabled },
            data: { enabled: dto.enabled },
          });
          if (changed.count !== 1)
            throw new ConflictException('价格规则状态已变化，请刷新后重试');
          const transition = await tx.priceRuleTransition.create({
            data: {
              priceRuleId: rule.id,
              oldEnabled: rule.enabled,
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
              actorRole: priceRuleAuditRole(actor),
              action: 'PRICE_RULE_STATUS_SET',
              objectType: 'PriceRule',
              objectId: rule.id,
              reason,
              oldValue: { enabled: rule.enabled } as never,
              newValue: {
                enabled: dto.enabled,
                code: rule.code,
                version: rule.version,
              } as never,
            },
          });
          return {
            ...priceRuleView(rule),
            enabled: dto.enabled,
            transition: priceRuleTransitionView(transition),
            idempotent: false,
          };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (!isRetryableMasterDataConflict(error)) throw error;
      const replay = await prisma.priceRuleTransition.findUnique({
        where: { idempotencyKey: dto.idempotencyKey },
        include: { priceRule: true },
      });
      if (replay) {
        assertPriceRuleTransitionReplay(replay, priceRuleId, actor, hash);
        return {
          ...priceRuleView(replay.priceRule),
          enabled: replay.newEnabled,
          transition: priceRuleTransitionView(replay),
          idempotent: true,
        };
      }
      if (attempt === 3)
        throw new ConflictException('价格规则状态发生并发冲突，请刷新后重试');
    }
  }
  throw new ConflictException('价格规则状态发生并发冲突，请刷新后重试');
}

export async function createPriceRuleVersionRecord(
  prisma: PrismaService,
  code: string,
  sourceRuleId: string | null,
  dto: CreatePriceRuleDto | CreatePriceRuleVersionDto,
  actor: AuthUser,
) {
  assertPriceRuleRole(actor, PRICE_RULE_WRITE_ROLES, '仅管理员可管理价格规则');
  const effectiveFrom = new Date(dto.effectiveFrom);
  const effectiveTo = dto.effectiveTo ? new Date(dto.effectiveTo) : null;
  if (effectiveTo && effectiveTo <= effectiveFrom)
    throw new BadRequestException('价格规则失效时间必须晚于生效时间');
  if (
    dto.newcomerPriceCents !== undefined &&
    dto.newcomerPriceCents > dto.priceCents
  )
    throw new BadRequestException('新客价不得高于普通价');
  const normalizedCode = code.trim();
  const timeSlotId = dto.timeSlotId?.trim() || null;
  const reason = dto.reason.trim();
  const command = {
    sourceRuleId,
    code: normalizedCode,
    name: dto.name.trim(),
    timeSlotId,
    weekdayMask: dto.weekdayMask,
    priceCents: dto.priceCents,
    newcomerPriceCents: dto.newcomerPriceCents ?? null,
    effectiveFrom: effectiveFrom.toISOString(),
    effectiveTo: effectiveTo?.toISOString() ?? null,
    reason,
  };
  const hash = orderCreationCommandHash(command);

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await prisma.$transaction(
        async (tx) => {
          const replay = await tx.priceRule.findUnique({
            where: { creationIdempotencyKey: dto.idempotencyKey },
          });
          if (replay) {
            assertPriceRuleCreationReplay(replay, actor, hash);
            return priceRuleView(replay);
          }

          if (sourceRuleId) {
            const source = await tx.priceRule.findUnique({
              where: { id: sourceRuleId },
              select: { code: true },
            });
            if (!source) throw new NotFoundException('价格规则源版本不存在');
            if (source.code !== normalizedCode)
              throw new ConflictException(
                '价格规则源版本编码已变化，请刷新后重试',
              );
          }
          if (timeSlotId) {
            const slot = await tx.timeSlot.findUnique({
              where: { id: timeSlotId },
              select: { id: true },
            });
            if (!slot) throw new NotFoundException('计价时段不存在');
          }

          const latest = await tx.priceRule.aggregate({
            where: { code: normalizedCode },
            _max: { version: true },
          });
          if (!sourceRuleId && latest._max.version !== null)
            throw new ConflictException(
              '价格规则编码已存在，请从已有版本创建新版本',
            );
          if (sourceRuleId && latest._max.version === null)
            throw new ConflictException('价格规则版本链不存在，请刷新后重试');

          const created = await tx.priceRule.create({
            data: {
              code: normalizedCode,
              version: (latest._max.version ?? 0) + 1,
              name: command.name,
              timeSlotId,
              weekdayMask: dto.weekdayMask,
              priceCents: dto.priceCents,
              newcomerPriceCents: dto.newcomerPriceCents ?? null,
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
              actorRole: priceRuleAuditRole(actor),
              action: 'PRICE_RULE_VERSION_CREATED',
              objectType: 'PriceRule',
              objectId: created.id,
              reason,
              newValue: {
                sourceRuleId,
                code: created.code,
                version: created.version,
                name: created.name,
                timeSlotId: created.timeSlotId,
                weekdayMask: created.weekdayMask,
                priceCents: created.priceCents,
                newcomerPriceCents: created.newcomerPriceCents,
                effectiveFrom: created.effectiveFrom.toISOString(),
                effectiveTo: created.effectiveTo?.toISOString() ?? null,
                enabled: false,
              } as never,
            },
          });
          return priceRuleView(created);
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (!isRetryableMasterDataConflict(error)) throw error;
      const replay = await prisma.priceRule.findUnique({
        where: { creationIdempotencyKey: dto.idempotencyKey },
      });
      if (replay) {
        assertPriceRuleCreationReplay(replay, actor, hash);
        return priceRuleView(replay);
      }
      if (attempt === 3)
        throw new ConflictException('价格规则版本发生并发冲突，请刷新后重试');
    }
  }
  throw new ConflictException('价格规则版本发生并发冲突，请刷新后重试');
}

export function assertPriceRuleCreationReplay(
  existing: { createdById: string; creationCommandHash: string },
  actor: AuthUser,
  hash: string,
) {
  if (
    existing.createdById !== actor.sub ||
    existing.creationCommandHash !== hash
  )
    throw new ConflictException('价格规则创建幂等键已用于其他命令或操作人');
}

export function assertPriceRuleTransitionReplay(
  existing: { priceRuleId: string; actorId: string; commandHash: string },
  priceRuleId: string,
  actor: AuthUser,
  hash: string,
) {
  if (
    existing.priceRuleId !== priceRuleId ||
    existing.actorId !== actor.sub ||
    existing.commandHash !== hash
  ) {
    throw new ConflictException('价格规则状态幂等键已用于其他命令或操作人');
  }
}

export function assertPriceRuleRole(
  actor: AuthUser,
  allowed: AppRole[],
  message: string,
) {
  if (!actor.roles.some((role) => allowed.includes(role)))
    throw new ForbiddenException(message);
}

export function priceRuleAuditRole(actor: AuthUser) {
  return actor.roles.includes(AppRole.SUPER_ADMIN)
    ? AppRole.SUPER_ADMIN
    : AppRole.ADMIN;
}
