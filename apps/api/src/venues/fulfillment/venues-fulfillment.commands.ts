import { transitionOrder } from '../../orders/order-transition.js';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import type { AuthUser } from '../../common/auth/auth-user.js';
import { PrismaService } from '../../database/prisma.service.js';
import {
  BookingStatus,
  BusinessType,
  AppRole,
  OrderStatus,
  Prisma,
} from '../../generated/prisma/client.js';
import type {
  CompleteVenueBookingDto,
  VenueCheckInDto,
} from '../venues.dto.js';
import { orderCreationCommandHash } from '../../orders/order-creation-idempotency.js';
import { orderResponse } from '../../orders/order-response.js';
import {
  auditAdminShiftBypass,
  requireOpenFrontDeskShift,
} from '../../operations/frontdesk-shift-gate.js';
import { completeOrderFulfillment } from '../../orders/order-fulfillment.js';
import {
  assertOperationTimeWindow,
  VENUE_CHECK_IN_WINDOW_PARAMETER,
} from '../../common/time-window/operation-time-window.js';

export async function checkIn(
  prisma: PrismaService,
  orderId: string,
  actor: AuthUser,
  dto: VenueCheckInDto = {},
) {
  if (
    !actor.roles.some((role) =>
      [AppRole.FRONT_DESK, AppRole.ADMIN, AppRole.SUPER_ADMIN].includes(
        role as never,
      ),
    )
  ) {
    throw new ForbiddenException('仅前台或管理员可办理场地签到');
  }
  const order = await prisma.$transaction(async (tx) => {
    const order = await tx.order.findUnique({
      where: { id: orderId },
      include: { bookings: true },
    });
    if (!order || order.businessType !== BusinessType.VENUE)
      throw new NotFoundException('订场订单不存在');
    // A scanner retry after a timeout is a safe no-op.  Returning the
    // already checked-in order avoids duplicate audit records and lets the
    // front desk continue the customer journey without a false 409.
    if (order.status === OrderStatus.CHECKED_IN) return order;
    if (order.status !== OrderStatus.PAID)
      throw new ConflictException('订单未支付或状态不可签到');
    const activeBookings = order.bookings.filter(
      (booking) => booking.status !== BookingStatus.CANCELLED,
    );
    if (!activeBookings.length) {
      throw new ConflictException('订单没有可履约的场地占用记录');
    }
    const checkInStatuses: BookingStatus[] = [
      BookingStatus.CONFIRMED,
      BookingStatus.CHECKED_IN,
    ];
    if (
      activeBookings.some(
        (booking) => !checkInStatuses.includes(booking.status),
      )
    ) {
      throw new ConflictException('场地占用记录状态不可签到');
    }
    const scheduledStartsAt = new Date(
      Math.min(...activeBookings.map((booking) => booking.startsAt.getTime())),
    );
    const timeWindowPolicy = await assertOperationTimeWindow(tx, {
      actor,
      parameterKey: VENUE_CHECK_IN_WINDOW_PARAMETER,
      defaults: { earlyMinutes: 30, lateMinutes: 30 },
      scheduledStartsAt,
      scheduledEndsAt: scheduledStartsAt,
      action: 'VENUE_CHECK_IN',
      objectType: 'Order',
      objectId: orderId,
      overrideReason: dto.overrideReason,
    });
    const shiftAuthorization = await requireOpenFrontDeskShift(tx, actor);
    await tx.courtBooking.updateMany({
      where: { orderId, status: BookingStatus.CONFIRMED },
      data: { status: BookingStatus.CHECKED_IN },
    });
    const changed = await transitionOrder(tx, 'CHECK_IN', {
      where: { id: orderId, status: OrderStatus.PAID },
      data: { status: OrderStatus.CHECKED_IN },
    });
    if (changed.count !== 1) {
      const latest = await tx.order.findUnique({ where: { id: orderId } });
      if (latest?.status === OrderStatus.CHECKED_IN) {
        return tx.order.findUniqueOrThrow({
          where: { id: orderId },
          include: { bookings: true },
        });
      }
      throw new ConflictException('订单状态已被其他操作更新，请刷新后重试');
    }
    await auditAdminShiftBypass(
      tx,
      actor,
      shiftAuthorization,
      'VENUE_CHECK_IN',
      'Order',
      orderId,
    );
    await tx.auditLog.create({
      data: {
        actorId: actor.sub,
        actorRole: actor.roles[0],
        action: 'VENUE_CHECK_IN',
        objectType: 'Order',
        objectId: orderId,
        newValue: {
          frontDeskShiftId:
            shiftAuthorization.mode === 'OPEN_SHIFT'
              ? shiftAuthorization.shiftId
              : null,
          adminEmergencyBypass: shiftAuthorization.mode === 'ADMIN_BYPASS',
          timeWindowPolicy,
        } as never,
      },
    });
    return tx.order.findUniqueOrThrow({
      where: { id: orderId },
      include: { bookings: true },
    });
  });
  return orderResponse(order);
}

export async function completeBooking(
  prisma: PrismaService,
  orderId: string,
  dto: CompleteVenueBookingDto,
  actor: AuthUser,
) {
  if (
    !actor.roles.some((role) =>
      [AppRole.FRONT_DESK, AppRole.ADMIN, AppRole.SUPER_ADMIN].includes(
        role as never,
      ),
    )
  ) {
    throw new ForbiddenException('仅前台或管理员可确认场地履约');
  }
  const idempotencyKey = dto.idempotencyKey.trim();
  const reason = dto.reason.trim();
  const commandHash = orderCreationCommandHash({
    kind: 'VENUE_FULFILLMENT',
    orderId,
    actorId: actor.sub,
    outcome: dto.outcome,
    reason,
    evidence: dto.evidence,
  });

  try {
    const order = await prisma.$transaction(
      async (tx) => {
        const replay = await tx.courtBooking.findUnique({
          where: { fulfillmentIdempotencyKey: idempotencyKey },
        });
        if (replay) {
          assertFulfillmentReplay(replay, orderId, commandHash, actor);
          return tx.order.findUniqueOrThrow({
            where: { id: orderId },
            include: { bookings: true },
          });
        }

        const booking = await tx.courtBooking.findUnique({
          where: { orderId },
          include: {
            order: {
              select: {
                id: true,
                businessType: true,
                status: true,
                completedAt: true,
              },
            },
          },
        });
        if (
          !booking ||
          !booking.order ||
          booking.order.businessType !== BusinessType.VENUE
        ) {
          throw new NotFoundException('订场履约记录不存在');
        }
        if (booking.order.status === OrderStatus.REFUND_PENDING) {
          throw new ConflictException(
            '该订场订单正在等待退款审批，请先处理退款再确认履约',
          );
        }
        if (booking.fulfilledAt || booking.fulfillmentIdempotencyKey) {
          throw new ConflictException('该场地订单已有不可变履约结果');
        }

        const now = new Date();
        if (booking.endsAt > now)
          throw new ConflictException('预约尚未结束，不能确认完成或未到场');
        const observedAt = new Date(dto.evidence.observedAt);
        if (
          Number.isNaN(observedAt.getTime()) ||
          observedAt < booking.startsAt ||
          observedAt > now
        ) {
          throw new BadRequestException(
            '履约证据时间必须在预约开始后且不晚于当前时间',
          );
        }

        const expectedStatus =
          dto.outcome === BookingStatus.COMPLETED
            ? BookingStatus.CHECKED_IN
            : BookingStatus.CONFIRMED;
        if (booking.status !== expectedStatus) {
          throw new ConflictException(
            dto.outcome === BookingStatus.COMPLETED
              ? '只有已签到场地订单可以确认完成'
              : '只有已支付且未签到场地订单可以标记未到场',
          );
        }

        const shiftAuthorization = await requireOpenFrontDeskShift(
          tx,
          actor,
          now,
        );
        const fulfillmentEvidence = {
          source: dto.evidence.source,
          observedAt: observedAt.toISOString(),
        };
        const changed = await tx.courtBooking.updateMany({
          where: {
            id: booking.id,
            status: expectedStatus,
            fulfilledAt: null,
            fulfillmentIdempotencyKey: null,
          },
          data: {
            status: dto.outcome,
            fulfillmentIdempotencyKey: idempotencyKey,
            fulfillmentCommandHash: commandHash,
            fulfillmentReason: reason,
            fulfillmentEvidence,
            fulfilledById: actor.sub,
            fulfilledAt: now,
          },
        });
        if (changed.count !== 1) {
          throw new ConflictException(
            '场地履约状态已被其他操作更新，请刷新后重试',
          );
        }

        await completeOrderFulfillment(tx, {
          orderId,
          actor,
          objectType: 'CourtBooking',
          objectId: booking.id,
          outcome:
            dto.outcome === BookingStatus.NO_SHOW ? 'NO_SHOW' : 'COMPLETED',
          completedAt: now,
          reason,
          metadata: {
            evidenceSource: dto.evidence.source,
            observedAt: observedAt.toISOString(),
          },
        });
        await auditAdminShiftBypass(
          tx,
          actor,
          shiftAuthorization,
          'VENUE_FULFILLMENT',
          'CourtBooking',
          booking.id,
        );
        await tx.auditLog.create({
          data: {
            actorId: actor.sub,
            actorRole: actor.roles[0],
            action:
              dto.outcome === BookingStatus.NO_SHOW
                ? 'VENUE_BOOKING_NO_SHOW'
                : 'VENUE_BOOKING_COMPLETED',
            objectType: 'CourtBooking',
            objectId: booking.id,
            reason,
            oldValue: { status: expectedStatus } as never,
            newValue: {
              status: dto.outcome,
              orderId,
              evidence: fulfillmentEvidence,
              fulfilledAt: now.toISOString(),
              frontDeskShiftId:
                shiftAuthorization.mode === 'OPEN_SHIFT'
                  ? shiftAuthorization.shiftId
                  : null,
              adminEmergencyBypass: shiftAuthorization.mode === 'ADMIN_BYPASS',
              idempotencyKeyPresent: true,
            } as never,
          },
        });
        return tx.order.findUniqueOrThrow({
          where: { id: orderId },
          include: { bookings: true },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    return orderResponse(order);
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      (error.code === 'P2002' || error.code === 'P2034')
    ) {
      const replay = await prisma.courtBooking.findUnique({
        where: { fulfillmentIdempotencyKey: idempotencyKey },
      });
      if (replay) {
        assertFulfillmentReplay(replay, orderId, commandHash, actor);
        const order = await prisma.order.findUniqueOrThrow({
          where: { id: orderId },
          include: { bookings: true },
        });
        return orderResponse(order);
      }
      throw new ConflictException('场地履约正在并发处理，请重试');
    }
    throw error;
  }
}

export function assertFulfillmentReplay(
  booking: {
    orderId: string | null;
    fulfillmentCommandHash: string | null;
    fulfilledById: string | null;
  },
  orderId: string,
  commandHash: string,
  actor: AuthUser,
): void {
  if (
    booking.orderId !== orderId ||
    booking.fulfillmentCommandHash !== commandHash ||
    booking.fulfilledById !== actor.sub
  ) {
    throw new ConflictException('履约幂等键已用于不同订单、命令或操作人');
  }
}
