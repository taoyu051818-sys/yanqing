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
  BookingStatus,
  BusinessType,
  FrontDeskShiftStatus,
  OrderStatus,
  PaymentChannel,
  PaymentStatus,
  Prisma,
  RefundStatus,
} from '../generated/prisma/client.js';
import type {
  CloseFrontDeskShiftDto,
  FrontDeskShiftHistoryQueryDto,
  OpenFrontDeskShiftDto,
  ReviewFrontDeskShiftVarianceDto,
} from './frontdesk-shifts.dto.js';
import {
  MAIN_VENUE_CODE,
  shanghaiBusinessDay,
  type BusinessDay,
} from './frontdesk-shift-gate.js';

const SHIFT_ROLES = [
  AppRole.FRONT_DESK,
  AppRole.ADMIN,
  AppRole.SUPER_ADMIN,
] as const;
const ADMIN_ROLES = [AppRole.ADMIN, AppRole.SUPER_ADMIN] as const;
const VARIANCE_REVIEW_ROLES = [
  AppRole.FINANCE,
  AppRole.ADMIN,
  AppRole.SUPER_ADMIN,
] as const;
const SHIFT_HISTORY_ROLES = [
  AppRole.FRONT_DESK,
  AppRole.FINANCE,
  AppRole.ADMIN,
  AppRole.SUPER_ADMIN,
] as const;
const PENDING_ORDER_STATUSES = [
  OrderStatus.PENDING,
  OrderStatus.PAID,
  OrderStatus.CHECKED_IN,
  OrderStatus.REFUND_PENDING,
  OrderStatus.PARTIALLY_REFUNDED,
] as const;
const PENDING_REFUND_STATUSES = [
  RefundStatus.REQUESTED,
  RefundStatus.APPROVED,
  RefundStatus.PROCESSING,
  RefundStatus.FAILED,
] as const;
const PENDING_PAYMENT_STATUSES = [
  PaymentStatus.CREATED,
  PaymentStatus.PROCESSING,
  PaymentStatus.FAILED,
] as const;

const shiftInclude = {
  operator: { select: { id: true, displayName: true } },
  openedBy: { select: { id: true, displayName: true } },
  closedBy: { select: { id: true, displayName: true } },
  varianceReviewedBy: { select: { id: true, displayName: true } },
} satisfies Prisma.FrontDeskShiftInclude;

interface ShiftSnapshot {
  expectedCashCents: number;
  cashVarianceCents: number;
  pendingSnapshot: Prisma.InputJsonValue;
}

export { shanghaiBusinessDay } from './frontdesk-shift-gate.js';

@Injectable()
export class FrontDeskShiftsService {
  constructor(private readonly prisma: PrismaService) {}

  current(actor: AuthUser) {
    this.assertRole(actor);
    const day = shanghaiBusinessDay();
    return this.prisma.frontDeskShift.findFirst({
      where: {
        businessDate: day.start,
        venueCode: MAIN_VENUE_CODE,
        operatorId: actor.sub,
      },
      include: shiftInclude,
    });
  }

  history(query: FrontDeskShiftHistoryQueryDto, actor: AuthUser) {
    this.assertHistoryRole(actor);
    const canSeeAll = actor.roles.some((role) =>
      (VARIANCE_REVIEW_ROLES as readonly AppRole[]).includes(role),
    );
    return this.prisma.frontDeskShift.findMany({
      where: {
        venueCode: MAIN_VENUE_CODE,
        status: query.status,
        operatorId: canSeeAll ? query.operatorId : actor.sub,
      },
      include: shiftInclude,
      orderBy: [{ businessDate: 'desc' }, { openedAt: 'desc' }],
      take: query.limit,
    });
  }

  async open(dto: OpenFrontDeskShiftDto, actor: AuthUser) {
    this.assertRole(actor);
    if (
      !Number.isSafeInteger(dto.openingCashCents) ||
      dto.openingCashCents < 0
    ) {
      throw new BadRequestException('开班备用金必须为非负整数分');
    }
    const day = shanghaiBusinessDay();
    const role = this.actorRole(actor);

    try {
      return await this.prisma.$transaction(
        async (tx) => {
          const existing = await tx.frontDeskShift.findFirst({
            where: {
              businessDate: day.start,
              venueCode: MAIN_VENUE_CODE,
              operatorId: actor.sub,
            },
            include: shiftInclude,
          });
          if (existing) return this.replayOpen(existing, dto.openingCashCents);

          const opened = await tx.frontDeskShift.create({
            data: {
              businessDate: day.start,
              venueCode: MAIN_VENUE_CODE,
              operatorId: actor.sub,
              openedById: actor.sub,
              openingCashCents: dto.openingCashCents,
            },
            include: shiftInclude,
          });
          await tx.auditLog.create({
            data: {
              actorId: actor.sub,
              actorRole: role,
              action: 'FRONT_DESK_SHIFT_OPENED',
              objectType: 'FrontDeskShift',
              objectId: opened.id,
              newValue: {
                businessDate: day.label,
                venueCode: MAIN_VENUE_CODE,
                operatorId: actor.sub,
                openingCashCents: dto.openingCashCents,
              },
            },
          });
          return opened;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const concurrent = await this.prisma.frontDeskShift.findFirst({
          where: {
            businessDate: day.start,
            venueCode: MAIN_VENUE_CODE,
            operatorId: actor.sub,
          },
          include: shiftInclude,
        });
        if (concurrent)
          return this.replayOpen(concurrent, dto.openingCashCents);
      }
      throw error;
    }
  }

  async close(id: string, dto: CloseFrontDeskShiftDto, actor: AuthUser) {
    this.assertRole(actor);
    if (
      !Number.isSafeInteger(dto.closingCashCents) ||
      dto.closingCashCents < 0
    ) {
      throw new BadRequestException('关班现金实点必须为非负整数分');
    }
    const handoverNote = dto.handoverNote.trim();
    if (handoverNote.length < 2 || handoverNote.length > 1000) {
      throw new BadRequestException('交接备注长度必须为2-1000个字符');
    }
    const closeReason = dto.reason?.trim() || undefined;
    if (closeReason && (closeReason.length < 2 || closeReason.length > 300)) {
      throw new BadRequestException('代关原因长度必须为2-300个字符');
    }
    const role = this.actorRole(actor);

    return this.prisma.$transaction(
      async (tx) => {
        const shift = await tx.frontDeskShift.findUnique({
          where: { id },
          include: shiftInclude,
        });
        if (!shift) throw new NotFoundException('前台班次不存在');
        const delegated = shift.operatorId !== actor.sub;
        if (delegated && !this.isAdministrator(actor)) {
          throw new ForbiddenException('只能关闭自己的前台班次');
        }
        if (delegated && !closeReason) {
          throw new BadRequestException('管理员代关班次必须填写原因');
        }
        if (shift.status === FrontDeskShiftStatus.CLOSED) {
          return this.replayClose(
            shift,
            actor.sub,
            dto.closingCashCents,
            handoverNote,
            closeReason,
          );
        }

        const day: BusinessDay = {
          label: this.businessDateLabel(shift.businessDate),
          start: shift.businessDate,
          end: new Date(shift.businessDate.getTime() + 86_400_000),
        };
        const snapshot = await this.snapshot(
          tx,
          shift.operatorId,
          shift.openingCashCents,
          dto.closingCashCents,
          day,
        );
        const cashVarianceCents = snapshot.cashVarianceCents;
        const closedAt = new Date();
        const updated = await tx.frontDeskShift.updateMany({
          where: { id: shift.id, status: FrontDeskShiftStatus.OPEN },
          data: {
            status: FrontDeskShiftStatus.CLOSED,
            closedAt,
            closingCashCents: dto.closingCashCents,
            expectedCashCents: snapshot.expectedCashCents,
            cashVarianceCents,
            handoverNote,
            closeReason,
            pendingSnapshot: snapshot.pendingSnapshot,
            closedById: actor.sub,
          },
        });
        if (updated.count !== 1) {
          const concurrent = await tx.frontDeskShift.findUnique({
            where: { id: shift.id },
            include: shiftInclude,
          });
          if (concurrent?.status === FrontDeskShiftStatus.CLOSED) {
            return this.replayClose(
              concurrent,
              actor.sub,
              dto.closingCashCents,
              handoverNote,
              closeReason,
            );
          }
          throw new ConflictException('班次状态已变化，请刷新后重试');
        }
        await tx.auditLog.create({
          data: {
            actorId: actor.sub,
            actorRole: role,
            action: 'FRONT_DESK_SHIFT_CLOSED',
            objectType: 'FrontDeskShift',
            objectId: shift.id,
            oldValue: { status: shift.status },
            newValue: {
              status: FrontDeskShiftStatus.CLOSED,
              operatorId: shift.operatorId,
              closedById: actor.sub,
              closingCashCents: dto.closingCashCents,
              expectedCashCents: snapshot.expectedCashCents,
              cashVarianceCents,
              pendingSnapshot: snapshot.pendingSnapshot,
            },
            reason: delegated ? closeReason : handoverNote,
          },
        });
        return tx.frontDeskShift.findUniqueOrThrow({
          where: { id: shift.id },
          include: shiftInclude,
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  async reviewVariance(
    id: string,
    dto: ReviewFrontDeskShiftVarianceDto,
    actor: AuthUser,
  ) {
    this.assertVarianceReviewer(actor);
    const reviewReason = dto.reason?.trim() || null;
    if (reviewReason && (reviewReason.length < 2 || reviewReason.length > 300)) {
      throw new BadRequestException('差异复核原因长度必须为2-300个字符');
    }

    return this.prisma.$transaction(
      async (tx) => {
        const shift = await tx.frontDeskShift.findUnique({
          where: { id },
          include: shiftInclude,
        });
        if (!shift) throw new NotFoundException('前台班次不存在');
        if (shift.status !== FrontDeskShiftStatus.CLOSED) {
          throw new ConflictException('班次尚未关闭，不能复核现金差异');
        }
        if (shift.varianceReviewedById) {
          const exactReplay =
            shift.varianceReviewedById === actor.sub &&
            (shift.varianceReviewReason ?? null) === reviewReason;
          if (exactReplay) return shift;
          throw new ConflictException('现金差异已经由其他复核结果处理');
        }
        if (shift.operatorId === actor.sub || shift.closedById === actor.sub) {
          throw new ForbiddenException('班次操作人与关班人不能复核自己的现金差异');
        }
        if ((shift.cashVarianceCents ?? 0) !== 0 && !reviewReason) {
          throw new BadRequestException('非零现金差异必须填写复核原因');
        }
        const reviewedAt = new Date();
        const changed = await tx.frontDeskShift.updateMany({
          where: {
            id,
            status: FrontDeskShiftStatus.CLOSED,
            varianceReviewedById: null,
          },
          data: {
            varianceReviewedById: actor.sub,
            varianceReviewedAt: reviewedAt,
            varianceReviewReason: reviewReason,
          },
        });
        if (changed.count !== 1) {
          const concurrent = await tx.frontDeskShift.findUnique({
            where: { id },
            include: shiftInclude,
          });
          if (
            concurrent?.varianceReviewedById === actor.sub &&
            (concurrent.varianceReviewReason ?? null) === reviewReason
          ) {
            return concurrent;
          }
          throw new ConflictException('现金差异已被其他人员复核');
        }
        await tx.auditLog.create({
          data: {
            actorId: actor.sub,
            actorRole:
              actor.roles.find((role) =>
                (VARIANCE_REVIEW_ROLES as readonly AppRole[]).includes(role),
              ) ?? actor.roles[0],
            action: 'FRONT_DESK_SHIFT_VARIANCE_REVIEWED',
            objectType: 'FrontDeskShift',
            objectId: shift.id,
            oldValue: {
              cashVarianceCents: shift.cashVarianceCents,
              varianceReviewedById: null,
            },
            newValue: {
              cashVarianceCents: shift.cashVarianceCents,
              varianceReviewedById: actor.sub,
              varianceReviewedAt: reviewedAt.toISOString(),
            },
            reason: reviewReason ?? '零差异确认',
          },
        });
        return tx.frontDeskShift.findUniqueOrThrow({
          where: { id: shift.id },
          include: shiftInclude,
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  private async snapshot(
    tx: Prisma.TransactionClient,
    operatorId: string,
    openingCashCents: number,
    closingCashCents: number,
    day: BusinessDay,
  ): Promise<ShiftSnapshot> {
    const pendingOrderWhere: Prisma.OrderWhereInput = {
      status: { in: [...PENDING_ORDER_STATUSES] },
      OR: [
        {
          businessType: BusinessType.VENUE,
          bookings: {
            some: {
              startsAt: { lt: day.end },
              endsAt: { gt: day.start },
              status: { not: BookingStatus.CANCELLED },
            },
          },
        },
        {
          createdById: operatorId,
          createdAt: { gte: day.start, lt: day.end },
        },
      ],
    };
    const [
      cashPayments,
      cashRefunds,
      pendingOrderCount,
      pendingOrders,
      pendingRefundCount,
      pendingRefunds,
      pendingPaymentCount,
    ] = await Promise.all([
      tx.payment.aggregate({
        where: {
          channel: PaymentChannel.OFFLINE_CASH,
          status: PaymentStatus.SUCCEEDED,
          operatorId,
          paidAt: { gte: day.start, lt: day.end },
        },
        _sum: { amountCents: true },
      }),
      tx.refund.aggregate({
        where: {
          status: RefundStatus.SUCCEEDED,
          completedAt: { gte: day.start, lt: day.end },
          order: {
            createdById: operatorId,
            payments: {
              some: {
                channel: PaymentChannel.OFFLINE_CASH,
                status: PaymentStatus.SUCCEEDED,
                operatorId,
              },
            },
          },
        },
        _sum: { amountCents: true },
      }),
      tx.order.count({
        where: pendingOrderWhere,
      }),
      tx.order.findMany({
        where: pendingOrderWhere,
        select: {
          id: true,
          orderNo: true,
          businessType: true,
          status: true,
          title: true,
          payableCents: true,
          paidCents: true,
          refundedCents: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'asc' },
        take: 100,
      }),
      tx.refund.count({
        where: {
          status: { in: [...PENDING_REFUND_STATUSES] },
          OR: [
            { requestedById: operatorId },
            { order: { createdById: operatorId } },
          ],
        },
      }),
      tx.refund.findMany({
        where: {
          status: { in: [...PENDING_REFUND_STATUSES] },
          OR: [
            { requestedById: operatorId },
            { order: { createdById: operatorId } },
          ],
        },
        select: {
          id: true,
          refundNo: true,
          orderId: true,
          amountCents: true,
          status: true,
          reason: true,
          requestedAt: true,
        },
        orderBy: { requestedAt: 'asc' },
        take: 100,
      }),
      tx.payment.count({
        where: {
          status: { in: [...PENDING_PAYMENT_STATUSES] },
          operatorId,
        },
      }),
    ]);

    const cashReceiptsCents = cashPayments._sum.amountCents ?? 0;
    const cashRefundsCents = cashRefunds._sum.amountCents ?? 0;
    const expectedCashCents =
      openingCashCents + cashReceiptsCents - cashRefundsCents;
    if (expectedCashCents < 0) {
      throw new ConflictException(
        '现金退款超过备用金与现金收款，请先由财务核对异常',
      );
    }
    const cashVarianceCents = closingCashCents - expectedCashCents;
    const serialisedOrders = pendingOrders.map((order) => ({
      ...order,
      createdAt: order.createdAt.toISOString(),
    }));
    const serialisedRefunds = pendingRefunds.map((refund) => ({
      ...refund,
      requestedAt: refund.requestedAt.toISOString(),
    }));
    return {
      expectedCashCents,
      cashVarianceCents,
      pendingSnapshot: {
        generatedAt: new Date().toISOString(),
        businessDate: day.label,
        venueCode: MAIN_VENUE_CODE,
        operatorId,
        cash: {
          openingCashCents,
          cashReceiptsCents,
          cashRefundsCents,
          expectedCashCents,
        },
        pendingOrders: { count: pendingOrderCount, items: serialisedOrders },
        pendingRefunds: { count: pendingRefundCount, items: serialisedRefunds },
        pendingPayments: { count: pendingPaymentCount },
        exceptions: [
          ...(pendingRefundCount
            ? [{ kind: 'PENDING_REFUNDS', count: pendingRefundCount }]
            : []),
          ...(pendingPaymentCount
            ? [{ kind: 'PENDING_PAYMENTS', count: pendingPaymentCount }]
            : []),
          ...(cashVarianceCents
            ? [{ kind: 'CASH_VARIANCE', amountCents: cashVarianceCents }]
            : []),
        ],
      },
    };
  }

  private replayOpen<
    T extends { status: FrontDeskShiftStatus; openingCashCents: number },
  >(shift: T, openingCashCents: number) {
    if (shift.status === FrontDeskShiftStatus.CLOSED) {
      throw new ConflictException('今日班次已经关闭，不能重复开班');
    }
    if (shift.openingCashCents !== openingCashCents) {
      throw new ConflictException('今日班次已用不同备用金开班');
    }
    return shift;
  }

  private replayClose<
    T extends {
      closedById: string | null;
      closingCashCents: number | null;
      handoverNote: string | null;
      closeReason: string | null;
    },
  >(
    shift: T,
    actorId: string,
    closingCashCents: number,
    handoverNote: string,
    closeReason: string | undefined,
  ) {
    const exactReplay =
      shift.closedById === actorId &&
      shift.closingCashCents === closingCashCents &&
      shift.handoverNote === handoverNote &&
      (shift.closeReason ?? undefined) === closeReason;
    if (exactReplay) return shift;
    throw new ConflictException('班次已经用另一组关班数据关闭');
  }

  private assertRole(actor: AuthUser) {
    if (
      !actor.roles.some((role) =>
        (SHIFT_ROLES as readonly AppRole[]).includes(role),
      )
    ) {
      throw new ForbiddenException('无权操作前台班次');
    }
  }

  private assertVarianceReviewer(actor: AuthUser) {
    if (
      !actor.roles.some((role) =>
        (VARIANCE_REVIEW_ROLES as readonly AppRole[]).includes(role),
      )
    ) {
      throw new ForbiddenException('仅财务或管理员可复核现金差异');
    }
  }

  private assertHistoryRole(actor: AuthUser) {
    if (
      !actor.roles.some((role) =>
        (SHIFT_HISTORY_ROLES as readonly AppRole[]).includes(role),
      )
    ) {
      throw new ForbiddenException('无权查看前台班次');
    }
  }

  private isAdministrator(actor: AuthUser) {
    return actor.roles.some((role) =>
      (ADMIN_ROLES as readonly AppRole[]).includes(role),
    );
  }

  private actorRole(actor: AuthUser) {
    return (
      actor.roles.find((role) =>
        (SHIFT_ROLES as readonly AppRole[]).includes(role),
      ) ?? actor.roles[0]
    );
  }

  private businessDateLabel(date: Date) {
    return date.toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' });
  }
}
