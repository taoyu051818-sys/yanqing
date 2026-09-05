import { roundHalfUp } from '@yanqing/shared';
import { ConflictException } from '@nestjs/common';

import type { Prisma } from '../../generated/prisma/client.js';
import { BusinessType } from '../../generated/prisma/enums.js';

export const OPERATING_SHARE_RATE_KEY =
  'finance.operating_share_rate_bps' as const;
export const DEFAULT_OPERATING_SHARE_RATE_BPS = 1_500 as const;

const INCLUDED_BUSINESS_TYPES = new Set<BusinessType>([
  BusinessType.VENUE,
  BusinessType.GAME,
  BusinessType.EVENT,
  BusinessType.TRAINING,
  BusinessType.GOODS,
  BusinessType.MEMBERSHIP,
]);

export interface OperatingShareSnapshot extends Prisma.InputJsonObject {
  key: typeof OPERATING_SHARE_RATE_KEY;
  parameterId: string | null;
  rateBps: number;
  businessType: BusinessType;
  included: boolean;
  basis: 'REALIZED_NET_REVENUE';
  effectiveFrom: string | null;
  effectiveTo: string | null;
}

const validateRate = (value: unknown) => {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < 0 ||
    value > 10_000
  ) {
    throw new ConflictException(
      '经营分成比例配置无效，必须为 0-10000 的整数基点',
    );
  }
  return value;
};

/** Resolve and freeze the finance rule used by a newly-created order. */
export async function resolveOperatingShareSnapshot(
  tx: Prisma.TransactionClient,
  businessType: BusinessType,
  at = new Date(),
): Promise<OperatingShareSnapshot> {
  const included = INCLUDED_BUSINESS_TYPES.has(businessType);
  const parameterRepository = (
    tx as Prisma.TransactionClient & {
      systemParameter?: Prisma.TransactionClient['systemParameter'];
    }
  ).systemParameter;
  const parameter = included && parameterRepository?.findFirst
    ? await parameterRepository.findFirst({
        where: {
          key: OPERATING_SHARE_RATE_KEY,
          effectiveFrom: { lte: at },
          OR: [{ effectiveTo: null }, { effectiveTo: { gt: at } }],
        },
        orderBy: { effectiveFrom: 'desc' },
      })
    : null;
  const rateBps = included
    ? validateRate(parameter?.value ?? DEFAULT_OPERATING_SHARE_RATE_BPS)
    : 0;

  return {
    key: OPERATING_SHARE_RATE_KEY,
    parameterId: parameter?.id ?? null,
    rateBps,
    businessType,
    included,
    basis: 'REALIZED_NET_REVENUE',
    effectiveFrom: parameter?.effectiveFrom.toISOString() ?? null,
    effectiveTo: parameter?.effectiveTo?.toISOString() ?? null,
  };
}

export function operatingShareCents(
  realizedNetRevenueCents: number,
  snapshot: Pick<OperatingShareSnapshot, 'included' | 'rateBps'>,
) {
  if (!Number.isSafeInteger(realizedNetRevenueCents)) {
    throw new Error('realizedNetRevenueCents must be a safe integer');
  }
  if (!snapshot.included) return 0;
  return roundHalfUp(realizedNetRevenueCents * validateRate(snapshot.rateBps), 10_000);
}

/**
 * Read the immutable order rule. Historical rows created before this feature
 * use the original 15% baseline instead of a newly edited current parameter.
 */
export function operatingShareSnapshotFromOrder(
  parameterSnapshot: unknown,
  businessType: BusinessType,
): Pick<OperatingShareSnapshot, 'included' | 'rateBps'> {
  const included = INCLUDED_BUSINESS_TYPES.has(businessType);
  if (!included) return { included: false, rateBps: 0 };
  const container =
    parameterSnapshot && typeof parameterSnapshot === 'object'
      ? (parameterSnapshot as Record<string, unknown>)
      : {};
  const raw =
    container.operatingShare && typeof container.operatingShare === 'object'
      ? (container.operatingShare as Record<string, unknown>)
      : null;
  if (!raw) {
    return { included: true, rateBps: DEFAULT_OPERATING_SHARE_RATE_BPS };
  }
  return {
    included: raw.included !== false,
    rateBps: validateRate(raw.rateBps),
  };
}
