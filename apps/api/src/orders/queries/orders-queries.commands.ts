import { NotFoundException } from '@nestjs/common';
import type { AuthUser } from '../../common/auth/auth-user.js';
import { PrismaService } from '../../database/prisma.service.js';
import { AppRole, Prisma } from '../../generated/prisma/client.js';
import type { OrderQueryDto } from '../orders.dto.js';
import { orderResponse } from '../order-response.js';

export async function list(
  prisma: PrismaService,
  actor: AuthUser,
  query: OrderQueryDto,
  all = false,
) {
  const where: Prisma.OrderWhereInput = {
    memberId: all ? undefined : actor.sub,
    businessType: query.businessType,
    status: query.status,
  };
  const [items, total] = await prisma.$transaction([
    prisma.order.findMany({
      where,
      include: {
        ...(all ? { member: { select: { id: true, displayName: true } } } : {}),
        items: true,
        payments: { orderBy: { createdAt: 'desc' } },
        refunds: { orderBy: { requestedAt: 'desc' } },
        bookings: { include: { court: true } },
        gameRegistration: { include: { game: true } },
        eventTeam: { include: { event: true } },
        trainingEnrollment: { include: { product: true, student: true } },
      },
      orderBy: { createdAt: 'desc' },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
    prisma.order.count({ where }),
  ]);
  return {
    items: items.map(orderResponse),
    total,
    page: query.page,
    pageSize: query.pageSize,
  };
}

export async function detail(
  prisma: PrismaService,
  orderId: string,
  actor: AuthUser,
) {
  const order = await prisma.order.findFirst({
    where: canManageAll(actor)
      ? { id: orderId }
      : { id: orderId, memberId: actor.sub },
    include: {
      member: { select: { id: true, displayName: true, phone: true } },
      items: true,
      payments: true,
      refunds: true,
      bookings: { include: { court: true } },
      gameRegistration: { include: { game: true } },
      eventTeam: { include: { event: true } },
      trainingEnrollment: { include: { product: true, student: true } },
    },
  });
  if (!order) throw new NotFoundException('订单不存在');
  return orderResponse(order);
}

export function canManageAll(actor: AuthUser): boolean {
  const elevated = new Set<AppRole>([
    AppRole.FRONT_DESK,
    AppRole.FINANCE,
    AppRole.ADMIN,
    AppRole.SUPER_ADMIN,
  ]);
  return actor.roles.some((role) => elevated.has(role));
}
