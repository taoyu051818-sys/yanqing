import { PrismaService } from '../../database/prisma.service.js';
import {
  AppRole,
  BookingStatus,
  BusinessType,
  OrderStatus,
} from '../../generated/prisma/client.js';
import { WorkItem, WorkItemContext } from '../work-item-context.js';

export function loadOrders(
  prisma: PrismaService,
  context: Pick<
    WorkItemContext,
    'limit' | 'orderFulfillmentScopes' | 'canOperateOrders'
  >,
) {
  const { limit, orderFulfillmentScopes, canOperateOrders } = context;
  return canOperateOrders
    ? prisma.order.findMany({
        where: {
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
          OR: orderFulfillmentScopes,
        },
        select: {
          id: true,
          orderNo: true,
          title: true,
          status: true,
          businessType: true,
          createdAt: true,
          bookings: {
            where: {
              status: {
                in: [BookingStatus.CONFIRMED, BookingStatus.CHECKED_IN],
              },
            },
            select: {
              id: true,
              status: true,
              startsAt: true,
              endsAt: true,
            },
            take: 1,
          },
          gameRegistration: {
            select: {
              id: true,
              status: true,
              game: {
                select: {
                  id: true,
                  title: true,
                  startsAt: true,
                  endsAt: true,
                },
              },
            },
          },
          eventTeam: {
            select: {
              id: true,
              status: true,
              event: { select: { id: true, name: true, startsAt: true } },
            },
          },
        },
        orderBy: { createdAt: 'asc' },
        take: limit,
      })
    : Promise.resolve([]);
}

export function mapOrdersWorkItems(
  orders: Awaited<ReturnType<typeof loadOrders>>,
): WorkItem[] {
  return orders.map((order) => {
    const booking = order.bookings[0];
    const registration = order.gameRegistration;
    const team = order.eventTeam;
    const fulfillmentStatus =
      booking?.status || registration?.status || team?.status || order.status;
    const dueAt =
      fulfillmentStatus === BookingStatus.CHECKED_IN
        ? booking?.endsAt || registration?.game.endsAt || team?.event.startsAt
        : booking?.startsAt ||
          registration?.game.startsAt ||
          team?.event.startsAt;
    const fulfillmentObjectId =
      booking?.id || registration?.id || team?.id || order.id;
    const ownerRoles =
      order.businessType === BusinessType.VENUE
        ? [AppRole.FRONT_DESK, AppRole.ADMIN, AppRole.SUPER_ADMIN]
        : order.businessType === BusinessType.GAME
          ? [AppRole.HOST, AppRole.ADMIN, AppRole.SUPER_ADMIN]
          : [AppRole.EVENT_MANAGER, AppRole.ADMIN, AppRole.SUPER_ADMIN];
    const action =
      order.businessType === BusinessType.VENUE
        ? `/packages/ops/pages/frontdesk/index?focus=fulfillment&orderId=${order.id}`
        : order.businessType === BusinessType.GAME
          ? `/packages/ops/pages/host/index?focus=fulfillment&orderId=${order.id}`
          : `/packages/ops/pages/event/index?focus=fulfillment&orderId=${order.id}`;
    return {
      id: `order:${order.id}`,
      kind: 'ORDER_FULFILLMENT' as const,
      objectType: 'Order',
      objectId: order.id,
      status: order.status,
      priority: order.status === OrderStatus.CHECKED_IN ? 78 : 72,
      title: `${fulfillmentStatus === 'CHECKED_IN' ? '已签到待完成' : '已开场待签到'} · ${order.orderNo}`,
      description: `${order.title} · ${order.businessType}`,
      ownerRoles,
      createdAt: order.createdAt.toISOString(),
      dueAt: dueAt?.toISOString(),
      action,
      metadata: {
        businessType: order.businessType,
        fulfillmentObjectId,
        fulfillmentStatus,
        gameId: registration?.game.id,
        eventId: team?.event.id,
        dueAt: dueAt?.toISOString(),
      },
    };
  });
}
