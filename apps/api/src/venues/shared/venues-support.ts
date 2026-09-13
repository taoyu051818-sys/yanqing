import { BadRequestException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { AppRole, Prisma, SlotPeriod } from '../../generated/prisma/client.js';

export const orderNo = () =>
  `VN${new Date().toISOString().replace(/\D/g, '').slice(0, 14)}${randomBytes(3).toString('hex').toUpperCase()}`;

export const assertVenueDate = (date: string): void => {
  const parsed = new Date(`${date}T00:00:00Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    !Number.isFinite(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== date
  ) {
    throw new BadRequestException('订场日期必须是有效的 YYYY-MM-DD 日历日期');
  }
};

export const atMinutes = (date: string, minutes: number): Date => {
  assertVenueDate(date);
  return new Date(
    new Date(`${date}T00:00:00+08:00`).getTime() + minutes * 60_000,
  );
};

export const ASSISTED_BOOKING_ROLES = new Set<AppRole>([
  AppRole.FRONT_DESK,
  AppRole.ADMIN,
  AppRole.SUPER_ADMIN,
]);

export const CLOSURE_READ_ROLES: AppRole[] = [
  AppRole.FRONT_DESK,
  AppRole.ADMIN,
  AppRole.SUPER_ADMIN,
];

export const CLOSURE_WRITE_ROLES: AppRole[] = [
  AppRole.ADMIN,
  AppRole.SUPER_ADMIN,
];

export const NEWCOMER_COUPON_PREFIX = 'NEWCOMER';

export const NEWCOMER_ALLOWED_PERIODS_PARAMETER =
  'newcomer.experience.allowed_slot_periods';

export const DEFAULT_NEWCOMER_ALLOWED_PERIODS: readonly SlotPeriod[] = [
  SlotPeriod.EARLY,
  SlotPeriod.DAYTIME,
];

export const PRICE_RULE_READ_ROLES: AppRole[] = [
  AppRole.FRONT_DESK,
  AppRole.ADMIN,
  AppRole.SUPER_ADMIN,
];

export const PRICE_RULE_WRITE_ROLES: AppRole[] = [
  AppRole.ADMIN,
  AppRole.SUPER_ADMIN,
];

export const isRetryableMasterDataConflict = (error: unknown) =>
  error instanceof Prisma.PrismaClientKnownRequestError &&
  ['P2002', 'P2034'].includes(error.code);

export const courtClosureView = (closure: any) => ({
  id: closure.id,
  courtId: closure.courtId,
  startsAt: closure.startsAt,
  endsAt: closure.endsAt,
  reason: closure.reason,
  status: closure.status,
  cancelledAt: closure.cancelledAt ?? null,
  cancelReason: closure.cancelReason ?? null,
  court: closure.court
    ? {
        id: closure.court.id,
        code: closure.court.code,
        name: closure.court.name,
        enabled: closure.court.enabled,
      }
    : undefined,
  createdBy: closure.createdBy
    ? { displayName: closure.createdBy.displayName }
    : null,
  cancelledBy: closure.cancelledBy
    ? { displayName: closure.cancelledBy.displayName }
    : null,
  createdAt: closure.createdAt,
  updatedAt: closure.updatedAt,
});

export const priceRuleView = <T extends Record<string, unknown>>(rule: T) => {
  const {
    creationIdempotencyKey: _creationIdempotencyKey,
    creationCommandHash: _creationCommandHash,
    ...view
  } = rule;
  return view;
};

export const priceRuleTransitionView = <T extends Record<string, unknown>>(
  transition: T,
) => {
  const {
    idempotencyKey: _idempotencyKey,
    commandHash: _commandHash,
    priceRule: _priceRule,
    ...view
  } = transition;
  return view;
};
