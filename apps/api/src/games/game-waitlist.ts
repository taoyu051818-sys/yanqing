import { randomBytes } from 'node:crypto';
import {
  AppRole,
  BusinessType,
  GameStatus,
  OrderStatus,
  Prisma,
  RegistrationStatus,
  SourceChannel,
  SubjectAccount,
} from '../generated/prisma/client.js';
import { resolveOperatingShareSnapshot } from '../common/finance/operating-share.js';
import { orderCreationCommandHash } from '../orders/order-creation-idempotency.js';
import {
  gameRegistrationOpen,
  GAME_SEAT_STATUSES,
  isValidGameCapacity,
} from './game-registration-policy.js';

const serial = (prefix: string) =>
  `${prefix}${new Date().toISOString().replace(/\D/g, '').slice(0, 14)}${randomBytes(3).toString('hex').toUpperCase()}`;

/**
 * Claim the oldest waiting member when a paid seat is released.  This helper
 * is exported so the refund workflow can use the same state transition as an
 * operations operator.  It deliberately creates a fresh pending order (the
 * member still has to pay); no balance or reward is touched here.
 */
export async function promoteNextGameWaitlist(
  tx: Prisma.TransactionClient,
  gameId: string,
  actorId: string | undefined,
  actorRole: AppRole | undefined,
) {
  const game = await tx.game.findUnique({
    where: { id: gameId },
    select: {
      id: true,
      title: true,
      hostId: true,
      feeCents: true,
      capacity: true,
      status: true,
      startsAt: true,
      endsAt: true,
    },
  });
  if (
    !game ||
    (game.status !== GameStatus.OPEN && game.status !== GameStatus.FULL)
  )
    return null;
  if (!isValidGameCapacity(game.capacity)) return null;
  if (!gameRegistrationOpen(game)) return null;

  const seated = await tx.gameRegistration.count({
    where: { gameId, status: { in: [...GAME_SEAT_STATUSES] } },
  });
  if (seated >= game.capacity) return null;
  const next = await tx.gameRegistration.findFirst({
    where: { gameId, status: RegistrationStatus.WAITLISTED, orderId: null },
    orderBy: [{ waitlistedAt: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
    select: { id: true, userId: true, waitlistVersion: true },
  });
  if (!next) {
    if (game.status === GameStatus.FULL) {
      await tx.game.updateMany({
        where: { id: gameId, status: GameStatus.FULL },
        data: { status: GameStatus.OPEN },
      });
    }
    return null;
  }

  // Claim the row before creating the order.  The conditional update is the
  // compare-and-set boundary that prevents two refund workers from creating
  // two orders for the same waiting member.
  const claimed = await tx.gameRegistration.updateMany({
    where: {
      id: next.id,
      status: RegistrationStatus.WAITLISTED,
      orderId: null,
      waitlistVersion: next.waitlistVersion,
    },
    data: { status: RegistrationStatus.REGISTERED },
  });
  if (claimed.count !== 1) return null;
  const operatingShare = await resolveOperatingShareSnapshot(
    tx,
    BusinessType.GAME,
  );

  const order = await tx.order.create({
    data: {
      creationIdempotencyKey: `SYSTEM:GAME_WAITLIST:${next.id}:${next.waitlistVersion}`,
      creationCommandHash: orderCreationCommandHash({
        kind: 'GAME_WAITLIST_PROMOTION',
        gameId,
        registrationId: next.id,
        memberId: next.userId,
        waitlistVersion: next.waitlistVersion,
      }),
      orderNo: serial('GO'),
      memberId: next.userId,
      businessType: BusinessType.GAME,
      subjectAccount: SubjectAccount.VENUE,
      sourceChannel: SourceChannel.MINI_PROGRAM,
      status: OrderStatus.PENDING,
      title: game.title,
      listAmountCents: game.feeCents,
      payableCents: game.feeCents,
      parameterSnapshot: {
        gameId,
        hostId: game.hostId,
        promotedFromWaitlist: true,
        waitlistVersion: next.waitlistVersion,
        gameStartsAt: game.startsAt.toISOString(),
        operatingShare,
      },
      items: {
        create: {
          itemType: 'GAME_REGISTRATION',
          itemId: gameId,
          name: game.title,
          unitPriceCents: game.feeCents,
          amountCents: game.feeCents,
        },
      },
    },
  });
  const registration = await tx.gameRegistration.update({
    where: { id: next.id },
    data: { orderId: order.id },
  });
  await tx.game.updateMany({
    where: { id: gameId, status: { in: [GameStatus.OPEN, GameStatus.FULL] } },
    data: {
      status: seated + 1 >= game.capacity ? GameStatus.FULL : GameStatus.OPEN,
    },
  });
  await tx.auditLog.create({
    data: {
      actorId,
      actorRole,
      action: 'GAME_WAITLIST_PROMOTED',
      objectType: 'GameRegistration',
      objectId: registration.id,
      newValue: { gameId, orderId: order.id, userId: next.userId } as never,
    },
  });
  return { order, registration };
}
