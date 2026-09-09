import { riskEventView } from '../../common/risk/risk-event-view.js';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import type { AuthUser } from '../../common/auth/auth-user.js';
import { PrismaService } from '../../database/prisma.service.js';
import { AppRole, Prisma, RiskStatus } from '../../generated/prisma/client.js';
import type {
  ReviewRiskEventDto,
  RiskEventQueryDto,
} from '../governance.dto.js';
import {
  RiskAction,
  commandHash,
  isPrismaErrorCode,
  redactEvidence,
} from '../shared/governance-support.js';
import {
  writeGovernanceAudit,
  findGovernanceCommandReplay,
  assertGovernanceCommandReplay,
  normalizedReason,
  normalizedIdempotencyKey,
  assertRoles,
} from '../shared/governance-policy.js';

export async function riskEvents(
  prisma: PrismaService,
  query: RiskEventQueryDto,
  actor: AuthUser,
) {
  assertRoles(
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
  const [items, total] = await prisma.$transaction([
    prisma.riskEvent.findMany({
      where,
      include: {
        user: { select: { id: true, displayName: true } },
        order: { select: { id: true, orderNo: true, title: true } },
      },
      orderBy: [{ severity: 'desc' }, { createdAt: 'asc' }],
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
    prisma.riskEvent.count({ where }),
  ]);
  return {
    items: items.map((item) => riskView(item)),
    total,
    page: query.page,
    pageSize: query.pageSize,
  };
}

export async function transitionRisk(
  prisma: PrismaService,
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
  assertRoles(actor, allowedRoles, '无权处理风险事件');
  const reason = normalizedReason(dto.reason, '请填写风险处理原因');
  const requestId = normalizedIdempotencyKey(dto.idempotencyKey);
  const target =
    action === 'REVIEW'
      ? RiskStatus.REVIEWING
      : action === 'RESOLVE'
        ? RiskStatus.RESOLVED
        : RiskStatus.DISMISSED;
  const auditAction = `RISK_EVENT_${target}`;
  const hash = commandHash({ kind: auditAction, riskId, reason });
  try {
    return await prisma.$transaction(
      async (tx) => {
        const replay = await findGovernanceCommandReplay(tx, requestId);
        if (replay) {
          assertGovernanceCommandReplay(replay, {
            actor,
            action: auditAction,
            objectType: 'RiskEvent',
            objectId: riskId,
            commandHash: hash,
          });
          const current = await tx.riskEvent.findUniqueOrThrow({
            where: { id: riskId },
          });
          return riskView(current);
        }
        const risk = await tx.riskEvent.findUnique({ where: { id: riskId } });
        if (!risk) throw new NotFoundException('风险事件不存在');
        const oldValue = { status: risk.status };
        const newValue = { commandHash: hash, status: target };
        if (risk.status === target) {
          if (requestId) {
            await writeGovernanceAudit(tx, {
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
          return riskView(risk);
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
        const changed = await tx.riskEvent.updateMany({
          where: { id: riskId, status: risk.status },
          data: {
            status: target,
            handling: {
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
        await writeGovernanceAudit(tx, {
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
        return riskView(updated);
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  } catch (error) {
    if (!isPrismaErrorCode(error, 'P2034')) throw error;
    const replay = await findGovernanceCommandReplay(prisma, requestId);
    if (replay) {
      assertGovernanceCommandReplay(replay, {
        actor,
        action: auditAction,
        objectType: 'RiskEvent',
        objectId: riskId,
        commandHash: hash,
      });
      const current = await prisma.riskEvent.findUniqueOrThrow({
        where: { id: riskId },
      });
      return riskView(current);
    }
    throw new ConflictException('风险事件刚刚由其他人员处理，请刷新后重试');
  }
}

export function riskView<T extends { evidence: unknown }>(risk: T): T {
  const view = riskEventView(risk);
  return { ...view, evidence: redactEvidence(view.evidence) } as T;
}
