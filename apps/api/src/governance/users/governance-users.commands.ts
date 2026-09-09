import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import type { AuthUser } from '../../common/auth/auth-user.js';
import { PrismaService } from '../../database/prisma.service.js';
import { AppRole, Prisma, UserStatus } from '../../generated/prisma/client.js';
import type {
  GovernanceUserQueryDto,
  SetUserRolesDto,
  SetUserStatusDto,
} from '../governance.dto.js';
import {
  canonicalRoles,
  roleKey,
  commandHash,
  isPrismaErrorCode,
} from '../shared/governance-support.js';
import {
  writeGovernanceAudit,
  findGovernanceCommandReplay,
  assertGovernanceCommandReplay,
  normalizedReason,
  normalizedIdempotencyKey,
  assertRoles,
} from '../shared/governance-policy.js';

export async function users(
  prisma: PrismaService,
  query: GovernanceUserQueryDto,
  actor: AuthUser,
) {
  assertRoles(actor, [AppRole.ADMIN, AppRole.SUPER_ADMIN], '无权查看组织用户');
  const conditions: Prisma.UserWhereInput[] = [{ deletedAt: null }];
  if (query.status) conditions.push({ status: query.status });
  if (query.keyword) {
    conditions.push({
      OR: [
        { displayName: { contains: query.keyword, mode: 'insensitive' } },
        { phone: { contains: query.keyword } },
      ],
    });
  }
  if (query.role) {
    conditions.push({
      OR: [
        { primaryRole: query.role },
        { roles: { some: { role: query.role } } },
      ],
    });
  }
  const where: Prisma.UserWhereInput = {
    AND: conditions,
  };
  const [items, total] = await prisma.$transaction([
    prisma.user.findMany({
      where,
      select: {
        id: true,
        displayName: true,
        phone: true,
        status: true,
        primaryRole: true,
        openId: true,
        unionId: true,
        roles: {
          select: {
            role: true,
            merchantId: true,
            merchant: { select: { id: true, name: true } },
          },
          orderBy: { role: 'asc' },
        },
        createdAt: true,
        updatedAt: true,
      },
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
    prisma.user.count({ where }),
  ]);
  return {
    items: items.map(({ openId, unionId, ...item }) => ({
      ...item,
      wechatBound: Boolean(openId),
      unionBound: Boolean(unionId),
    })),
    total,
    page: query.page,
    pageSize: query.pageSize,
  };
}

export async function setUserRoles(
  prisma: PrismaService,
  userId: string,
  dto: SetUserRolesDto,
  actor: AuthUser,
) {
  assertRoles(actor, [AppRole.SUPER_ADMIN], '仅超级管理员可配置角色');
  const roles = canonicalRoles(dto.roles);
  const merchantId = dto.merchantId?.trim() || undefined;
  const reason = normalizedReason(dto.reason, '请填写角色变更原因');
  const requestId = normalizedIdempotencyKey(dto.idempotencyKey);
  if (!roles.includes(dto.primaryRole))
    throw new BadRequestException('主角色必须包含在角色集合中');
  if (roles.includes(AppRole.MERCHANT) && !merchantId) {
    throw new BadRequestException('商户角色必须关联商户');
  }
  if (!roles.includes(AppRole.MERCHANT) && merchantId) {
    throw new BadRequestException('仅商户角色可以关联商户');
  }
  if (userId === actor.sub && !roles.includes(AppRole.SUPER_ADMIN)) {
    throw new ForbiddenException('超级管理员不能移除自己的超级管理员角色');
  }
  const hash = commandHash({
    kind: 'USER_ROLES_SET',
    userId,
    primaryRole: dto.primaryRole,
    roles,
    merchantId: merchantId ?? null,
    reason,
  });

  try {
    return await prisma.$transaction(
      async (tx) => {
        const replay = await findGovernanceCommandReplay(tx, requestId);
        if (replay) {
          assertGovernanceCommandReplay(replay, {
            actor,
            action: 'USER_ROLES_SET',
            objectType: 'User',
            objectId: userId,
            commandHash: hash,
          });
          return userView(tx, userId);
        }
        if (merchantId) {
          const merchant = await tx.merchant.findUnique({
            where: { id: merchantId },
            select: { id: true, status: true },
          });
          if (!merchant || merchant.status !== UserStatus.ACTIVE) {
            throw new NotFoundException('有效商户不存在');
          }
        }
        const user = await tx.user.findUnique({
          where: { id: userId },
          include: { roles: { select: { role: true, merchantId: true } } },
        });
        if (!user || user.deletedAt) throw new NotFoundException('用户不存在');
        if (user.status !== UserStatus.ACTIVE)
          throw new ConflictException('停用用户不能配置角色');

        const oldRoles = canonicalRoles([
          user.primaryRole,
          ...user.roles.map((item) => item.role),
        ]);
        const oldKeys = new Set(
          user.roles.map((item) => roleKey(item.role, item.merchantId)),
        );
        const newKeys = new Set(roles.map((role) => roleKey(role, merchantId)));
        const unchanged =
          user.primaryRole === dto.primaryRole &&
          oldRoles.join('|') === roles.join('|') &&
          oldKeys.size === newKeys.size &&
          [...oldKeys].every((key) => newKeys.has(key));
        const oldValue = { primaryRole: user.primaryRole, roles: user.roles };
        const newValue = {
          commandHash: hash,
          primaryRole: dto.primaryRole,
          roles,
          merchantId: merchantId ?? null,
          wechatBound: Boolean(user.openId),
        };
        if (unchanged) {
          if (requestId) {
            await writeGovernanceAudit(tx, {
              actor,
              action: 'USER_ROLES_SET',
              objectType: 'User',
              objectId: userId,
              oldValue,
              newValue,
              reason,
              requestId,
            });
          }
          return userView(tx, userId);
        }

        if (
          oldRoles.includes(AppRole.SUPER_ADMIN) &&
          !roles.includes(AppRole.SUPER_ADMIN)
        ) {
          await assertAnotherSuperAdmin(tx, userId);
        }
        const locked = await tx.user.updateMany({
          where: {
            id: userId,
            status: UserStatus.ACTIVE,
            deletedAt: null,
            updatedAt: user.updatedAt,
          },
          data: { primaryRole: dto.primaryRole },
        });
        if (locked.count !== 1)
          throw new ConflictException('用户角色已由其他管理员变更');
        await tx.userRole.deleteMany({ where: { userId } });
        await tx.userRole.createMany({
          data: roles.map((role) => ({
            userId,
            role,
            merchantId: role === AppRole.MERCHANT ? merchantId : null,
          })),
        });
        await writeGovernanceAudit(tx, {
          actor,
          action: 'USER_ROLES_SET',
          objectType: 'User',
          objectId: userId,
          oldValue,
          newValue,
          reason,
          requestId,
        });
        return userView(tx, userId);
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  } catch (error) {
    if (!isPrismaErrorCode(error, 'P2034')) throw error;
    const replay = await findGovernanceCommandReplay(prisma, requestId);
    if (replay) {
      assertGovernanceCommandReplay(replay, {
        actor,
        action: 'USER_ROLES_SET',
        objectType: 'User',
        objectId: userId,
        commandHash: hash,
      });
      return userView(prisma, userId);
    }
    throw new ConflictException('用户角色刚刚发生变化，请刷新后重试');
  }
}

export async function setUserStatus(
  prisma: PrismaService,
  userId: string,
  dto: SetUserStatusDto,
  actor: AuthUser,
) {
  assertRoles(actor, [AppRole.SUPER_ADMIN], '仅超级管理员可停用或启用用户');
  if (
    !([UserStatus.ACTIVE, UserStatus.DISABLED] as UserStatus[]).includes(
      dto.status,
    )
  ) {
    throw new BadRequestException('治理端仅允许启用或停用用户');
  }
  if (userId === actor.sub && dto.status !== UserStatus.ACTIVE) {
    throw new ForbiddenException('不能停用当前登录的超级管理员');
  }
  const reason = normalizedReason(dto.reason, '请填写用户状态变更原因');
  const requestId = normalizedIdempotencyKey(dto.idempotencyKey);
  const hash = commandHash({
    kind: 'USER_STATUS_SET',
    userId,
    status: dto.status,
    reason,
  });
  try {
    return await prisma.$transaction(
      async (tx) => {
        const replay = await findGovernanceCommandReplay(tx, requestId);
        if (replay) {
          assertGovernanceCommandReplay(replay, {
            actor,
            action: 'USER_STATUS_SET',
            objectType: 'User',
            objectId: userId,
            commandHash: hash,
          });
          return userView(tx, userId);
        }
        const user = await tx.user.findUnique({
          where: { id: userId },
          include: { roles: { select: { role: true } } },
        });
        if (!user || user.deletedAt) throw new NotFoundException('用户不存在');
        const oldValue = { status: user.status };
        const newValue = { commandHash: hash, status: dto.status };
        if (user.status === dto.status) {
          if (requestId) {
            await writeGovernanceAudit(tx, {
              actor,
              action: 'USER_STATUS_SET',
              objectType: 'User',
              objectId: userId,
              oldValue,
              newValue,
              reason,
              requestId,
            });
          }
          return userView(tx, userId);
        }
        if (
          dto.status !== UserStatus.ACTIVE &&
          [user.primaryRole, ...user.roles.map((item) => item.role)].includes(
            AppRole.SUPER_ADMIN,
          )
        ) {
          await assertAnotherSuperAdmin(tx, userId);
        }
        const changed = await tx.user.updateMany({
          where: {
            id: userId,
            status: user.status,
            deletedAt: null,
            updatedAt: user.updatedAt,
          },
          data: { status: dto.status },
        });
        if (changed.count !== 1)
          throw new ConflictException('用户状态已由其他管理员变更');
        await writeGovernanceAudit(tx, {
          actor,
          action: 'USER_STATUS_SET',
          objectType: 'User',
          objectId: userId,
          oldValue,
          newValue,
          reason,
          requestId,
        });
        return userView(tx, userId);
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  } catch (error) {
    if (!isPrismaErrorCode(error, 'P2034')) throw error;
    const replay = await findGovernanceCommandReplay(prisma, requestId);
    if (replay) {
      assertGovernanceCommandReplay(replay, {
        actor,
        action: 'USER_STATUS_SET',
        objectType: 'User',
        objectId: userId,
        commandHash: hash,
      });
      return userView(prisma, userId);
    }
    throw new ConflictException('用户状态刚刚发生变化，请刷新后重试');
  }
}

export function userView(
  client: Pick<Prisma.TransactionClient, 'user'>,
  userId: string,
) {
  return client.user
    .findUniqueOrThrow({
      where: { id: userId },
      select: {
        id: true,
        displayName: true,
        phone: true,
        status: true,
        primaryRole: true,
        openId: true,
        roles: {
          select: {
            role: true,
            merchantId: true,
            merchant: { select: { id: true, name: true } },
          },
          orderBy: { role: 'asc' },
        },
        updatedAt: true,
      },
    })
    .then(({ openId, ...user }) => ({
      ...user,
      wechatBound: Boolean(openId),
    }));
}

export async function assertAnotherSuperAdmin(
  tx: Prisma.TransactionClient,
  excludedUserId: string,
) {
  const count = await tx.user.count({
    where: {
      id: { not: excludedUserId },
      status: UserStatus.ACTIVE,
      deletedAt: null,
      OR: [
        { primaryRole: AppRole.SUPER_ADMIN },
        { roles: { some: { role: AppRole.SUPER_ADMIN } } },
      ],
    },
  });
  if (!count)
    throw new ConflictException('系统必须保留至少一名启用的超级管理员');
}
