import { ConflictException } from '@nestjs/common';
import { MemberLevel, type Prisma } from '../generated/prisma/client.js';

type Client = {
  memberSubscription: Pick<
    Prisma.TransactionClient['memberSubscription'],
    'findFirst' | 'findMany' | 'findUniqueOrThrow' | 'update'
  >;
  memberProfile: Pick<
    Prisma.TransactionClient['memberProfile'],
    'findUnique' | 'update'
  >;
};
type Entitlement = {
  startsAt: Date;
  endsAt: Date;
  product: { level: MemberLevel };
};
const rank: Record<MemberLevel, number> = {
  EXPERIENCE: 0,
  REGULAR: 1,
  GOLD: 2,
  BLACK: 3,
};
const day = 86_400_000;

/** Keep a tier's own time boundary; never pair the highest tier with another tier's expiry. */
export function projectMembershipEntitlement(
  subscriptions: Entitlement[],
  now = new Date(),
) {
  const current = subscriptions
    .filter((s) => s.startsAt <= now && s.endsAt > now)
    .sort(
      (a, b) =>
        rank[b.product.level] - rank[a.product.level] || +b.endsAt - +a.endsAt,
    )[0];
  if (!current)
    return { level: MemberLevel.EXPERIENCE, membershipExpiresAt: null };
  let end = current.endsAt;
  for (const next of subscriptions
    .filter((s) => s.product.level === current.product.level)
    .sort((a, b) => +a.startsAt - +b.startsAt)) {
    if (next.startsAt <= end && next.endsAt > end) end = next.endsAt;
  }
  return { level: current.product.level, membershipExpiresAt: end };
}

export async function membershipPurchaseUnavailable(
  tx: Client,
  memberId: string,
  level: MemberLevel,
  excludeId?: string,
  now = new Date(),
): Promise<string | null> {
  const conflict = await tx.memberSubscription.findFirst({
    where: {
      memberId,
      ...(excludeId ? { id: { not: excludeId } } : {}),
      product: { level: { not: level } },
      OR: [
        { status: 'ACTIVE', endsAt: { gt: now } },
        { status: 'FROZEN', order: { status: 'PENDING' } },
      ],
    },
    select: { id: true },
  });
  if (conflict)
    return '已有其他等级的有效会员或待付款订单，请使用同等级续费，或先取消待付款订单';
  const profile = await tx.memberProfile.findUnique({
    where: { id: memberId },
    select: { level: true, membershipExpiresAt: true },
  });
  if (
    profile?.membershipExpiresAt &&
    profile.membershipExpiresAt > now &&
    rank[profile.level] > 0
  ) {
    if (profile.level !== level)
      return '已有其他等级的有效会员，暂不支持跨等级叠加购买';
    const source = await tx.memberSubscription.findFirst({
      where: {
        memberId,
        status: 'ACTIVE',
        startsAt: { lte: now },
        endsAt: { gt: now },
        product: { level },
      },
      select: { id: true },
    });
    if (!source) return '当前会员权益缺少有效订阅记录，请联系管理员核对后续费';
  }
  return null;
}

export async function assertMembershipPurchaseCompatible(
  ...args: Parameters<typeof membershipPurchaseUnavailable>
) {
  const reason = await membershipPurchaseUnavailable(...args);
  if (reason) throw new ConflictException(reason);
}

export async function syncMembershipEntitlement(
  tx: Client,
  memberId: string,
  now = new Date(),
) {
  const subscriptions = await tx.memberSubscription.findMany({
    where: { memberId, status: 'ACTIVE', endsAt: { gt: now } },
    include: { product: { select: { level: true } } },
  });
  const projection = projectMembershipEntitlement(subscriptions, now);
  await tx.memberProfile.update({ where: { id: memberId }, data: projection });
  return projection;
}

export async function activateMembership(
  tx: Client,
  order: {
    parameterSnapshot: Prisma.JsonValue;
    membership: {
      id: string;
      memberId: string;
      product: { durationDays: number; level: MemberLevel };
    };
  },
  now: Date,
) {
  const subscription = order.membership;
  await assertMembershipPurchaseCompatible(
    tx,
    subscription.memberId,
    subscription.product.level,
    subscription.id,
    now,
  );
  const current = await tx.memberSubscription.findUniqueOrThrow({
    where: { id: subscription.id },
  });
  if (current.status !== 'FROZEN')
    throw new ConflictException('会员订阅状态已变化，不能重复激活');
  const previous = await tx.memberSubscription.findFirst({
    where: {
      memberId: subscription.memberId,
      status: 'ACTIVE',
      endsAt: { gt: now },
      product: { level: subscription.product.level },
    },
    orderBy: { endsAt: 'desc' },
  });
  const snapshot = order.parameterSnapshot as Record<string, unknown> | null;
  const durationDays =
    snapshot?.durationDays ?? subscription.product.durationDays;
  if (
    typeof durationDays !== 'number' ||
    !Number.isSafeInteger(durationDays) ||
    durationDays < 1 ||
    durationDays > 3650
  )
    throw new ConflictException('会员订单有效期快照无效，请联系管理员');
  const startsAt = previous?.endsAt ?? now;
  const endsAt = new Date(+startsAt + durationDays * day);
  await tx.memberSubscription.update({
    where: { id: subscription.id, status: 'FROZEN' },
    data: { startsAt, endsAt, status: 'ACTIVE' },
  });
  const profile = await syncMembershipEntitlement(
    tx,
    subscription.memberId,
    now,
  );
  return { startsAt, endsAt, profile };
}

/** Refunding one purchase removes its own interval; queued renewals keep their paid duration. */
export async function cancelMembershipEntitlement(
  tx: Client,
  subscription: { id: string; memberId: string },
  now = new Date(),
) {
  await tx.memberSubscription.update({
    where: { id: subscription.id },
    data: { status: 'CANCELLED' },
  });
  const remaining = await tx.memberSubscription.findMany({
    where: {
      memberId: subscription.memberId,
      status: 'ACTIVE',
      endsAt: { gt: now },
    },
    include: { product: { select: { level: true } } },
    orderBy: [{ startsAt: 'asc' }, { id: 'asc' }],
  });
  const ends = new Map<MemberLevel, Date>();
  for (const next of remaining) {
    const previous = ends.get(next.product.level) ?? now;
    if (next.startsAt > now && next.startsAt > previous) {
      const duration = +next.endsAt - +next.startsAt;
      const endsAt = new Date(+previous + duration);
      await tx.memberSubscription.update({
        where: { id: next.id },
        data: { startsAt: previous, endsAt },
      });
      ends.set(next.product.level, endsAt);
    } else {
      ends.set(next.product.level, new Date(Math.max(+previous, +next.endsAt)));
    }
  }
  return syncMembershipEntitlement(tx, subscription.memberId, now);
}
