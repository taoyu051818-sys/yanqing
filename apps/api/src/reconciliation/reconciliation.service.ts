import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import type { AuthUser } from '../common/auth/auth-user.js';
import { PrismaService } from '../database/prisma.service.js';
import {
  AppRole,
  AuditResult,
  Prisma,
  ReconciliationPeriodStatus,
} from '../generated/prisma/client.js';
import type { CloseReconciliationPeriodDto } from './reconciliation.dto.js';
import {
  CLOSE_ROLES,
  ReconciliationTotals,
  ReconciliationBlocker,
  ReconciliationView,
  BusinessDay,
  Snapshot,
  parseBusinessDay,
  isUniqueConstraintError,
} from './reconciliation-policy.js';
import { snapshot as loadReconciliationSnapshot } from './reconciliation-snapshot.js';

@Injectable()
export class ReconciliationService {
  constructor(private readonly prisma: PrismaService) {}

  async get(date: string, actor: AuthUser): Promise<ReconciliationView> {
    this.assertRole(actor);
    const day = parseBusinessDay(date);
    const existing = await this.prisma.reconciliationPeriod.findUnique({
      where: { businessDate: day.start },
    });
    if (existing?.status === ReconciliationPeriodStatus.LOCKED)
      return this.toView(existing, false, []);

    // REVIEW is a live exception queue, not a frozen report. Recalculate it
    // on every read so the finance screen immediately reflects a refund or
    // settlement that was resolved after the last close attempt. The row is
    // not mutated here; only an explicit close command can lock the period.
    if (existing) {
      const snapshot = await loadReconciliationSnapshot(this.prisma, day);
      const blocked = snapshot.blockers.length > 0;
      return this.toView(
        {
          ...existing,
          status: blocked
            ? ReconciliationPeriodStatus.REVIEW
            : ReconciliationPeriodStatus.OPEN,
          totals: snapshot.totals,
          exceptionCount: snapshot.blockers.length,
          detail: this.detail(day, snapshot, undefined),
        },
        blocked,
        snapshot.blockers,
      );
    }

    // A read of an uninitialised day is useful to the B-end review screen, but
    // does not create a row (and therefore does not produce audit noise).
    const snapshot = await loadReconciliationSnapshot(this.prisma, day);
    return {
      businessDate: day.start,
      status: snapshot.blockers.length
        ? ReconciliationPeriodStatus.REVIEW
        : ReconciliationPeriodStatus.OPEN,
      totals: snapshot.totals,
      exceptionCount: snapshot.blockers.length,
      closedById: null,
      closedAt: null,
      detail: this.detail(day, snapshot, undefined),
      blocked: snapshot.blockers.length > 0,
      blockers: snapshot.blockers,
    };
  }

  async close(
    date: string,
    dto: CloseReconciliationPeriodDto | undefined,
    actor: AuthUser,
  ): Promise<ReconciliationView> {
    this.assertRole(actor);
    const day = parseBusinessDay(date);
    if (day.end.getTime() > Date.now()) {
      throw new BadRequestException(
        '营业日结束后才可关账；当天数据请使用实时日结预览',
      );
    }
    const reason = dto?.reason?.trim() || undefined;
    const actorRole =
      actor.roles.find((role) =>
        (CLOSE_ROLES as readonly AppRole[]).includes(role),
      ) ?? actor.roles[0];

    try {
      return await this.prisma.$transaction(
        async (tx) => {
          const existing = await tx.reconciliationPeriod.findUnique({
            where: { businessDate: day.start },
          });

          // Once locked, repeated taps/retries are safe and produce no second
          // audit event or changed totals.
          if (existing?.status === ReconciliationPeriodStatus.LOCKED) {
            return this.toView(existing, false, []);
          }

          const snapshot = await loadReconciliationSnapshot(tx, day);
          const detail = this.detail(day, snapshot, reason);

          if (snapshot.blockers.length > 0) {
            const reviewed = existing
              ? await tx.reconciliationPeriod.updateMany({
                  where: {
                    id: existing.id,
                    status: {
                      in: [
                        ReconciliationPeriodStatus.OPEN,
                        ReconciliationPeriodStatus.REVIEW,
                      ],
                    },
                  },
                  data: {
                    status: ReconciliationPeriodStatus.REVIEW,
                    totals: snapshot.totals as never,
                    exceptionCount: snapshot.blockers.length,
                    closedById: null,
                    closedAt: null,
                    detail: detail as never,
                  },
                })
              : { count: 0 };

            let period = existing;
            if (!existing) {
              period = await tx.reconciliationPeriod.create({
                data: {
                  businessDate: day.start,
                  status: ReconciliationPeriodStatus.REVIEW,
                  totals: snapshot.totals as never,
                  exceptionCount: snapshot.blockers.length,
                  detail: detail as never,
                },
              });
            } else if (reviewed.count === 0) {
              // Another worker may have completed the transition while this
              // transaction was running.  Return its current state instead of
              // emitting a duplicate blocked audit entry.
              const latest = await tx.reconciliationPeriod.findUniqueOrThrow({
                where: { id: existing.id },
              });
              if (latest.status === ReconciliationPeriodStatus.LOCKED)
                return this.toView(latest, false, []);
              return this.toView(
                latest,
                latest.status === ReconciliationPeriodStatus.REVIEW,
                latest.status === ReconciliationPeriodStatus.REVIEW
                  ? snapshot.blockers
                  : [],
              );
            } else {
              period = await tx.reconciliationPeriod.findUniqueOrThrow({
                where: { id: existing.id },
              });
            }

            await tx.auditLog.create({
              data: {
                actorId: actor.sub,
                actorRole,
                action: 'RECONCILIATION_PERIOD_BLOCKED',
                objectType: 'ReconciliationPeriod',
                objectId: period.id,
                reason,
                result: AuditResult.FAILURE,
                newValue: {
                  status: ReconciliationPeriodStatus.REVIEW,
                  blockers: snapshot.blockers,
                } as never,
              },
            });
            return this.toView(period, true, snapshot.blockers);
          }

          const now = new Date();
          let period = existing;
          if (!existing) {
            period = await tx.reconciliationPeriod.create({
              data: {
                businessDate: day.start,
                status: ReconciliationPeriodStatus.LOCKED,
                totals: snapshot.totals as never,
                exceptionCount: 0,
                closedById: actor.sub,
                closedAt: now,
                detail: detail as never,
              },
            });
          } else {
            const changed = await tx.reconciliationPeriod.updateMany({
              where: {
                id: existing.id,
                status: {
                  in: [
                    ReconciliationPeriodStatus.OPEN,
                    ReconciliationPeriodStatus.REVIEW,
                  ],
                },
              },
              data: {
                status: ReconciliationPeriodStatus.LOCKED,
                totals: snapshot.totals as never,
                exceptionCount: 0,
                closedById: actor.sub,
                closedAt: now,
                detail: detail as never,
              },
            });
            if (changed.count === 0) {
              const latest = await tx.reconciliationPeriod.findUniqueOrThrow({
                where: { id: existing.id },
              });
              if (latest.status === ReconciliationPeriodStatus.LOCKED)
                return this.toView(latest, false, []);
              throw new ConflictException('关账状态已变化，请刷新后重试');
            }
            period = await tx.reconciliationPeriod.findUniqueOrThrow({
              where: { id: existing.id },
            });
          }

          await tx.auditLog.create({
            data: {
              actorId: actor.sub,
              actorRole,
              action: 'RECONCILIATION_PERIOD_CLOSED',
              objectType: 'ReconciliationPeriod',
              objectId: period.id,
              reason,
              result: AuditResult.SUCCESS,
              newValue: {
                status: ReconciliationPeriodStatus.LOCKED,
                totals: snapshot.totals,
              } as never,
            },
          });
          return this.toView(period, false, []);
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      // A concurrent first close can race on the businessDate unique key.  A
      // retry is safe because the persisted row is itself the idempotency key.
      if (isUniqueConstraintError(error)) {
        const latest = await this.prisma.reconciliationPeriod.findUnique({
          where: { businessDate: day.start },
        });
        if (latest) {
          if (latest.status === ReconciliationPeriodStatus.LOCKED)
            return this.toView(latest, false, []);
          return this.close(date, dto, actor);
        }
      }
      throw error;
    }
  }

  private assertRole(actor: AuthUser): void {
    if (
      !actor.roles.some((role) =>
        (CLOSE_ROLES as readonly AppRole[]).includes(role),
      )
    ) {
      throw new ForbiddenException('仅财务或管理员可执行日结/账期关账');
    }
  }

  private detail(
    day: BusinessDay,
    snapshot: Snapshot,
    reason?: string,
  ): Record<string, unknown> {
    return {
      businessDate: day.label,
      timezone: 'Asia/Shanghai',
      settlementBasis: 'SETTLED_AT_V2',
      settlementDefinition:
        '培训及联盟结算金额按实际入账日统计一次，不按结算覆盖周期重复计入。',
      generatedAt: new Date().toISOString(),
      blockers: snapshot.blockers,
      ...(reason ? { reason } : {}),
    };
  }

  private toView(
    period: {
      id: string;
      businessDate: Date;
      status: ReconciliationPeriodStatus;
      totals: unknown;
      exceptionCount: number;
      closedById: string | null;
      closedAt: Date | null;
      detail: unknown;
      createdAt?: Date;
      updatedAt?: Date;
    },
    blocked?: boolean,
    blockers?: ReconciliationBlocker[],
  ): ReconciliationView {
    return {
      id: period.id,
      businessDate: period.businessDate,
      status: period.status,
      totals: period.totals as ReconciliationTotals,
      exceptionCount: period.exceptionCount,
      closedById: period.closedById,
      closedAt: period.closedAt,
      detail: (period.detail || {}) as Record<string, unknown>,
      createdAt: period.createdAt,
      updatedAt: period.updatedAt,
      blocked,
      blockers,
    };
  }
}
export type {
  ReconciliationTotals,
  ReconciliationBlockerKind,
  ReconciliationBlocker,
  ReconciliationView,
} from './reconciliation-policy.js';
