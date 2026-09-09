import { ConflictException } from '@nestjs/common';
import {
  AppRole,
  BusinessType,
  EventStatus,
  OrderStatus,
  PaymentChannel,
  PaymentStatus,
  Prisma,
  RegistrationStatus,
  SourceChannel,
  SubjectAccount,
} from '../generated/prisma/client.js';
import { requireOrderTransition } from '../orders/order-transition.js';
import { orderCreationCommandHash } from '../orders/order-creation-idempotency.js';
import { resolveOperatingShareSnapshot } from '../common/finance/operating-share.js';
import { serial } from './event-command-support.js';
import {
  EVENT_SEAT_STATUSES,
  eventPaymentDueAt,
} from './event-registration-policy.js';

/**
 * Release expired unpaid event reservations inside the caller's serializable
 * transaction.  Each row is claimed with a conditional update; a payment
 * worker that already moved the team to PAID therefore wins cleanly.
 */
async function expireEventReservations(
  tx: Prisma.TransactionClient,
  eventId: string,
  actorId: string | undefined,
  actorRole: AppRole | undefined,
  now: Date,
) {
  const expired = await tx.eventTeam.findMany({
    where: {
      eventId,
      status: RegistrationStatus.REGISTERED,
      paymentDueAt: { lte: now },
      // An in-flight WeChat payment must be remotely closed by OrdersService
      // before releasing its seat. A domain-only transaction cannot close it.
      order: {
        status: OrderStatus.PENDING,
        payments: {
          none: {
            channel: PaymentChannel.WECHAT,
            status: PaymentStatus.PROCESSING,
          },
        },
      },
    },
    select: { id: true, orderId: true, paymentDueAt: true },
    orderBy: [{ paymentDueAt: 'asc' }, { id: 'asc' }],
  });
  let released = 0;
  for (const team of expired) {
    const claimed = await tx.eventTeam.updateMany({
      where: {
        id: team.id,
        status: RegistrationStatus.REGISTERED,
        paymentDueAt: { lte: now },
      },
      data: {
        status: RegistrationStatus.CANCELLED,
        paymentDueAt: null,
        cancelledAt: now,
      },
    });
    if (claimed.count !== 1) continue;
    if (team.orderId) {
      await requireOrderTransition(tx, 'CANCEL_UNPAID', {
        where: { id: team.orderId, status: OrderStatus.PENDING },
        data: { status: OrderStatus.CANCELLED, cancelledAt: now },
      });
      await tx.payment.updateMany({
        where: {
          orderId: team.orderId,
          status: {
            in: [
              PaymentStatus.CREATED,
              PaymentStatus.PROCESSING,
              PaymentStatus.FAILED,
            ],
          },
        },
        data: { status: PaymentStatus.CLOSED },
      });
    }
    released += 1;
    await tx.auditLog.create({
      data: {
        actorId,
        actorRole,
        action: 'EVENT_PAYMENT_RESERVATION_EXPIRED',
        objectType: 'EventTeam',
        objectId: team.id,
        oldValue: {
          status: RegistrationStatus.REGISTERED,
          paymentDueAt: team.paymentDueAt?.toISOString(),
        } as never,
        newValue: {
          status: RegistrationStatus.CANCELLED,
          orderId: team.orderId,
        } as never,
        reason: '报名支付保留期届满',
      },
    });
  }
  return released;
}

/**
 * Fill every currently available event-team seat from the persistent FIFO
 * queue.  It is shared by operations, timeout cleanup and refund finalisers.
 */
export async function promoteNextEventWaitlist(
  tx: Prisma.TransactionClient,
  eventId: string,
  actorId: string | undefined,
  actorRole: AppRole | undefined,
  now = new Date(),
) {
  const event = await tx.event.findUnique({
    where: { id: eventId },
    select: {
      id: true,
      name: true,
      status: true,
      capacityPeople: true,
      registrationEndsAt: true,
      startsAt: true,
    },
  });
  if (
    !event ||
    (event.status !== EventStatus.OPEN && event.status !== EventStatus.FULL)
  ) {
    return { expiredCount: 0, promotions: [] };
  }

  const expiredCount = await expireEventReservations(
    tx,
    eventId,
    actorId,
    actorRole,
    now,
  );
  if (event.registrationEndsAt <= now || event.startsAt <= now) {
    return { expiredCount, promotions: [] };
  }
  const capacityTeams = Math.floor(event.capacityPeople / 2);
  let seated = await tx.eventTeam.count({
    where: { eventId, status: { in: [...EVENT_SEAT_STATUSES] } },
  });
  const promotions: Array<{
    order: { id: string };
    registration: { id: string };
  }> = [];

  while (seated < capacityTeams) {
    const next = await tx.eventTeam.findFirst({
      where: {
        eventId,
        status: RegistrationStatus.WAITLISTED,
        orderId: null,
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    if (!next) break;
    const paymentDueAt = eventPaymentDueAt(
      event.registrationEndsAt,
      event.startsAt,
      now,
    );
    const payableCents = next.payableCents ?? 0;
    const listAmountCents = next.listAmountCents ?? payableCents;
    const promotionOrderKey = `SYSTEM:EVENT_WAITLIST:${next.id}`;
    const operatingShare = await resolveOperatingShareSnapshot(
      tx,
      BusinessType.EVENT,
      now,
    );
    const order = await tx.order.upsert({
      where: { creationIdempotencyKey: promotionOrderKey },
      update: {},
      create: {
        creationIdempotencyKey: promotionOrderKey,
        creationCommandHash: orderCreationCommandHash({
          kind: 'EVENT_WAITLIST_PROMOTION',
          eventId,
          teamId: next.id,
          captainId: next.captainId,
        }),
        orderNo: serial('EV'),
        memberId: next.captainId,
        createdById: actorId,
        businessType: BusinessType.EVENT,
        subjectAccount: SubjectAccount.VENUE,
        sourceChannel: next.sourceChannel ?? SourceChannel.MINI_PROGRAM,
        status: OrderStatus.PENDING,
        title: `${event.name} 报名`,
        listAmountCents,
        discountCents: Math.max(0, listAmountCents - payableCents),
        payableCents,
        parameterSnapshot: {
          eventId,
          eventTeamId: next.id,
          promotedFromWaitlist: true,
          paymentDueAt: paymentDueAt.toISOString(),
          memberFeeApplied: next.memberFeeApplied,
          operatingShare,
        },
        items: {
          create: {
            itemType: 'EVENT_REGISTRATION',
            itemId: eventId,
            name: event.name,
            unitPriceCents: payableCents,
            amountCents: payableCents,
          },
        },
      },
    });
    // The database deliberately rejects a REGISTERED row without both its
    // order and payment deadline.  Bind all reservation fields in the same
    // CAS update so neither readers nor constraints can observe a half-
    // promoted team.
    const claimed = await tx.eventTeam.updateMany({
      where: {
        id: next.id,
        status: RegistrationStatus.WAITLISTED,
        orderId: null,
      },
      data: {
        status: RegistrationStatus.REGISTERED,
        orderId: order.id,
        promotedAt: now,
        paymentDueAt,
      },
    });
    if (claimed.count !== 1) {
      const latest = await tx.eventTeam.findUnique({
        where: { id: next.id },
        select: { status: true, orderId: true },
      });
      // A concurrent retry may already have attached this deterministic
      // order. Treat that as a completed promotion; any genuinely conflicting
      // snapshot is left for the serializable transaction to retry safely.
      if (
        latest?.status === RegistrationStatus.REGISTERED &&
        latest.orderId === order.id
      ) {
        seated += 1;
        continue;
      }
      throw new ConflictException('候补晋级状态已变化，请重试');
    }
    const registration = {
      ...next,
      status: RegistrationStatus.REGISTERED,
      orderId: order.id,
      promotedAt: now,
      paymentDueAt,
    };
    seated += 1;
    promotions.push({ order, registration });
    await tx.auditLog.create({
      data: {
        actorId,
        actorRole,
        action: 'EVENT_WAITLIST_PROMOTED',
        objectType: 'EventTeam',
        objectId: registration.id,
        oldValue: { status: RegistrationStatus.WAITLISTED } as never,
        newValue: {
          status: RegistrationStatus.REGISTERED,
          eventId,
          orderId: order.id,
          paymentDueAt: paymentDueAt.toISOString(),
        } as never,
      },
    });
  }

  await tx.event.updateMany({
    where: {
      id: eventId,
      status: { in: [EventStatus.OPEN, EventStatus.FULL] },
    },
    data: {
      status: seated >= capacityTeams ? EventStatus.FULL : EventStatus.OPEN,
    },
  });
  return { expiredCount, promotions };
}
