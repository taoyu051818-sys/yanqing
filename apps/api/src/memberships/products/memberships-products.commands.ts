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
  CreateMembershipProductDto,
  CreateMembershipProductVersionDto,
  SetMembershipProductStatusDto,
} from '../memberships.dto.js';
import {
  commandHash,
  isRetryableWriteConflict,
  membershipProductView,
  membershipProductTransitionView,
} from '../shared/memberships-support.js';

export function products(prisma: PrismaService) {
  const now = new Date();
  return prisma.membershipProduct.findMany({
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
      level: true,
      priceCents: true,
      durationDays: true,
      benefits: true,
      effectiveFrom: true,
      effectiveTo: true,
      enabled: true,
    },
    orderBy: [{ priceCents: 'asc' }, { code: 'asc' }, { version: 'desc' }],
  });
}

export function manageProducts(prisma: PrismaService, actor: AuthUser) {
  assertMembershipProductReader(actor);
  return prisma.membershipProduct.findMany({
    select: {
      id: true,
      code: true,
      version: true,
      name: true,
      level: true,
      priceCents: true,
      durationDays: true,
      benefits: true,
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

export function createProduct(
  prisma: PrismaService,
  dto: CreateMembershipProductDto,
  actor: AuthUser,
) {
  return createMembershipProductVersion(prisma, dto.code, null, dto, actor);
}

export async function createProductVersion(
  prisma: PrismaService,
  sourceProductId: string,
  dto: CreateMembershipProductVersionDto,
  actor: AuthUser,
) {
  assertMembershipProductAdministrator(actor);
  const source = await prisma.membershipProduct.findUnique({
    where: { id: sourceProductId },
    select: { code: true },
  });
  if (!source) throw new NotFoundException('会员产品源版本不存在');
  return createMembershipProductVersion(
    prisma,
    source.code,
    sourceProductId,
    dto,
    actor,
  );
}

export async function setProductStatus(
  prisma: PrismaService,
  productId: string,
  dto: SetMembershipProductStatusDto,
  actor: AuthUser,
) {
  assertMembershipProductAdministrator(actor);
  const reason = dto.reason.trim();
  const hash = commandHash({ productId, enabled: dto.enabled, reason });

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await prisma.$transaction(
        async (tx) => {
          const replay = await tx.membershipProductTransition.findUnique({
            where: { idempotencyKey: dto.idempotencyKey },
            include: { membershipProduct: true },
          });
          if (replay) {
            assertMembershipProductTransitionReplay(
              replay,
              productId,
              actor,
              hash,
            );
            return {
              ...membershipProductView(replay.membershipProduct),
              enabled: replay.newEnabled,
              transition: membershipProductTransitionView(replay),
              idempotent: true,
            };
          }

          const product = await tx.membershipProduct.findUnique({
            where: { id: productId },
          });
          if (!product) throw new NotFoundException('会员产品不存在');
          if (product.enabled === dto.enabled)
            throw new ConflictException(
              dto.enabled ? '会员产品已启用' : '会员产品已停用',
            );

          if (dto.enabled) {
            const overlapping = await tx.membershipProduct.findFirst({
              where: {
                id: { not: product.id },
                code: product.code,
                enabled: true,
                ...(product.effectiveTo
                  ? { effectiveFrom: { lt: product.effectiveTo } }
                  : {}),
                OR: [
                  { effectiveTo: null },
                  { effectiveTo: { gt: product.effectiveFrom } },
                ],
              },
              select: { id: true, version: true },
            });
            if (overlapping) {
              throw new ConflictException(
                `同编码 v${overlapping.version} 的有效期与当前版本重叠，请先停用旧版本或调整新版本有效期`,
              );
            }
          }

          const changed = await tx.membershipProduct.updateMany({
            where: { id: product.id, enabled: product.enabled },
            data: { enabled: dto.enabled },
          });
          if (changed.count !== 1)
            throw new ConflictException('会员产品状态已变化，请刷新后重试');
          const transition = await tx.membershipProductTransition.create({
            data: {
              membershipProductId: product.id,
              oldEnabled: product.enabled,
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
              actorRole: masterDataAuditRole(actor),
              action: 'MEMBERSHIP_PRODUCT_STATUS_SET',
              objectType: 'MembershipProduct',
              objectId: product.id,
              reason,
              oldValue: { enabled: product.enabled } as never,
              newValue: {
                enabled: dto.enabled,
                code: product.code,
                version: product.version,
              } as never,
            },
          });
          return {
            ...membershipProductView(product),
            enabled: dto.enabled,
            transition: membershipProductTransitionView(transition),
            idempotent: false,
          };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (!isRetryableWriteConflict(error)) throw error;
      const replay = await prisma.membershipProductTransition.findUnique({
        where: { idempotencyKey: dto.idempotencyKey },
        include: { membershipProduct: true },
      });
      if (replay) {
        assertMembershipProductTransitionReplay(replay, productId, actor, hash);
        return {
          ...membershipProductView(replay.membershipProduct),
          enabled: replay.newEnabled,
          transition: membershipProductTransitionView(replay),
          idempotent: true,
        };
      }
      if (attempt === 3)
        throw new ConflictException('会员产品状态发生并发冲突，请刷新后重试');
    }
  }
  throw new ConflictException('会员产品状态发生并发冲突，请刷新后重试');
}

export async function createMembershipProductVersion(
  prisma: PrismaService,
  code: string,
  sourceProductId: string | null,
  dto: CreateMembershipProductDto | CreateMembershipProductVersionDto,
  actor: AuthUser,
) {
  assertMembershipProductAdministrator(actor);
  const effectiveFrom = new Date(dto.effectiveFrom);
  const effectiveTo = dto.effectiveTo ? new Date(dto.effectiveTo) : null;
  if (effectiveTo && effectiveTo <= effectiveFrom)
    throw new BadRequestException('会员产品失效时间必须晚于生效时间');
  const reason = dto.reason.trim();
  const normalizedCode = code.trim();
  const command = {
    sourceProductId,
    code: normalizedCode,
    name: dto.name.trim(),
    level: dto.level,
    priceCents: dto.priceCents,
    durationDays: dto.durationDays,
    benefits: dto.benefits,
    effectiveFrom: effectiveFrom.toISOString(),
    effectiveTo: effectiveTo?.toISOString() ?? null,
    reason,
  };
  const hash = commandHash(command);

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await prisma.$transaction(
        async (tx) => {
          const replay = await tx.membershipProduct.findUnique({
            where: { creationIdempotencyKey: dto.idempotencyKey },
          });
          if (replay) {
            assertMembershipProductCreationReplay(replay, actor, hash);
            return membershipProductView(replay);
          }

          if (sourceProductId) {
            const source = await tx.membershipProduct.findUnique({
              where: { id: sourceProductId },
              select: { code: true },
            });
            if (!source) throw new NotFoundException('会员产品源版本不存在');
            if (source.code !== normalizedCode)
              throw new ConflictException(
                '会员产品源版本编码已变化，请刷新后重试',
              );
          }

          const latest = await tx.membershipProduct.aggregate({
            where: { code: normalizedCode },
            _max: { version: true },
          });
          if (!sourceProductId && latest._max.version !== null)
            throw new ConflictException(
              '会员产品编码已存在，请从已有版本创建新版本',
            );
          if (sourceProductId && latest._max.version === null)
            throw new ConflictException('会员产品版本链不存在，请刷新后重试');

          const created = await tx.membershipProduct.create({
            data: {
              code: normalizedCode,
              version: (latest._max.version ?? 0) + 1,
              name: command.name,
              level: dto.level,
              priceCents: dto.priceCents,
              durationDays: dto.durationDays,
              benefits: dto.benefits as Prisma.InputJsonValue,
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
              actorRole: masterDataAuditRole(actor),
              action: 'MEMBERSHIP_PRODUCT_VERSION_CREATED',
              objectType: 'MembershipProduct',
              objectId: created.id,
              reason,
              newValue: {
                sourceProductId,
                code: created.code,
                version: created.version,
                name: created.name,
                level: created.level,
                priceCents: created.priceCents,
                durationDays: created.durationDays,
                benefits: created.benefits,
                effectiveFrom: created.effectiveFrom.toISOString(),
                effectiveTo: created.effectiveTo?.toISOString() ?? null,
                enabled: false,
              } as never,
            },
          });
          return membershipProductView(created);
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (!isRetryableWriteConflict(error)) throw error;
      const replay = await prisma.membershipProduct.findUnique({
        where: { creationIdempotencyKey: dto.idempotencyKey },
      });
      if (replay) {
        assertMembershipProductCreationReplay(replay, actor, hash);
        return membershipProductView(replay);
      }
      if (attempt === 3)
        throw new ConflictException('会员产品版本发生并发冲突，请刷新后重试');
    }
  }
  throw new ConflictException('会员产品版本发生并发冲突，请刷新后重试');
}

export function assertMembershipProductReader(actor: AuthUser) {
  if (
    !actor.roles.some((role) =>
      [AppRole.FRONT_DESK, AppRole.ADMIN, AppRole.SUPER_ADMIN].includes(
        role as never,
      ),
    )
  ) {
    throw new ForbiddenException('仅前台或管理员可查看会员产品版本');
  }
}

export function assertMembershipProductAdministrator(actor: AuthUser) {
  if (
    !actor.roles.some((role) =>
      [AppRole.ADMIN, AppRole.SUPER_ADMIN].includes(role as never),
    )
  )
    throw new ForbiddenException('仅管理员可管理会员产品');
}

export function assertMembershipProductCreationReplay(
  existing: { createdById: string; creationCommandHash: string },
  actor: AuthUser,
  hash: string,
) {
  if (
    existing.createdById !== actor.sub ||
    existing.creationCommandHash !== hash
  )
    throw new ConflictException('会员产品创建幂等键已用于其他命令或操作人');
}

export function assertMembershipProductTransitionReplay(
  existing: {
    membershipProductId: string;
    actorId: string;
    commandHash: string;
  },
  productId: string,
  actor: AuthUser,
  hash: string,
) {
  if (
    existing.membershipProductId !== productId ||
    existing.actorId !== actor.sub ||
    existing.commandHash !== hash
  ) {
    throw new ConflictException('会员产品状态幂等键已用于其他命令或操作人');
  }
}

export function masterDataAuditRole(actor: AuthUser) {
  return actor.roles.includes(AppRole.SUPER_ADMIN)
    ? AppRole.SUPER_ADMIN
    : AppRole.ADMIN;
}
