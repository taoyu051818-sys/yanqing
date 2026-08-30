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
  AttendanceStatus,
  AuditResult,
  BookingStatus,
  BusinessType,
  FrontDeskShiftStatus,
  OrderStatus,
  PaymentStatus,
  Prisma,
  ReconciliationPeriodStatus,
  RefundStatus,
  RegistrationStatus,
  SettlementStatus,
  TrainingRecognitionType,
  TrainingSessionStatus,
} from '../generated/prisma/client.js';
import type { CloseReconciliationPeriodDto } from './reconciliation.dto.js';

const CLOSE_ROLES = [
  AppRole.FINANCE,
  AppRole.ADMIN,
  AppRole.SUPER_ADMIN,
] as const;
const PENDING_REFUNDS = [
  RefundStatus.REQUESTED,
  RefundStatus.APPROVED,
  RefundStatus.PROCESSING,
] as const;
const PENDING_PAYMENTS = [
  PaymentStatus.CREATED,
  PaymentStatus.PROCESSING,
] as const;
const FINAL_ORDER_STATUSES = [
  OrderStatus.PAID,
  OrderStatus.CHECKED_IN,
  OrderStatus.COMPLETED,
  OrderStatus.REFUND_PENDING,
  OrderStatus.PARTIALLY_REFUNDED,
  OrderStatus.REFUNDED,
] as const;

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

export interface ReconciliationTotals {
  orderPaidCents: number;
  orderRefundedCents: number;
  successfulPaymentCents: number;
  completedRefundCents: number;
  trainingEffectiveRevenueCents: number;
  trainingVenueContributionCents: number;
  trainingSettlementVenueContributionCents: number;
  allianceAttributedGmvCents: number;
  allianceCooperationFeeCents: number;
  consignmentPayableCents: number;
  consignmentSettledPayableCents: number;
  inventoryTransactionCount: number;
  inventoryCostCents: number;
}

export type ReconciliationBlockerKind =
  | 'PENDING_REFUNDS'
  | 'PENDING_PAYMENTS'
  | 'OPEN_FRONT_DESK_SHIFTS'
  | 'UNREVIEWED_CASH_VARIANCES'
  | 'UNFULFILLED_ORDERS'
  | 'UNFULFILLED_TRAINING_SESSIONS';

export interface ReconciliationBlocker {
  kind: ReconciliationBlockerKind;
  count: number;
  message: string;
}

export interface ReconciliationView {
  id?: string;
  businessDate: Date;
  status: ReconciliationPeriodStatus;
  totals: ReconciliationTotals | Record<string, unknown>;
  exceptionCount: number;
  closedById: string | null;
  closedAt: Date | null;
  detail: Record<string, unknown>;
  createdAt?: Date;
  updatedAt?: Date;
  blocked?: boolean;
  blockers?: ReconciliationBlocker[];
}

interface BusinessDay {
  label: string;
  start: Date;
  end: Date;
}

interface Snapshot {
  totals: ReconciliationTotals;
  blockers: ReconciliationBlocker[];
}

/**
 * Finance-facing business-day close.  A close is deliberately a snapshot and
 * state transition in one serializable transaction: pending money or
 * settlement work leaves the period in REVIEW, while a clean retry moves it
 * to LOCKED.  A LOCKED period is never recalculated or audited twice.
 */
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
      const snapshot = await this.snapshot(this.prisma, day);
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
    const snapshot = await this.snapshot(this.prisma, day);
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

          const snapshot = await this.snapshot(tx, day);
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

  private async snapshot(
    client: Pick<
      Prisma.TransactionClient,
      | 'refund'
      | 'payment'
      | 'allianceSettlement'
      | 'trainingSettlement'
      | 'consignmentSettlement'
      | 'consignmentPayableEntry'
      | 'order'
      | 'trainingSession'
      | 'trainingRevenueRecognition'
      | 'inventoryTransaction'
      | 'frontDeskShift'
    >,
    day: BusinessDay,
  ): Promise<Snapshot> {
    const [
      pendingRefunds,
      pendingPayments,
      openFrontDeskShifts,
      unreviewedCashVariances,
      unfulfilledOrders,
      unfulfilledTrainingSessions,
      orders,
      payments,
      refunds,
      recognitions,
      alliance,
      trainingSettlement,
      consignmentPayables,
      consignmentSettlements,
      inventory,
    ] = await Promise.all([
      // Daily close locks source-business evidence. Periodic settlements are
      // downstream finance work and remain visible in their workbench rather
      // than blocking every business day in a weekly/monthly cycle.
      client.refund.count({
        where: {
          requestedAt: { lt: day.end },
          status: { in: [...PENDING_REFUNDS] },
        },
      }),
      client.payment.count({
        where: {
          createdAt: { lt: day.end },
          status: { in: [...PENDING_PAYMENTS] },
        },
      }),
      client.frontDeskShift.count({
        where: {
          businessDate: day.start,
          status: FrontDeskShiftStatus.OPEN,
        },
      }),
      client.frontDeskShift.count({
        where: {
          businessDate: day.start,
          status: FrontDeskShiftStatus.CLOSED,
          cashVarianceCents: { not: 0 },
          varianceReviewedAt: null,
        },
      }),
      client.order.count({
        where: {
          businessType: {
            in: [BusinessType.VENUE, BusinessType.GAME, BusinessType.EVENT],
          },
          completedAt: null,
          status: {
            in: [
              OrderStatus.PAID,
              OrderStatus.CHECKED_IN,
              OrderStatus.COMPLETED,
              OrderStatus.REFUND_PENDING,
              OrderStatus.PARTIALLY_REFUNDED,
            ],
          },
          OR: [
            {
              businessType: BusinessType.VENUE,
              bookings: {
                some: {
                  endsAt: { lt: day.end },
                  status: {
                    in: [BookingStatus.CONFIRMED, BookingStatus.CHECKED_IN],
                  },
                },
              },
            },
            {
              businessType: BusinessType.GAME,
              gameRegistration: {
                is: {
                  status: {
                    in: [
                      RegistrationStatus.PAID,
                      RegistrationStatus.CHECKED_IN,
                    ],
                  },
                  game: { endsAt: { lt: day.end } },
                },
              },
            },
            {
              businessType: BusinessType.EVENT,
              eventTeam: {
                is: {
                  status: {
                    in: [
                      RegistrationStatus.PAID,
                      RegistrationStatus.CHECKED_IN,
                    ],
                  },
                  event: { startsAt: { lt: day.end } },
                },
              },
            },
          ],
        },
      }),
      client.trainingSession.count({
        where: {
          status: { not: TrainingSessionStatus.CANCELLED },
          endsAt: { lt: day.end },
          attendances: {
            some: {
              OR: [
                { status: AttendanceStatus.PENDING },
                {
                  status: AttendanceStatus.ATTENDED,
                  OR: [
                    { consumedSessions: 0 },
                    {
                      revenueRecognitions: {
                        none: {
                          type: TrainingRecognitionType.CONSUME,
                          reversedBy: { is: null },
                        },
                      },
                    },
                  ],
                },
              ],
            },
          },
        },
      }),
      client.order.aggregate({
        where: {
          paidAt: { gte: day.start, lt: day.end },
          status: { in: [...FINAL_ORDER_STATUSES] },
        },
        _sum: { paidCents: true, refundedCents: true },
      }),
      client.payment.aggregate({
        where: {
          paidAt: { gte: day.start, lt: day.end },
          status: { in: [PaymentStatus.SUCCEEDED, PaymentStatus.REFUNDED] },
        },
        _sum: { amountCents: true },
      }),
      client.refund.aggregate({
        where: {
          completedAt: { gte: day.start, lt: day.end },
          status: RefundStatus.SUCCEEDED,
        },
        _sum: { amountCents: true },
      }),
      client.trainingRevenueRecognition.aggregate({
        where: { createdAt: { gte: day.start, lt: day.end } },
        _sum: { effectiveRevenueCents: true, venueContributionCents: true },
      }),
      client.allianceSettlement.aggregate({
        where: {
          status: SettlementStatus.SETTLED,
          periodStart: { lt: day.end },
          periodEnd: { gt: day.start },
        },
        _sum: { attributedGmvCents: true, cooperationFeeCents: true },
      }),
      client.trainingSettlement.aggregate({
        where: {
          status: SettlementStatus.SETTLED,
          periodStart: { lt: day.end },
          periodEnd: { gt: day.start },
        },
        _sum: { venueContributionCents: true },
      }),
      client.consignmentPayableEntry.aggregate({
        where: { occurredAt: { gte: day.start, lt: day.end } },
        _sum: { payableCents: true },
      }),
      client.consignmentSettlement.aggregate({
        where: {
          status: SettlementStatus.SETTLED,
          settledAt: { gte: day.start, lt: day.end },
        },
        _sum: { payableCents: true },
      }),
      client.inventoryTransaction.findMany({
        where: { createdAt: { gte: day.start, lt: day.end } },
        select: { quantity: true, unitCostCents: true },
      }),
    ]);

    const blockers: ReconciliationBlocker[] = [];
    if (pendingRefunds > 0)
      blockers.push({
        kind: 'PENDING_REFUNDS',
        count: pendingRefunds,
        message: `有 ${pendingRefunds} 笔退款待处理`,
      });
    if (pendingPayments > 0)
      blockers.push({
        kind: 'PENDING_PAYMENTS',
        count: pendingPayments,
        message: `有 ${pendingPayments} 笔支付待处理`,
      });
    if (openFrontDeskShifts > 0)
      blockers.push({
        kind: 'OPEN_FRONT_DESK_SHIFTS',
        count: openFrontDeskShifts,
        message: `有 ${openFrontDeskShifts} 个前台班次尚未关班`,
      });
    if (unreviewedCashVariances > 0)
      blockers.push({
        kind: 'UNREVIEWED_CASH_VARIANCES',
        count: unreviewedCashVariances,
        message: `有 ${unreviewedCashVariances} 个现金差异尚未由财务复核`,
      });
    if (unfulfilledOrders > 0)
      blockers.push({
        kind: 'UNFULFILLED_ORDERS',
        count: unfulfilledOrders,
        message: `有 ${unfulfilledOrders} 笔已到期场地/球局/赛事订单尚未确认履约`,
      });
    if (unfulfilledTrainingSessions > 0)
      blockers.push({
        kind: 'UNFULFILLED_TRAINING_SESSIONS',
        count: unfulfilledTrainingSessions,
        message: `有 ${unfulfilledTrainingSessions} 节已结束培训课次尚未完成点名或消课`,
      });

    return {
      totals: {
        orderPaidCents: orders._sum.paidCents ?? 0,
        orderRefundedCents: orders._sum.refundedCents ?? 0,
        successfulPaymentCents: payments._sum.amountCents ?? 0,
        completedRefundCents: refunds._sum.amountCents ?? 0,
        trainingEffectiveRevenueCents:
          recognitions._sum.effectiveRevenueCents ?? 0,
        trainingVenueContributionCents:
          recognitions._sum.venueContributionCents ?? 0,
        trainingSettlementVenueContributionCents:
          trainingSettlement._sum.venueContributionCents ?? 0,
        allianceAttributedGmvCents: alliance._sum.attributedGmvCents ?? 0,
        allianceCooperationFeeCents: alliance._sum.cooperationFeeCents ?? 0,
        consignmentPayableCents: consignmentPayables._sum.payableCents ?? 0,
        consignmentSettledPayableCents:
          consignmentSettlements._sum.payableCents ?? 0,
        inventoryTransactionCount: inventory.length,
        // Inventory transactions carry a unit cost and a signed quantity.
        // Summing only unitCostCents under-reported multi-item movements and
        // made the close snapshot impossible to reconcile with the stock
        // ledger.  Use absolute quantity so both in/out movements contribute
        // their auditable cost value; the transaction type remains available
        // in the detailed inventory ledger for a net-cost interpretation.
        inventoryCostCents: inventory.reduce(
          (sum, item) =>
            sum + Math.abs(item.quantity) * (item.unitCostCents ?? 0),
          0,
        ),
      },
      blockers,
    };
  }

  private detail(
    day: BusinessDay,
    snapshot: Snapshot,
    reason?: string,
  ): Record<string, unknown> {
    return {
      businessDate: day.label,
      timezone: 'Asia/Shanghai',
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

function parseBusinessDay(input: string): BusinessDay {
  const match = DATE_PATTERN.exec(input);
  if (!match) throw new BadRequestException('业务日期必须为 YYYY-MM-DD');
  const start = new Date(`${input}T00:00:00+08:00`);
  const end = new Date(`${input}T24:00:00+08:00`);
  if (Number.isNaN(start.getTime()) || formatShanghaiDate(start) !== input) {
    throw new BadRequestException('业务日期无效');
  }
  return { label: input, start, end };
}

function formatShanghaiDate(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const values = Object.fromEntries(
    parts.map((part) => [part.type, part.value]),
  );
  return `${values.year}-${values.month}-${values.day}`;
}

function isUniqueConstraintError(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  );
}
