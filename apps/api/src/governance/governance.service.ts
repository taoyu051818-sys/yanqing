import { createHash } from 'node:crypto';

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import type { AuthUser } from '../common/auth/auth-user.js';
import { PrismaService } from '../database/prisma.service.js';
import {
  AppRole,
  Prisma,
  RiskStatus,
  UserStatus,
} from '../generated/prisma/client.js';
import type {
  GovernanceUserQueryDto,
  ReviewRiskEventDto,
  RiskEventQueryDto,
  SetUserRolesDto,
  SetUserStatusDto,
} from './governance.dto.js';

type RiskAction = 'REVIEW' | 'RESOLVE' | 'DISMISS';

type GovernanceCommandReplay = {
  actorId: string | null;
  action: string;
  objectType: string;
  objectId: string | null;
  newValue: unknown;
};

const canonicalRoles = (roles: AppRole[]) => [...new Set(roles)].sort();
const roleKey = (role: AppRole, merchantId?: string | null) =>
  `${role}:${role === AppRole.MERCHANT ? (merchantId ?? '') : ''}`;
const commandHash = (command: Record<string, unknown>) =>
  createHash('sha256').update(JSON.stringify(command)).digest('hex');
const isPrismaErrorCode = (error: unknown, code: string) =>
  Boolean(
    error &&
    typeof error === 'object' &&
    'code' in error &&
    error.code === code,
  );

const SENSITIVE_EVIDENCE_KEY =
  /(?:authorization|cookie|password|secret|token|session|openid|unionid)/i;
const redactEvidence = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(redactEvidence);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, nested]) => [
      key,
      SENSITIVE_EVIDENCE_KEY.test(key) ? '[REDACTED]' : redactEvidence(nested),
    ]),
  );
};

@Injectable()
export class GovernanceService {
  constructor(private readonly prisma: PrismaService) {}

  async users(query: GovernanceUserQueryDto, actor: AuthUser) {
    this.assertRoles(
      actor,
      [AppRole.ADMIN, AppRole.SUPER_ADMIN],
      '无权查看组织用户',
    );
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
    const [items, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({
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
      this.prisma.user.count({ where }),
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

  async setUserRoles(userId: string, dto: SetUserRolesDto, actor: AuthUser) {
    this.assertRoles(actor, [AppRole.SUPER_ADMIN], '仅超级管理员可配置角色');
    const roles = canonicalRoles(dto.roles);
    const merchantId = dto.merchantId?.trim() || undefined;
    const reason = this.normalizedReason(dto.reason, '请填写角色变更原因');
    const requestId = this.normalizedIdempotencyKey(dto.idempotencyKey);
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
      return await this.prisma.$transaction(
        async (tx) => {
          const replay = await this.findGovernanceCommandReplay(tx, requestId);
          if (replay) {
            this.assertGovernanceCommandReplay(replay, {
              actor,
              action: 'USER_ROLES_SET',
              objectType: 'User',
              objectId: userId,
              commandHash: hash,
            });
            return this.userView(tx, userId);
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
          if (!user || user.deletedAt)
            throw new NotFoundException('用户不存在');
          if (user.status !== UserStatus.ACTIVE)
            throw new ConflictException('停用用户不能配置角色');

          const oldRoles = canonicalRoles([
            user.primaryRole,
            ...user.roles.map((item) => item.role),
          ]);
          const oldKeys = new Set(
            user.roles.map((item) => roleKey(item.role, item.merchantId)),
          );
          const newKeys = new Set(
            roles.map((role) => roleKey(role, merchantId)),
          );
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
              await this.writeGovernanceAudit(tx, {
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
            return this.userView(tx, userId);
          }

          if (
            oldRoles.includes(AppRole.SUPER_ADMIN) &&
            !roles.includes(AppRole.SUPER_ADMIN)
          ) {
            await this.assertAnotherSuperAdmin(tx, userId);
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
          await this.writeGovernanceAudit(tx, {
            actor,
            action: 'USER_ROLES_SET',
            objectType: 'User',
            objectId: userId,
            oldValue,
            newValue,
            reason,
            requestId,
          });
          return this.userView(tx, userId);
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (!isPrismaErrorCode(error, 'P2034')) throw error;
      const replay = await this.findGovernanceCommandReplay(
        this.prisma,
        requestId,
      );
      if (replay) {
        this.assertGovernanceCommandReplay(replay, {
          actor,
          action: 'USER_ROLES_SET',
          objectType: 'User',
          objectId: userId,
          commandHash: hash,
        });
        return this.userView(this.prisma, userId);
      }
      throw new ConflictException('用户角色刚刚发生变化，请刷新后重试');
    }
  }

  async setUserStatus(userId: string, dto: SetUserStatusDto, actor: AuthUser) {
    this.assertRoles(
      actor,
      [AppRole.SUPER_ADMIN],
      '仅超级管理员可停用或启用用户',
    );
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
    const reason = this.normalizedReason(dto.reason, '请填写用户状态变更原因');
    const requestId = this.normalizedIdempotencyKey(dto.idempotencyKey);
    const hash = commandHash({
      kind: 'USER_STATUS_SET',
      userId,
      status: dto.status,
      reason,
    });
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          const replay = await this.findGovernanceCommandReplay(tx, requestId);
          if (replay) {
            this.assertGovernanceCommandReplay(replay, {
              actor,
              action: 'USER_STATUS_SET',
              objectType: 'User',
              objectId: userId,
              commandHash: hash,
            });
            return this.userView(tx, userId);
          }
          const user = await tx.user.findUnique({
            where: { id: userId },
            include: { roles: { select: { role: true } } },
          });
          if (!user || user.deletedAt)
            throw new NotFoundException('用户不存在');
          const oldValue = { status: user.status };
          const newValue = { commandHash: hash, status: dto.status };
          if (user.status === dto.status) {
            if (requestId) {
              await this.writeGovernanceAudit(tx, {
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
            return this.userView(tx, userId);
          }
          if (
            dto.status !== UserStatus.ACTIVE &&
            [user.primaryRole, ...user.roles.map((item) => item.role)].includes(
              AppRole.SUPER_ADMIN,
            )
          ) {
            await this.assertAnotherSuperAdmin(tx, userId);
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
          await this.writeGovernanceAudit(tx, {
            actor,
            action: 'USER_STATUS_SET',
            objectType: 'User',
            objectId: userId,
            oldValue,
            newValue,
            reason,
            requestId,
          });
          return this.userView(tx, userId);
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (!isPrismaErrorCode(error, 'P2034')) throw error;
      const replay = await this.findGovernanceCommandReplay(
        this.prisma,
        requestId,
      );
      if (replay) {
        this.assertGovernanceCommandReplay(replay, {
          actor,
          action: 'USER_STATUS_SET',
          objectType: 'User',
          objectId: userId,
          commandHash: hash,
        });
        return this.userView(this.prisma, userId);
      }
      throw new ConflictException('用户状态刚刚发生变化，请刷新后重试');
    }
  }

  async riskEvents(query: RiskEventQueryDto, actor: AuthUser) {
    this.assertRoles(
      actor,
      [AppRole.FINANCE, AppRole.ADMIN, AppRole.SUPER_ADMIN],
      '无权查看风险事件',
    );
    const where: Prisma.RiskEventWhereInput = {
      status: query.status,
      severity: query.severity,
      ...(query.keyword
        ? {
            OR: [
              {
                ruleCode: {
                  contains: query.keyword,
                  mode: 'insensitive' as const,
                },
              },
              {
                summary: {
                  contains: query.keyword,
                  mode: 'insensitive' as const,
                },
              },
              {
                objectType: {
                  contains: query.keyword,
                  mode: 'insensitive' as const,
                },
              },
            ],
          }
        : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.riskEvent.findMany({
        where,
        include: {
          user: { select: { id: true, displayName: true } },
          order: { select: { id: true, orderNo: true, title: true } },
        },
        orderBy: [{ severity: 'desc' }, { createdAt: 'asc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.riskEvent.count({ where }),
    ]);
    return {
      items: items.map((item) => this.riskView(item)),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  async transitionRisk(
    riskId: string,
    action: RiskAction,
    dto: ReviewRiskEventDto,
    actor: AuthUser,
  ) {
    if (!(['REVIEW', 'RESOLVE', 'DISMISS'] as string[]).includes(action)) {
      throw new BadRequestException('风险处理动作无效');
    }
    const allowedRoles: AppRole[] =
      action === 'REVIEW'
        ? [AppRole.FINANCE, AppRole.ADMIN, AppRole.SUPER_ADMIN]
        : [AppRole.ADMIN, AppRole.SUPER_ADMIN];
    this.assertRoles(actor, allowedRoles, '无权处理风险事件');
    const reason = this.normalizedReason(dto.reason, '请填写风险处理原因');
    const requestId = this.normalizedIdempotencyKey(dto.idempotencyKey);
    const target =
      action === 'REVIEW'
        ? RiskStatus.REVIEWING
        : action === 'RESOLVE'
          ? RiskStatus.RESOLVED
          : RiskStatus.DISMISSED;
    const auditAction = `RISK_EVENT_${target}`;
    const hash = commandHash({ kind: auditAction, riskId, reason });
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          const replay = await this.findGovernanceCommandReplay(tx, requestId);
          if (replay) {
            this.assertGovernanceCommandReplay(replay, {
              actor,
              action: auditAction,
              objectType: 'RiskEvent',
              objectId: riskId,
              commandHash: hash,
            });
            const current = await tx.riskEvent.findUniqueOrThrow({
              where: { id: riskId },
            });
            return this.riskView(current);
          }
          const risk = await tx.riskEvent.findUnique({ where: { id: riskId } });
          if (!risk) throw new NotFoundException('风险事件不存在');
          const oldValue = { status: risk.status };
          const newValue = { commandHash: hash, status: target };
          if (risk.status === target) {
            if (requestId) {
              await this.writeGovernanceAudit(tx, {
                actor,
                actorRole: actor.roles.find((role) =>
                  allowedRoles.includes(role),
                ),
                action: auditAction,
                objectType: 'RiskEvent',
                objectId: riskId,
                oldValue,
                newValue,
                reason,
                requestId,
              });
            }
            return this.riskView(risk);
          }
          if (
            (
              [RiskStatus.RESOLVED, RiskStatus.DISMISSED] as RiskStatus[]
            ).includes(risk.status)
          ) {
            throw new ConflictException('终态风险事件不能再次处理');
          }
          if (action === 'REVIEW' && risk.status !== RiskStatus.OPEN) {
            throw new ConflictException('只有待处理风险可以进入复核');
          }
          if (
            action !== 'REVIEW' &&
            !([RiskStatus.OPEN, RiskStatus.REVIEWING] as RiskStatus[]).includes(
              risk.status,
            )
          ) {
            throw new ConflictException('风险事件状态已变化');
          }
          const evidence =
            risk.evidence &&
            typeof risk.evidence === 'object' &&
            !Array.isArray(risk.evidence)
              ? (risk.evidence as Record<string, unknown>)
              : {};
          const changed = await tx.riskEvent.updateMany({
            where: { id: riskId, status: risk.status },
            data: {
              status: target,
              evidence: {
                ...evidence,
                lastAction: action,
                lastReason: reason,
                lastActorId: actor.sub,
                lastActionAt: new Date().toISOString(),
              } as never,
              resolvedBy: target === RiskStatus.REVIEWING ? null : actor.sub,
              resolvedAt: target === RiskStatus.REVIEWING ? null : new Date(),
            },
          });
          if (changed.count !== 1)
            throw new ConflictException('风险事件已由其他人员处理');
          const updated = await tx.riskEvent.findUniqueOrThrow({
            where: { id: riskId },
          });
          await this.writeGovernanceAudit(tx, {
            actor,
            actorRole: actor.roles.find((role) => allowedRoles.includes(role)),
            action: auditAction,
            objectType: 'RiskEvent',
            objectId: riskId,
            oldValue,
            newValue,
            reason,
            requestId,
          });
          return this.riskView(updated);
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (!isPrismaErrorCode(error, 'P2034')) throw error;
      const replay = await this.findGovernanceCommandReplay(
        this.prisma,
        requestId,
      );
      if (replay) {
        this.assertGovernanceCommandReplay(replay, {
          actor,
          action: auditAction,
          objectType: 'RiskEvent',
          objectId: riskId,
          commandHash: hash,
        });
        const current = await this.prisma.riskEvent.findUniqueOrThrow({
          where: { id: riskId },
        });
        return this.riskView(current);
      }
      throw new ConflictException('风险事件刚刚由其他人员处理，请刷新后重试');
    }
  }

  private writeGovernanceAudit(
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

  private findGovernanceCommandReplay(
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

  private assertGovernanceCommandReplay(
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

  private normalizedReason(reason: string, message: string) {
    const normalized = reason?.trim();
    if (!normalized || normalized.length < 2)
      throw new BadRequestException(message);
    return normalized;
  }

  private normalizedIdempotencyKey(value?: string) {
    if (value === undefined) return undefined;
    const normalized = value.trim();
    if (normalized.length < 8 || normalized.length > 100) {
      throw new BadRequestException('幂等键长度必须为 8 至 100 个字符');
    }
    return normalized;
  }

  private userView(
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

  private riskView<T extends { evidence: unknown }>(risk: T): T {
    return { ...risk, evidence: redactEvidence(risk.evidence) } as T;
  }

  private async assertAnotherSuperAdmin(
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

  private assertRoles(actor: AuthUser, allowed: AppRole[], message: string) {
    if (!actor.roles.some((role) => allowed.includes(role)))
      throw new ForbiddenException(message);
  }
}
