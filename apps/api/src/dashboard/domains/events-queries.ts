import { PrismaService } from '../../database/prisma.service.js';

export function loadEventTeams(prisma: PrismaService, start: Date, end: Date) {
  return prisma.eventTeam.findMany({
    where: { createdAt: { gte: start, lt: end } },
    select: {
      eventId: true,
      status: true,
      cancellationPending: true,
      event: { select: { status: true } },
      captainId: true,
      playerAUserId: true,
      playerBUserId: true,
    },
  });
}
