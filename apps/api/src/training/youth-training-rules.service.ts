import { randomBytes } from 'node:crypto';

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
  YouthTrainingRuleStatus,
} from '../generated/prisma/client.js';
import { orderCreationCommandHash } from '../orders/order-creation-idempotency.js';
import type {
  CreateYouthTrainingRuleDto,
  DecideYouthTrainingRuleDto,
  YouthTrainingRuleQueryDto,
} from './training-operations.dto.js';
import {
  youthTrainingRuleManagementResponse,
  youthTrainingRulePublicResponse,
} from './youth-training-rule-response.js';

const ruleVersion = () =>
  `YTR-${new Date().toISOString().replace(/\D/g, '').slice(0, 14)}-${randomBytes(2).toString('hex').toUpperCase()}`;

const normalizedCommandText = (
  value: string,
  label: string,
  min: number,
  max: number,
) => {
  const normalized = value.trim();
  if (normalized.length < min || normalized.length > max) {
    throw new BadRequestException(`${label}长度必须为 ${min}-${max} 个字符`);
  }
  return normalized;
};

const isConcurrentRuleWrite = (error: unknown) =>
  typeof error === 'object' &&
  error !== null &&
  ['P2002', 'P2034'].includes(String((error as { code?: unknown }).code));

export type YouthProductValidation = {
  ruleId: string;
  version: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  limits: {
    maxTotalSessions: number;
    maxValidityDays: number;
    maxContractAmountCents: number;
    warningThresholdDays: number;
    hardBlock: boolean;
  };
  result: 'PASS' | 'WARNING';
  violations: string[];
  warnings: string[];
  validatedAt: string;
};

@Injectable()
export class YouthTrainingRulesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: YouthTrainingRuleQueryDto, actor: AuthUser) {
    const allowedRoles: AppRole[] = [AppRole.ADMIN, AppRole.SUPER_ADMIN];
    if (!actor.roles.some((role) => allowedRoles.includes(role))) {
      throw new ForbiddenException('仅管理员可查看青少年监管规则版本');
    }
    const rules = await this.prisma.youthTrainingRule.findMany({
      where: { status: query.status },
      include: {
        requestedBy: { select: { displayName: true } },
        reviewedBy: { select: { displayName: true } },
      },
      orderBy: [{ effectiveFrom: 'desc' }, { createdAt: 'desc' }],
    });
    return rules.map((rule) =>
      youthTrainingRuleManagementResponse(rule, { actorId: actor.sub }),
    );
  }

  async active(at = new Date()) {
    const rule = await this.prisma.youthTrainingRule.findFirst({
      where: {
        status: {
          in: [
            YouthTrainingRuleStatus.PUBLISHED,
            YouthTrainingRuleStatus.SUPERSEDED,
          ],
        },
        effectiveFrom: { lte: at },
        OR: [{ effectiveTo: null }, { effectiveTo: { gt: at } }],
      },
      select: {
        id: true,
        version: true,
        status: true,
        maxTotalSessions: true,
        maxValidityDays: true,
        maxContractAmountCents: true,
        warningThresholdDays: true,
        hardBlock: true,
        effectiveFrom: true,
        effectiveTo: true,
      },
      orderBy: { effectiveFrom: 'desc' },
    });
    return rule ? youthTrainingRulePublicResponse(rule) : null;
  }

  async create(dto: CreateYouthTrainingRuleDto, actor: AuthUser) {
    if (!actor.roles.includes(AppRole.ADMIN)) {
      throw new ForbiddenException('青少年监管规则必须由 ADMIN 制单');
    }
    const reason = normalizedCommandText(dto.reason, '制单原因', 2, 300);
    const idempotencyKey = normalizedCommandText(
      dto.idempotencyKey,
      '幂等键',
      8,
      100,
    );
    const effectiveFrom = new Date(dto.effectiveFrom);
    if (dto.warningThresholdDays > dto.maxValidityDays) {
      throw new BadRequestException('到期预警阈值不能超过最大有效期限');
    }
    const commandHash = orderCreationCommandHash({
      kind: 'YOUTH_TRAINING_RULE_CREATE',
      maxTotalSessions: dto.maxTotalSessions,
      maxValidityDays: dto.maxValidityDays,
      maxContractAmountCents: dto.maxContractAmountCents,
      warningThresholdDays: dto.warningThresholdDays,
      hardBlock: dto.hardBlock,
      effectiveFrom,
      reason,
    });
    const replay = await this.prisma.youthTrainingRule.findUnique({
      where: { requestIdempotencyKey: idempotencyKey },
    });
    if (replay) {
      if (
        replay.requestedById !== actor.sub ||
        replay.commandHash !== commandHash
      ) {
        throw new ConflictException('监管规则制单幂等键已用于其他命令');
      }
      return youthTrainingRuleManagementResponse(replay, {
        actorId: actor.sub,
        requestedByDisplayName: actor.displayName,
      });
    }
    if (effectiveFrom <= new Date()) {
      throw new BadRequestException(
        '监管规则生效时间必须晚于当前时间，以便完成异人复核',
      );
    }

    try {
      const created = await this.prisma.$transaction(
        async (tx) => {
          const concurrent = await tx.youthTrainingRule.findUnique({
            where: { requestIdempotencyKey: idempotencyKey },
          });
          if (concurrent) {
            if (
              concurrent.requestedById !== actor.sub ||
              concurrent.commandHash !== commandHash
            ) {
              throw new ConflictException('监管规则制单幂等键已用于其他命令');
            }
            return concurrent;
          }
          const created = await tx.youthTrainingRule.create({
            data: {
              version: ruleVersion(),
              maxTotalSessions: dto.maxTotalSessions,
              maxValidityDays: dto.maxValidityDays,
              maxContractAmountCents: dto.maxContractAmountCents,
              warningThresholdDays: dto.warningThresholdDays,
              hardBlock: dto.hardBlock,
              effectiveFrom,
              requestReason: reason,
              requestedById: actor.sub,
              requestIdempotencyKey: idempotencyKey,
              commandHash,
            },
          });
          await tx.auditLog.create({
            data: {
              actorId: actor.sub,
              actorRole: AppRole.ADMIN,
              action: 'YOUTH_TRAINING_RULE_DRAFTED',
              objectType: 'YouthTrainingRule',
              objectId: created.id,
              reason,
              requestId: idempotencyKey,
              newValue: {
                version: created.version,
                status: created.status,
                commandHash,
                effectiveFrom: effectiveFrom.toISOString(),
                limits: {
                  maxTotalSessions: dto.maxTotalSessions,
                  maxValidityDays: dto.maxValidityDays,
                  maxContractAmountCents: dto.maxContractAmountCents,
                  warningThresholdDays: dto.warningThresholdDays,
                  hardBlock: dto.hardBlock,
                },
              } as never,
            },
          });
          return created;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
      return youthTrainingRuleManagementResponse(created, {
        actorId: actor.sub,
        requestedByDisplayName: actor.displayName,
      });
    } catch (error) {
      if (!isConcurrentRuleWrite(error)) throw error;
      const concurrent = await this.prisma.youthTrainingRule.findUnique({
        where: { requestIdempotencyKey: idempotencyKey },
      });
      if (
        concurrent &&
        concurrent.requestedById === actor.sub &&
        concurrent.commandHash === commandHash
      ) {
        return youthTrainingRuleManagementResponse(concurrent, {
          actorId: actor.sub,
          requestedByDisplayName: actor.displayName,
        });
      }
      throw new ConflictException(
        '监管规则制单发生并发冲突，请使用原幂等键重试',
      );
    }
  }

  publish(id: string, dto: DecideYouthTrainingRuleDto, actor: AuthUser) {
    return this.decide(id, dto, actor, YouthTrainingRuleStatus.PUBLISHED);
  }

  reject(id: string, dto: DecideYouthTrainingRuleDto, actor: AuthUser) {
    return this.decide(id, dto, actor, YouthTrainingRuleStatus.REJECTED);
  }

  private async decide(
    id: string,
    dto: DecideYouthTrainingRuleDto,
    actor: AuthUser,
    target:
      | typeof YouthTrainingRuleStatus.PUBLISHED
      | typeof YouthTrainingRuleStatus.REJECTED,
  ) {
    if (!actor.roles.includes(AppRole.SUPER_ADMIN)) {
      throw new ForbiddenException('仅 SUPER_ADMIN 可复核青少年监管规则');
    }
    const reason = normalizedCommandText(dto.reason, '复核原因', 2, 300);
    const idempotencyKey = normalizedCommandText(
      dto.idempotencyKey,
      '幂等键',
      8,
      100,
    );
    const decisionCommandHash = orderCreationCommandHash({
      kind: 'YOUTH_TRAINING_RULE_DECIDE',
      ruleId: id,
      target,
      reason,
    });
    const replay = await this.prisma.youthTrainingRule.findUnique({
      where: { decisionIdempotencyKey: idempotencyKey },
    });
    if (replay) {
      if (
        replay.id !== id ||
        replay.status !== target ||
        replay.reviewedById !== actor.sub ||
        replay.decisionCommandHash !== decisionCommandHash
      ) {
        throw new ConflictException('监管规则复核幂等键已用于其他决定');
      }
      return youthTrainingRuleManagementResponse(replay, {
        actorId: actor.sub,
        reviewedByDisplayName: actor.displayName,
      });
    }

    try {
      const decidedRule = await this.prisma.$transaction(
        async (tx) => {
          const current = await tx.youthTrainingRule.findUnique({
            where: { id },
          });
          if (!current) throw new NotFoundException('青少年监管规则不存在');
          if (current.requestedById === actor.sub) {
            throw new ForbiddenException(
              '监管规则制单人与复核人不能是同一账号',
            );
          }
          if (current.status !== YouthTrainingRuleStatus.DRAFT) {
            throw new ConflictException('监管规则已完成复核，不能重复覆盖状态');
          }
          const now = new Date();
          if (target === YouthTrainingRuleStatus.PUBLISHED) {
            if (current.effectiveFrom <= now) {
              throw new ConflictException(
                '规则预定生效时间已过，请重新制单以避免追溯生效',
              );
            }
            const previous = await tx.youthTrainingRule.findFirst({
              where: {
                status: {
                  in: [
                    YouthTrainingRuleStatus.PUBLISHED,
                    YouthTrainingRuleStatus.SUPERSEDED,
                  ],
                },
                effectiveFrom: { lt: current.effectiveFrom },
                OR: [
                  { effectiveTo: null },
                  { effectiveTo: { gt: current.effectiveFrom } },
                ],
              },
              orderBy: { effectiveFrom: 'desc' },
            });
            const conflictingFuture = await tx.youthTrainingRule.findFirst({
              where: {
                id: { not: current.id },
                status: YouthTrainingRuleStatus.PUBLISHED,
                effectiveFrom: { gte: current.effectiveFrom },
              },
            });
            if (conflictingFuture) {
              throw new ConflictException(
                '已有同时间或更晚生效的已发布规则，请先处理版本顺序',
              );
            }
            if (previous) {
              await tx.youthTrainingRule.update({
                where: { id: previous.id },
                data: {
                  status: YouthTrainingRuleStatus.SUPERSEDED,
                  effectiveTo: current.effectiveFrom,
                },
              });
            }
          }
          const changed = await tx.youthTrainingRule.updateMany({
            where: { id, status: YouthTrainingRuleStatus.DRAFT },
            data: {
              status: target,
              reviewReason: reason,
              reviewedById: actor.sub,
              reviewedAt: now,
              decisionIdempotencyKey: idempotencyKey,
              decisionCommandHash,
            },
          });
          if (changed.count !== 1) {
            throw new ConflictException('监管规则状态已被其他复核操作更新');
          }
          const decided = await tx.youthTrainingRule.findUniqueOrThrow({
            where: { id },
          });
          await tx.auditLog.create({
            data: {
              actorId: actor.sub,
              actorRole: AppRole.SUPER_ADMIN,
              action:
                target === YouthTrainingRuleStatus.PUBLISHED
                  ? 'YOUTH_TRAINING_RULE_PUBLISHED'
                  : 'YOUTH_TRAINING_RULE_REJECTED',
              objectType: 'YouthTrainingRule',
              objectId: id,
              reason,
              requestId: idempotencyKey,
              oldValue: { status: current.status } as never,
              newValue: {
                status: target,
                version: current.version,
                decisionCommandHash,
                effectiveFrom: current.effectiveFrom.toISOString(),
              } as never,
            },
          });
          return decided;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
      return youthTrainingRuleManagementResponse(decidedRule, {
        actorId: actor.sub,
        reviewedByDisplayName: actor.displayName,
      });
    } catch (error) {
      if (!isConcurrentRuleWrite(error)) throw error;
      const concurrent = await this.prisma.youthTrainingRule.findUnique({
        where: { decisionIdempotencyKey: idempotencyKey },
      });
      if (
        concurrent &&
        concurrent.id === id &&
        concurrent.status === target &&
        concurrent.reviewedById === actor.sub &&
        concurrent.decisionCommandHash === decisionCommandHash
      ) {
        return youthTrainingRuleManagementResponse(concurrent, {
          actorId: actor.sub,
          reviewedByDisplayName: actor.displayName,
        });
      }
      throw new ConflictException(
        '监管规则复核发生并发冲突，请使用原幂等键重试',
      );
    }
  }

  async validateProduct(
    input: {
      totalSessions: number;
      validityDays: number;
      priceCents: number;
    },
    at = new Date(),
  ): Promise<YouthProductValidation> {
    const rule = await this.active(at);
    if (!rule) {
      throw new ConflictException(
        '当前没有已发布且生效的青少年培训监管规则，正式销售已阻断，请先完成 ADMIN 制单与 SUPER_ADMIN 复核发布',
      );
    }
    const violations: string[] = [];
    const warnings: string[] = [];
    if (input.totalSessions > rule.maxTotalSessions) {
      violations.push(
        `总课时 ${input.totalSessions} 超过当前规则上限 ${rule.maxTotalSessions}`,
      );
    }
    if (input.validityDays > rule.maxValidityDays) {
      violations.push(
        `有效期 ${input.validityDays} 天超过当前规则上限 ${rule.maxValidityDays} 天`,
      );
    }
    if (input.priceCents > rule.maxContractAmountCents) {
      violations.push(`合同金额超过当前规则上限`);
    }
    const validityHeadroom = rule.maxValidityDays - input.validityDays;
    if (
      validityHeadroom >= 0 &&
      validityHeadroom <= rule.warningThresholdDays
    ) {
      warnings.push(`产品有效期距离当前规则上限仅余 ${validityHeadroom} 天`);
    }
    if (violations.length && rule.hardBlock) {
      throw new BadRequestException(
        `青少年培训监管规则校验未通过：${violations.join('；')}`,
      );
    }
    return {
      ruleId: rule.id,
      version: rule.version,
      effectiveFrom: rule.effectiveFrom.toISOString(),
      effectiveTo: rule.effectiveTo?.toISOString() ?? null,
      limits: {
        maxTotalSessions: rule.maxTotalSessions,
        maxValidityDays: rule.maxValidityDays,
        maxContractAmountCents: rule.maxContractAmountCents,
        warningThresholdDays: rule.warningThresholdDays,
        hardBlock: rule.hardBlock,
      },
      result: violations.length || warnings.length ? 'WARNING' : 'PASS',
      violations,
      warnings,
      validatedAt: at.toISOString(),
    };
  }
}
