import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { calculateRoi } from '@yanqing/shared';
import type { AuthUser } from '../../common/auth/auth-user.js';
import { PrismaService } from '../../database/prisma.service.js';
import {
  AppRole,
  Prisma,
  SettlementStatus,
} from '../../generated/prisma/client.js';
import type {
  AllianceSettlementDto,
  SettlementActionDto,
} from '../alliance.dto.js';
import { allianceSettlementResponse } from '../shared/alliance-support.js';
import { assertMerchantAccess } from '../shared/alliance-policy.js';

export async function createSettlement(
  prisma: PrismaService,
  dto: AllianceSettlementDto,
  actor: AuthUser,
) {
  const periodStart = new Date(dto.periodStart);
  const periodEnd = new Date(dto.periodEnd);
  if (
    !Number.isFinite(periodStart.getTime()) ||
    !Number.isFinite(periodEnd.getTime()) ||
    periodEnd <= periodStart
  )
    throw new BadRequestException('结算周期无效');
  const uniqueWhere = {
    merchantId_periodStart_periodEnd: {
      merchantId: dto.merchantId,
      periodStart,
      periodEnd,
    },
  };
  const overlapWhere = {
    merchantId: dto.merchantId,
    status: { not: SettlementStatus.VOID },
    periodStart: { lt: periodEnd },
    periodEnd: { gt: periodStart },
  };
  const replay = (existing: { attributedGrossProfitCents: number }) => {
    if (existing.attributedGrossProfitCents !== dto.attributedGrossProfitCents)
      throw new ConflictException(
        '该商户结算周期已生成，利润口径不同，请在草稿结算单中执行更正',
      );
    return allianceSettlementResponse(existing);
  };
  try {
    return await prisma.$transaction(
      async (tx) => {
        const existing = await tx.allianceSettlement.findUnique({
          where: uniqueWhere,
        });
        if (existing) return replay(existing);
        if (
          await tx.allianceSettlement.findFirst({
            where: overlapWhere,
            select: { id: true },
          })
        )
          throw new ConflictException(
            '该商户已有重叠账期的结算单，请核对起止时间',
          );
        const merchant = await tx.merchant.findUnique({
          where: { id: dto.merchantId },
        });
        if (!merchant) throw new NotFoundException('商户不存在');
        const codes = await tx.couponCode.findMany({
          where: {
            template: { merchantId: dto.merchantId },
            createdAt: { lt: periodEnd },
            OR: [
              { redeemedAt: { gte: periodStart, lt: periodEnd } },
              { claimedAt: { gte: periodStart, lt: periodEnd } },
              { createdAt: { gte: periodStart, lt: periodEnd } },
            ],
          },
          include: { holder: { include: { memberProfile: true } } },
        });
        const issuedCount = codes.filter(
          (code) => code.createdAt >= periodStart,
        ).length;
        const claimedCount = codes.filter(
          (code) =>
            code.claimedAt &&
            code.claimedAt >= periodStart &&
            code.claimedAt < periodEnd,
        ).length;
        const redeemed = codes.filter(
          (code) =>
            code.redeemedAt &&
            code.redeemedAt >= periodStart &&
            code.redeemedAt < periodEnd,
        );
        const effectiveNewCustomers = new Set(
          redeemed
            .filter((code) => code.holder?.memberProfile?.isNewCustomer)
            .map((code) => code.holderId),
        ).size;
        const attributedGmvCents = redeemed.reduce(
          (sum, code) => sum + code.attributedAmountCents,
          0,
        );
        const cooperationFeeCents = computeCooperationFee(
          merchant.settlementRule,
          redeemed.length,
          effectiveNewCustomers,
        );
        const roi = calculateRoi(
          dto.attributedGrossProfitCents,
          cooperationFeeCents,
        );

        const settlement = await tx.allianceSettlement.create({
          data: {
            merchantId: dto.merchantId,
            periodStart,
            periodEnd,
            issuedCount,
            claimedCount,
            redeemedCount: redeemed.length,
            effectiveNewCustomers,
            attributedGmvCents,
            attributedGrossProfitCents: dto.attributedGrossProfitCents,
            cooperationFeeCents,
            roi,
            status: SettlementStatus.DRAFT,
            detail: {
              codeIds: redeemed.map((code) => code.id),
              settlementRule: merchant.settlementRule,
            },
          },
        });
        await tx.auditLog.create({
          data: {
            actorId: actor.sub,
            actorRole: actor.roles[0],
            action: 'ALLIANCE_SETTLEMENT_CREATED',
            objectType: 'AllianceSettlement',
            objectId: settlement.id,
            newValue: {
              redeemedCount: redeemed.length,
              cooperationFeeCents,
              roi,
            } as never,
          },
        });
        return allianceSettlementResponse(settlement);
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  } catch (error) {
    // Resolve unique/exclusion races outside the rolled-back transaction.
    // The PostgreSQL exclusion constraint also protects non-service writers.
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      const duplicate = await prisma.allianceSettlement.findUnique({
        where: uniqueWhere,
      });
      if (duplicate) return replay(duplicate);
      if (
        await prisma.allianceSettlement.findFirst({
          where: overlapWhere,
          select: { id: true },
        })
      )
        throw new ConflictException(
          '该商户已有重叠账期的结算单，请核对起止时间',
        );
      if (error.code === 'P2034')
        throw new ConflictException('联盟结算发生并发冲突，请刷新后重试');
    }
    throw error;
  }
}

export async function listSettlements(prisma: PrismaService, actor: AuthUser) {
  const privilegedRoles = new Set<AppRole>([
    AppRole.FINANCE,
    AppRole.ADMIN,
    AppRole.SUPER_ADMIN,
  ]);
  const isMerchantOnly =
    actor.roles.includes(AppRole.MERCHANT) &&
    !actor.roles.some((role) => privilegedRoles.has(role));
  const merchantIds = isMerchantOnly
    ? ((
        await prisma.userRole.findMany({
          where: { userId: actor.sub, role: AppRole.MERCHANT },
          select: { merchantId: true },
        })
      )
        .map((role) => role.merchantId)
        .filter(Boolean) as string[])
    : undefined;

  const settlements = await prisma.allianceSettlement.findMany({
    where: merchantIds ? { merchantId: { in: merchantIds } } : undefined,
    include: { merchant: { select: { id: true, name: true, code: true } } },
    orderBy: [{ periodEnd: 'desc' }, { createdAt: 'desc' }],
  });
  return settlements.map(allianceSettlementResponse);
}

export function submitSettlement(
  prisma: PrismaService,
  id: string,
  actor: AuthUser,
) {
  return transitionSettlement(prisma, {
    id,
    actor,
    from: SettlementStatus.DRAFT,
    to: SettlementStatus.PENDING_CONFIRMATION,
    action: 'ALLIANCE_SETTLEMENT_SUBMITTED',
  });
}

export function confirmSettlement(
  prisma: PrismaService,
  id: string,
  actor: AuthUser,
) {
  return transitionSettlement(prisma, {
    id,
    actor,
    from: SettlementStatus.PENDING_CONFIRMATION,
    to: SettlementStatus.CONFIRMED,
    action: 'ALLIANCE_SETTLEMENT_CONFIRMED',
    requireMerchantScope: true,
    data: { confirmedAt: new Date() },
  });
}

export async function disputeSettlement(
  prisma: PrismaService,
  id: string,
  dto: SettlementActionDto,
  actor: AuthUser,
) {
  const reason = dto.reason?.trim();
  if (!reason) throw new BadRequestException('提出争议必须填写原因');
  return transitionSettlement(prisma, {
    id,
    actor,
    from: SettlementStatus.PENDING_CONFIRMATION,
    to: SettlementStatus.DRAFT,
    action: 'ALLIANCE_SETTLEMENT_DISPUTED',
    requireMerchantScope: true,
    reason,
  });
}

export function settleSettlement(
  prisma: PrismaService,
  id: string,
  actor: AuthUser,
) {
  return transitionSettlement(prisma, {
    id,
    actor,
    from: SettlementStatus.CONFIRMED,
    to: SettlementStatus.SETTLED,
    action: 'ALLIANCE_SETTLEMENT_SETTLED',
    data: { settledAt: new Date() },
  });
}

export async function transitionSettlement(
  prisma: PrismaService,
  input: {
    id: string;
    actor: AuthUser;
    from: SettlementStatus;
    to: SettlementStatus;
    action: string;
    data?: Record<string, unknown>;
    reason?: string;
    requireMerchantScope?: boolean;
  },
) {
  return prisma.$transaction(async (tx) => {
    const current = await tx.allianceSettlement.findUnique({
      where: { id: input.id },
    });
    if (!current) throw new NotFoundException('联盟结算单不存在');
    if (input.requireMerchantScope) {
      await assertMerchantAccess(
        prisma,
        current.merchantId,
        input.actor,
        '只能操作本商户的结算单',
      );
    }
    // A retried request is safe and returns the already-posted state.  This
    // is important for mobile clients that retry after a weak-network
    // timeout.
    if (current.status === input.to) return allianceSettlementResponse(current);
    if (current.status !== input.from) {
      throw new ConflictException(
        `联盟结算单当前状态为 ${current.status}，不能执行${input.action}`,
      );
    }

    const detail = withWorkflowDetail(current.detail, {
      state: input.to,
      action: input.action,
      reason: input.reason,
      actorId: input.actor.sub,
      at: new Date().toISOString(),
    });
    const changed = await tx.allianceSettlement.updateMany({
      where: { id: input.id, status: input.from },
      data: {
        status: input.to,
        detail: detail as never,
        ...input.data,
      },
    });
    if (changed.count !== 1) {
      const latest = await tx.allianceSettlement.findUnique({
        where: { id: input.id },
      });
      if (latest?.status === input.to)
        return allianceSettlementResponse(latest);
      throw new ConflictException('联盟结算单已被其他操作更新，请刷新后重试');
    }
    const updated = await tx.allianceSettlement.findUniqueOrThrow({
      where: { id: input.id },
    });
    await tx.auditLog.create({
      data: {
        actorId: input.actor.sub,
        actorRole: input.actor.roles[0],
        action: input.action,
        objectType: 'AllianceSettlement',
        objectId: input.id,
        oldValue: { status: input.from } as never,
        newValue: { status: input.to, reason: input.reason } as never,
        reason: input.reason,
      },
    });
    return allianceSettlementResponse(updated);
  });
}

export function withWorkflowDetail(
  value: Prisma.JsonValue,
  workflow: Record<string, unknown>,
): Record<string, unknown> {
  const base =
    value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const history = Array.isArray(base.workflowHistory)
    ? base.workflowHistory
    : [];
  return {
    ...base,
    workflowState: workflow.state,
    workflowHistory: [...history, workflow],
  };
}

export function computeCooperationFee(
  rule: Prisma.JsonValue,
  redeemedCount: number,
  effectiveNewCustomers: number,
): number {
  if (!rule || typeof rule !== 'object' || Array.isArray(rule)) return 0;
  const mode = typeof rule.mode === 'string' ? rule.mode : 'NONE';
  const configuredAmount =
    typeof rule.amountCents === 'number' ? rule.amountCents : rule.feeCents;
  const amount =
    typeof configuredAmount === 'number'
      ? Math.max(0, Math.round(configuredAmount))
      : 0;
  if (mode === 'FIXED') return amount;
  if (mode === 'PER_REDEMPTION') return amount * redeemedCount;
  if (mode === 'PER_NEW_CUSTOMER') return amount * effectiveNewCustomers;
  return 0;
}
