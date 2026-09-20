import { orderResponse } from '../order-response.js';
import {
  pendingPaymentDeadline,
  PURCHASE_HOLD_MS,
} from '../pending-order-policy.js';
import { ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';
import { Prisma, RefundStatus } from '../../generated/prisma/client.js';
import type { AuthUser } from '../../common/auth/auth-user.js';
import {
  TimelineQuery,
  RefundTimelineQuery,
  period,
  decodeCursor,
  encodeCursor,
} from './query.js';
import { externalLedger, accountLedger } from './ledger-source.js';

type LedgerRow = {
  id: string;
  at: Date;
  orderId: string | null;
  memberId: string;
  memberName: string;
  operatorName: string | null;
  orderNo: string | null;
  title: string | null;
  channel: string;
  amount: bigint;
  unit: string;
  reason: string;
  status: string;
};
@Injectable()
export class OrderTimelineService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}
  async ledger(actor: AuthUser, query: TimelineQuery, memberOnly = false) {
    if (
      !memberOnly &&
      query.scope === 'ACCOUNTS' &&
      !actor.roles.some((r) => ['FINANCE', 'ADMIN', 'SUPER_ADMIN'].includes(r))
    )
      throw new ForbiddenException('当前岗位不能查看全馆账户流水');
    const range = period(query),
      cursor = decodeCursor(query.cursor);
    const conditions = [Prisma.sql`TRUE`];
    if (memberOnly) conditions.push(Prisma.sql`l."memberId" = ${actor.sub}`);
    if (query.accountType)
      conditions.push(Prisma.sql`l.channel = ${query.accountType}`);
    if (range.gte) conditions.push(Prisma.sql`l.at >= ${range.gte}`);
    if (range.lt) conditions.push(Prisma.sql`l.at < ${range.lt}`);
    if (query.keyword) {
      const keyword = '%' + query.keyword.replace(/[\\%_]/g, '\\$&') + '%';
      conditions.push(
        Prisma.sql`(o."orderNo" ILIKE ${keyword} OR o.title ILIKE ${keyword} OR u."displayName" ILIKE ${keyword} OR u.phone LIKE ${keyword})`,
      );
    }
    const source = Prisma.sql`WITH ledger AS (${query.scope === 'ACCOUNTS' ? accountLedger : externalLedger}), filtered AS (
      SELECT l.*, u."displayName" AS "memberName", op."displayName" AS "operatorName", o."orderNo", o.title
      FROM ledger l JOIN "User" u ON u.id=l."memberId" LEFT JOIN "User" op ON op.id=l."operatorId"
      LEFT JOIN "Order" o ON o.id=l."orderId" WHERE ${Prisma.join(conditions, ' AND ')} )`;
    const [rows, sums] = await this.prisma.$transaction(
      async (tx) => {
        const rows = await tx.$queryRaw<
          LedgerRow[]
        >(Prisma.sql`${source} SELECT * FROM filtered
        ${cursor ? Prisma.sql`WHERE (at, id) < (${cursor.at}, ${cursor.id})` : Prisma.empty}
        ORDER BY at DESC, id DESC LIMIT ${query.pageSize + 1}`);
        const sums = await tx.$queryRaw<
          {
            channel: string;
            unit: string;
            count: bigint;
            incoming: bigint;
            outgoing: bigint;
          }[]
        >(Prisma.sql`${source}
        SELECT channel, unit, COUNT(*) AS count,
        COALESCE(SUM(amount) FILTER (WHERE amount>0 AND status NOT IN ('FREEZE','UNFREEZE')),0)::bigint AS incoming,
        COALESCE(-SUM(amount) FILTER (WHERE amount<0 AND status NOT IN ('FREEZE','UNFREEZE')),0)::bigint AS outgoing
        FROM filtered GROUP BY channel, unit`);
        return [rows, sums] as const;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
    const items = rows.slice(0, query.pageSize),
      last = items.at(-1);
    return {
      items: items.map((row) => ({ ...row, amount: Number(row.amount) })),
      summary: sums.map((row) => ({
        ...row,
        count: Number(row.count),
        incoming: Number(row.incoming),
        outgoing: Number(row.outgoing),
      })),
      nextCursor:
        rows.length > query.pageSize && last
          ? encodeCursor(last.at, last.id)
          : null,
    };
  }
  async next(actor: AuthUser) {
    const include = {
      trainingEnrollment: true,
      bookings: { include: { court: true } },
      gameRegistration: { include: { game: true } },
      eventTeam: { include: { event: true } },
    };
    const now = new Date();
    const candidates = await this.prisma.order.findMany({
      where: {
        memberId: actor.sub,
        status: 'PENDING',
        OR: [
          { createdAt: { gte: new Date(+now - PURCHASE_HOLD_MS) } },
          { bookings: { some: { holdExpiresAt: { gt: now } } } },
          { eventTeam: { paymentDueAt: { gt: now } } },
          { trainingEnrollment: { seatReservedUntil: { gt: now } } },
        ],
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      include,
    });
    const pending = candidates.find(
      (order) => (pendingPaymentDeadline(order)?.getTime() ?? 0) > +now,
    );
    if (pending) return orderResponse(pending);
    const next = await this.prisma.$queryRaw<{ id: string }[]>(Prisma.sql`
      SELECT o.id FROM "Order" o JOIN (
        SELECT "orderId", "startsAt" AS at FROM "CourtBooking" WHERE status IN ('CONFIRMED','CHECKED_IN')
        UNION ALL SELECT r."orderId", g."startsAt" FROM "GameRegistration" r JOIN "Game" g ON g.id=r."gameId" WHERE r.status IN ('PAID','CHECKED_IN')
        UNION ALL SELECT t."orderId", e."startsAt" FROM "EventTeam" t JOIN "Event" e ON e.id=t."eventId" WHERE t.status IN ('PAID','CHECKED_IN')
      ) schedule ON schedule."orderId"=o.id
      WHERE o."memberId"=${actor.sub} AND o.status IN ('PAID','CHECKED_IN') AND schedule.at >= ${new Date()}
      GROUP BY o.id ORDER BY MIN(schedule.at), o.id LIMIT 1`);
    if (!next[0]) return null;
    const order = await this.prisma.order.findFirst({
      where: {
        id: next[0].id,
        memberId: actor.sub,
        status: { in: ['PAID', 'CHECKED_IN'] },
      },
      include,
    });
    return order ? orderResponse(order) : null;
  }
  async refunds(query: RefundTimelineQuery) {
    const range = period(query),
      cursor = decodeCursor(query.cursor);
    const where: Prisma.RefundWhereInput = {
      requestedAt: range,
      ...(query.status === 'ACTIVE'
        ? { status: { in: ['REQUESTED', 'APPROVED', 'PROCESSING', 'FAILED'] } }
        : query.status === 'ALL'
          ? {}
          : { status: query.status as RefundStatus }),
      ...(query.keyword
        ? {
            order: {
              OR: [
                { orderNo: { contains: query.keyword, mode: 'insensitive' } },
                { title: { contains: query.keyword, mode: 'insensitive' } },
                {
                  member: {
                    displayName: {
                      contains: query.keyword,
                      mode: 'insensitive',
                    },
                  },
                },
                { member: { phone: { contains: query.keyword } } },
              ],
            },
          }
        : {}),
    };
    const [rows, total] = await this.prisma.$transaction(
      [
        this.prisma.refund.findMany({
          where: {
            AND: [
              where,
              ...(cursor
                ? [
                    {
                      OR: [
                        { requestedAt: { lt: cursor.at } },
                        { requestedAt: cursor.at, id: { lt: cursor.id } },
                      ],
                    },
                  ]
                : []),
            ],
          },
          orderBy: [{ requestedAt: 'desc' }, { id: 'desc' }],
          take: query.pageSize + 1,
          select: {
            id: true,
            orderId: true,
            refundNo: true,
            amountCents: true,
            status: true,
            reason: true,
            requestedAt: true,
            completedAt: true,
            order: {
              select: {
                title: true,
                orderNo: true,
                member: { select: { displayName: true } },
              },
            },
          },
        }),
        this.prisma.refund.count({ where }),
      ],
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
    const items = rows.slice(0, query.pageSize),
      last = items.at(-1);
    return {
      items,
      total,
      nextCursor:
        rows.length > query.pageSize && last
          ? encodeCursor(last.requestedAt, last.id)
          : null,
    };
  }
}
