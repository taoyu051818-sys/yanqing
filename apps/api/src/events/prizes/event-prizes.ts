import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import type { AuthUser } from '../../common/auth/auth-user.js';
import type { PrismaService } from '../../database/prisma.service.js';
import {
  AppRole,
  EventPrizeStatus,
  EventStatus,
  InventoryTxnType,
  Prisma,
  RegistrationStatus,
} from '../../generated/prisma/client.js';
import { applyInventoryDelta } from '../../inventory/inventory-balance.js';
import type {
  IssueEventPrizeDto,
  ReceiveEventPrizeDto,
} from '../events.dto.js';
import {
  assertCommandKey,
  isPrismaErrorCode,
  normaliseOptionalText,
  normaliseText,
} from '../shared/event-command-support.js';

// FRONT_DESK is the current inventory-custodian role used by the stock
// centre.  Prize hand-over is shared with event operations, while members,
// coaches and finance cannot mutate prize inventory.
const EVENT_PRIZE_OPERATOR_ROLES: readonly AppRole[] = [
  AppRole.EVENT_MANAGER,
  AppRole.FRONT_DESK,
  AppRole.ADMIN,
  AppRole.SUPER_ADMIN,
];

const prizeAwardResponse = (value: any) => ({
  id: value.id,
  awardName: value.awardName,
  finalRank: value.finalRank,
  recipientNames: value.recipientNames,
  quantity: value.quantity,
  status: value.status,
  note: value.note,
  receivedByName: value.receivedByName,
  receiptNote: value.receiptNote,
  issuedAt: value.issuedAt,
  receivedAt: value.receivedAt,
  team: value.team
    ? {
        id: value.team.id,
        name: value.team.name,
        finalRank: value.team.finalRank,
      }
    : undefined,
  inventoryItem: value.inventoryItem
    ? {
        id: value.inventoryItem.id,
        sku: value.inventoryItem.sku,
        name: value.inventoryItem.name,
      }
    : undefined,
  operator: value.operator
    ? { id: value.operator.id, displayName: value.operator.displayName }
    : undefined,
  signedBy: value.signedBy
    ? { id: value.signedBy.id, displayName: value.signedBy.displayName }
    : undefined,
});

export async function listPrizeAwards(prisma: PrismaService, eventId: string) {
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: { id: true },
  });
  if (!event) throw new NotFoundException('赛事不存在');
  const awards = await prisma.eventPrizeAward.findMany({
    where: { eventId },
    include: {
      team: { select: { id: true, name: true, finalRank: true } },
      inventoryItem: { select: { id: true, sku: true, name: true } },
      operator: { select: { id: true, displayName: true } },
      signedBy: { select: { id: true, displayName: true } },
    },
    orderBy: [{ finalRank: 'asc' }, { issuedAt: 'asc' }],
  });
  return awards.map(prizeAwardResponse);
}

export async function issuePrize(
  prisma: PrismaService,
  eventId: string,
  dto: IssueEventPrizeDto,
  actor: AuthUser,
) {
  assertPrizeOperator(actor);
  const idempotencyKey = normaliseText(dto.idempotencyKey);
  const awardName = normaliseText(dto.awardName);
  const teamId = normaliseText(dto.teamId);
  const inventoryItemId = normaliseText(dto.inventoryItemId);
  const note = normaliseOptionalText(dto.note);
  if (!awardName) throw new BadRequestException('奖项名称不能为空');
  if (!teamId || !inventoryItemId)
    throw new BadRequestException('获奖队伍和库存商品不能为空');
  assertCommandKey(idempotencyKey, '奖品发放幂等键');
  if (
    !Number.isSafeInteger(dto.quantity) ||
    dto.quantity < 1 ||
    dto.quantity > 999
  ) {
    throw new BadRequestException('奖品数量必须为1-999的整数');
  }

  const existing = await prisma.eventPrizeAward.findUnique({
    where: { idempotencyKey },
    include: {
      team: true,
      inventoryItem: true,
      operator: true,
      signedBy: true,
    },
  });
  if (existing) {
    assertPrizeReplay(existing, eventId, dto, awardName, note);
    return prizeAwardResponse(existing);
  }

  try {
    return await prisma.$transaction(
      async (tx) => {
        const duplicate = await tx.eventPrizeAward.findUnique({
          where: { idempotencyKey },
        });
        if (duplicate) {
          assertPrizeReplay(duplicate, eventId, dto, awardName, note);
          return prizeAwardResponse(duplicate);
        }

        const event = await tx.event.findUnique({
          where: { id: eventId },
          select: { id: true, name: true, status: true, prizePool: true },
        });
        if (!event) throw new NotFoundException('赛事不存在');
        if (event.status !== EventStatus.COMPLETED) {
          throw new ConflictException('赛事尚未完赛，不能发放奖品');
        }
        const team = await tx.eventTeam.findFirst({
          where: { id: teamId, eventId },
          select: {
            id: true,
            name: true,
            status: true,
            finalRank: true,
            playerAName: true,
            playerBName: true,
          },
        });
        if (!team) throw new NotFoundException('获奖队伍不存在');
        if (
          team.status !== RegistrationStatus.COMPLETED ||
          !team.finalRank ||
          team.finalRank < 1
        ) {
          throw new ConflictException('获奖队伍尚未生成有效最终名次');
        }
        const recipientNames = prizeRecipients(team, dto.recipientNames);

        const item = await tx.inventoryItem.findUnique({
          where: { id: inventoryItemId },
        });
        if (!item?.enabled)
          throw new NotFoundException('奖品库存商品不存在或已停用');
        if (item.stock < dto.quantity)
          throw new BadRequestException('奖品库存不足');
        const { stockAfter } = await applyInventoryDelta(
          tx,
          item,
          -dto.quantity,
        );

        const stockTransaction = await tx.inventoryTransaction.create({
          data: {
            itemId: item.id,
            type: InventoryTxnType.EVENT_USAGE,
            quantity: -dto.quantity,
            stockBefore: item.stock,
            stockAfter,
            unitCostCents: item.purchasePriceCents,
            operatorId: actor.sub,
            reason: `${event.name} · ${awardName} · ${team.name}`,
            idempotencyKey: `EVENT_PRIZE:${idempotencyKey}`,
            metadata: {
              referenceType: 'EventPrizeAward',
              eventId,
              teamId: team.id,
              finalRank: team.finalRank,
              awardName,
              recipientNames,
              prizeIssueIdempotencyKey: idempotencyKey,
            } as never,
          },
        });
        const award = await tx.eventPrizeAward.create({
          data: {
            eventId,
            teamId: team.id,
            awardName,
            finalRank: team.finalRank,
            recipientNames,
            inventoryItemId: item.id,
            quantity: dto.quantity,
            operatorId: actor.sub,
            inventoryTransactionId: stockTransaction.id,
            idempotencyKey,
            note,
            prizePoolSnapshot: event.prizePool as never,
          },
          include: {
            team: true,
            inventoryItem: true,
            operator: true,
            signedBy: true,
          },
        });
        await tx.auditLog.create({
          data: {
            actorId: actor.sub,
            actorRole: actor.roles[0],
            action: 'EVENT_PRIZE_ISSUED',
            objectType: 'EventPrizeAward',
            objectId: award.id,
            oldValue: { stock: item.stock } as never,
            newValue: {
              eventId,
              teamId: team.id,
              finalRank: team.finalRank,
              awardName,
              recipientNames,
              inventoryItemId: item.id,
              quantity: dto.quantity,
              stockAfter,
              inventoryTransactionId: stockTransaction.id,
              status: EventPrizeStatus.ISSUED,
            } as never,
            reason: note,
          },
        });
        return prizeAwardResponse(award);
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  } catch (error) {
    if (
      isPrismaErrorCode(error, 'P2002') ||
      isPrismaErrorCode(error, 'P2034')
    ) {
      const replay = await prisma.eventPrizeAward.findUnique({
        where: { idempotencyKey },
        include: {
          team: true,
          inventoryItem: true,
          operator: true,
          signedBy: true,
        },
      });
      if (replay) {
        assertPrizeReplay(replay, eventId, dto, awardName, note);
        return prizeAwardResponse(replay);
      }
      const sameAward = await prisma.eventPrizeAward.findUnique({
        where: {
          eventId_teamId_awardName_inventoryItemId: {
            eventId,
            teamId,
            awardName,
            inventoryItemId,
          },
        },
      });
      if (sameAward)
        throw new ConflictException('该队伍的同一奖项和SKU已经发放');
      throw new ConflictException('奖品发放发生并发冲突，请刷新后重试');
    }
    throw error;
  }
}

export async function receivePrize(
  prisma: PrismaService,
  eventId: string,
  awardId: string,
  dto: ReceiveEventPrizeDto,
  actor: AuthUser,
) {
  assertPrizeOperator(actor);
  const receivedByName = normaliseText(dto.receivedByName);
  const receiptIdempotencyKey = normaliseText(dto.idempotencyKey);
  const receiptNote = normaliseOptionalText(dto.note);
  if (!receivedByName) throw new BadRequestException('签收人不能为空');
  assertCommandKey(receiptIdempotencyKey, '奖品签收幂等键');

  try {
    return await prisma.$transaction(
      async (tx) => {
        const current = await tx.eventPrizeAward.findFirst({
          where: { id: awardId, eventId },
        });
        if (!current) throw new NotFoundException('赛事奖品发放记录不存在');
        if (current.status === EventPrizeStatus.RECEIVED) {
          assertReceiptReplay(
            current,
            receivedByName,
            receiptIdempotencyKey,
            receiptNote,
          );
          return prizeAwardResponse(current);
        }
        const receivedAt = new Date();
        const changed = await tx.eventPrizeAward.updateMany({
          where: { id: awardId, eventId, status: EventPrizeStatus.ISSUED },
          data: {
            status: EventPrizeStatus.RECEIVED,
            receivedByName,
            signedById: actor.sub,
            receiptNote,
            receiptIdempotencyKey,
            receivedAt,
          },
        });
        if (changed.count !== 1) {
          const latest = await tx.eventPrizeAward.findFirst({
            where: { id: awardId, eventId },
          });
          if (latest?.status === EventPrizeStatus.RECEIVED) {
            assertReceiptReplay(
              latest,
              receivedByName,
              receiptIdempotencyKey,
              receiptNote,
            );
            return prizeAwardResponse(latest);
          }
          throw new ConflictException(
            '奖品签收状态已被其他操作更新，请刷新后重试',
          );
        }
        const received = await tx.eventPrizeAward.findUniqueOrThrow({
          where: { id: awardId },
        });
        await tx.auditLog.create({
          data: {
            actorId: actor.sub,
            actorRole: actor.roles[0],
            action: 'EVENT_PRIZE_RECEIVED',
            objectType: 'EventPrizeAward',
            objectId: awardId,
            oldValue: { status: current.status } as never,
            newValue: {
              status: EventPrizeStatus.RECEIVED,
              receivedByName,
              signedById: actor.sub,
              receivedAt: receivedAt.toISOString(),
            } as never,
            reason: receiptNote,
          },
        });
        return prizeAwardResponse(received);
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  } catch (error) {
    if (
      isPrismaErrorCode(error, 'P2002') ||
      isPrismaErrorCode(error, 'P2034')
    ) {
      const latest = await prisma.eventPrizeAward.findFirst({
        where: { id: awardId, eventId },
      });
      if (latest?.status === EventPrizeStatus.RECEIVED) {
        assertReceiptReplay(
          latest,
          receivedByName,
          receiptIdempotencyKey,
          receiptNote,
        );
        return prizeAwardResponse(latest);
      }
      const duplicateReceipt = await prisma.eventPrizeAward.findUnique({
        where: { receiptIdempotencyKey },
      });
      if (duplicateReceipt && duplicateReceipt.id !== awardId) {
        throw new ConflictException('奖品签收幂等键已用于其他发放记录');
      }
      throw new ConflictException('奖品签收发生并发冲突，请刷新后重试');
    }
    throw error;
  }
}

function assertPrizeOperator(actor: AuthUser): void {
  if (!actor.roles.some((role) => EVENT_PRIZE_OPERATOR_ROLES.includes(role))) {
    throw new ForbiddenException('当前角色无权发放或签收赛事奖品');
  }
}

function prizeRecipients(
  team: { playerAName: string; playerBName: string },
  requested: string[] | undefined,
): string[] {
  const available = [
    normaliseText(team.playerAName),
    normaliseText(team.playerBName),
  ];
  const byNormalized = new Map(
    available.map((name) => [name.toLocaleLowerCase(), name]),
  );
  const supplied = requested?.map(normaliseText).filter(Boolean);
  if (!supplied?.length) return [...new Set(available)];
  if (
    new Set(supplied.map((name) => name.toLocaleLowerCase())).size !==
    supplied.length
  ) {
    throw new BadRequestException('奖品领取人不能重复');
  }
  return supplied.map((name) => {
    const canonical = byNormalized.get(name.toLocaleLowerCase());
    if (!canonical) throw new BadRequestException('奖品领取人必须属于获奖队伍');
    return canonical;
  });
}

function assertPrizeReplay(
  existing: {
    eventId: string;
    teamId: string;
    awardName: string;
    recipientNames: string[];
    inventoryItemId: string;
    quantity: number;
    note: string | null;
  },
  eventId: string,
  dto: IssueEventPrizeDto,
  awardName: string,
  note: string | undefined,
): void {
  const requestedRecipients = dto.recipientNames
    ?.map(normaliseText)
    .filter(Boolean);
  const recipientsConflict = requestedRecipients?.length
    ? requestedRecipients.length !== existing.recipientNames.length ||
      requestedRecipients.some(
        (name, index) => name !== existing.recipientNames[index],
      )
    : false;
  if (
    existing.eventId !== eventId ||
    existing.teamId !== normaliseText(dto.teamId) ||
    existing.awardName !== awardName ||
    existing.inventoryItemId !== normaliseText(dto.inventoryItemId) ||
    existing.quantity !== dto.quantity ||
    existing.note !== (note ?? null) ||
    recipientsConflict
  ) {
    throw new ConflictException('幂等键已用于其他赛事奖品指令，请更换幂等键');
  }
}

function assertReceiptReplay(
  existing: {
    receivedByName: string | null;
    receiptIdempotencyKey: string | null;
    receiptNote: string | null;
  },
  receivedByName: string,
  receiptIdempotencyKey: string,
  receiptNote: string | undefined,
): void {
  if (
    existing.receivedByName !== receivedByName ||
    existing.receiptIdempotencyKey !== receiptIdempotencyKey ||
    existing.receiptNote !== (receiptNote ?? null)
  ) {
    throw new ConflictException('奖品已经签收，签收信息与本次请求不一致');
  }
}
