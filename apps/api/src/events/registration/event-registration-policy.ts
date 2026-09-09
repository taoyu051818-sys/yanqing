import { RegistrationStatus } from '../../generated/prisma/client.js';

export const eventTeamCancellationRefundKey = (
  teamId: string,
  commandKey: string,
) => `EVENT_TEAM_CANCEL:${teamId}:${commandKey}`;

export const EVENT_PAYMENT_RESERVATION_MINUTES = 15;

export const EVENT_SEAT_STATUSES: readonly RegistrationStatus[] = [
  RegistrationStatus.REGISTERED,
  RegistrationStatus.PAID,
  RegistrationStatus.CHECKED_IN,
  RegistrationStatus.COMPLETED,
];

export const eventPaymentDueAt = (
  registrationEndsAt: Date,
  startsAt: Date,
  now: Date,
): Date =>
  new Date(
    Math.min(
      now.getTime() + EVENT_PAYMENT_RESERVATION_MINUTES * 60_000,
      registrationEndsAt.getTime(),
      startsAt.getTime(),
    ),
  );
