import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { calculateRoi } from '@yanqing/shared';
import type { AuthUser } from '../../common/auth/auth-user.js';
import type { PrismaService } from '../../database/prisma.service.js';
import {
  AppRole,
  Prisma,
  SettlementStatus,
} from '../../generated/prisma/client.js';
import type { ReviseAllianceSettlementDto } from '../alliance.dto.js';
import {
  allianceSettlementResponse,
  lifecycleCommandHash,
} from '../shared/alliance-support.js';
import { withWorkflowDetail } from './alliance-settlements.commands.js';

/** Revise the declared profit, retaining the original accounting source snapshot. */
export async function reviseSettlement(
  prisma: PrismaService,
  id: string,
  dto: ReviseAllianceSettlementDto,
  actor: AuthUser,
) {
  if (
    !actor.roles.some((role) =>
      [AppRole.FINANCE, AppRole.ADMIN, AppRole.SUPER_ADMIN].includes(
        role as never,
      ),
    )
  )
    throw new ForbiddenException('仅财务或管理员可更正结算单');
  const reason = dto.reason.trim();
  const idempotencyKey = dto.idempotencyKey.trim();
  if (
    reason.length < 2 ||
    reason.length > 300 ||
    idempotencyKey.length < 8 ||
    idempotencyKey.length > 100
  )
    throw new BadRequestException('更正原因或幂等键长度无效');
  if (
    !Number.isSafeInteger(dto.attributedGrossProfitCents) ||
    dto.attributedGrossProfitCents < 0 ||
    dto.attributedGrossProfitCents > 2147483647
  )
    throw new BadRequestException('归因毛利金额无效');
  const commandHash = lifecycleCommandHash({
    id,
    actorId: actor.sub,
    reason,
    attributedGrossProfitCents: dto.attributedGrossProfitCents,
  });
  try {
    return await prisma.$transaction(
      async (tx) => {
        const current = await tx.allianceSettlement.findUnique({
          where: { id },
        });
        if (!current) throw new NotFoundException('联盟结算单不存在');
        const detail = withWorkflowDetail(current.detail, {
          action: 'ALLIANCE_SETTLEMENT_REVISED',
          state: SettlementStatus.DRAFT,
          reason,
          actorId: actor.sub,
          at: new Date().toISOString(),
        });
        const revisions = Array.isArray(detail.revisionHistory)
          ? (detail.revisionHistory as Array<Record<string, unknown>>)
          : [];
        const replay = revisions.find(
          (revision) => revision.idempotencyKey === idempotencyKey,
        );
        if (replay) {
          if (replay.commandHash !== commandHash)
            throw new ConflictException('更正幂等键已用于不同命令');
          return allianceSettlementResponse(current);
        }
        if (current.status !== SettlementStatus.DRAFT)
          throw new ConflictException('仅草稿或争议退回的结算单可以更正');
        const roi = calculateRoi(
          dto.attributedGrossProfitCents,
          current.cooperationFeeCents,
        );
        const before = {
          attributedGrossProfitCents: current.attributedGrossProfitCents,
          roi: current.roi?.toString() ?? null,
        };
        const after = {
          attributedGrossProfitCents: dto.attributedGrossProfitCents,
          roi,
        };
        detail.revisionHistory = [
          ...revisions,
          {
            version: revisions.length + 1,
            idempotencyKey,
            commandHash,
            actorId: actor.sub,
            reason,
            at: new Date().toISOString(),
            before,
            after,
          },
        ];
        const changed = await tx.allianceSettlement.updateMany({
          where: {
            id,
            status: SettlementStatus.DRAFT,
            updatedAt: current.updatedAt,
          },
          data: { ...after, detail: detail as Prisma.InputJsonObject },
        });
        if (changed.count !== 1)
          throw new ConflictException('结算单已变化，请刷新后重试更正');
        await tx.auditLog.create({
          data: {
            actorId: actor.sub,
            actorRole: actor.roles[0],
            action: 'ALLIANCE_SETTLEMENT_REVISED',
            objectType: 'AllianceSettlement',
            objectId: id,
            reason,
            oldValue: before,
            newValue: { ...after, revision: revisions.length + 1 },
          },
        });
        return allianceSettlementResponse(
          await tx.allianceSettlement.findUniqueOrThrow({ where: { id } }),
        );
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2034'
    )
      throw new ConflictException('结算单发生并发更正，请使用原命令重试');
    throw error;
  }
}
