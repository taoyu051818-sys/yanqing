import { describe, expect, it, vi } from 'vitest';

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';

import type { AuthUser } from '../common/auth/auth-user.js';
import {
  AppRole,
  EventPrizeStatus,
  EventStatus,
  InventoryTxnType,
  RegistrationStatus,
} from '../generated/prisma/enums.js';
import type { IssueEventPrizeDto, ReceiveEventPrizeDto } from './events.dto.js';
import { EventsService } from './events.service.js';

const eventManager: AuthUser = {
  sub: 'event-manager-1',
  displayName: '赛事管理员',
  roles: [AppRole.EVENT_MANAGER],
};

const warehouseOperator: AuthUser = {
  sub: 'front-desk-1',
  displayName: '库存经办',
  roles: [AppRole.FRONT_DESK],
};

const issueDto = (
  overrides: Partial<IssueEventPrizeDto> = {},
): IssueEventPrizeDto => ({
  teamId: 'team-1',
  awardName: '冠军奖',
  inventoryItemId: 'item-1',
  quantity: 2,
  idempotencyKey: 'event-prize-key-1',
  note: '现场发放',
  ...overrides,
});

const transaction = (tx: Record<string, unknown>) =>
  vi.fn(async (work: (value: Record<string, unknown>) => unknown) => work(tx));

describe('EventsService prize inventory workflow', () => {
  it('rejects a non-event/non-warehouse role before persistence', async () => {
    const prisma = {
      eventPrizeAward: { findUnique: vi.fn() },
      $transaction: vi.fn(),
    };
    const service = new EventsService(prisma as never);

    await expect(
      service.issuePrize('event-1', issueDto(), {
        sub: 'coach-1',
        displayName: '教练',
        roles: [AppRole.COACH],
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.eventPrizeAward.findUnique).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('does not issue or decrement stock before the event is completed', async () => {
    const tx = {
      eventPrizeAward: { findUnique: vi.fn().mockResolvedValue(null) },
      event: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'event-1',
          name: '赛事',
          status: EventStatus.IN_PROGRESS,
          prizePool: {},
        }),
      },
      eventTeam: { findFirst: vi.fn() },
      inventoryItem: { findUnique: vi.fn(), updateMany: vi.fn() },
      inventoryTransaction: { create: vi.fn() },
    };
    const prisma = {
      eventPrizeAward: { findUnique: vi.fn().mockResolvedValue(null) },
      $transaction: transaction(tx),
    };
    const service = new EventsService(prisma as never);

    await expect(
      service.issuePrize('event-1', issueDto(), eventManager),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(tx.eventTeam.findFirst).not.toHaveBeenCalled();
    expect(tx.inventoryItem.updateMany).not.toHaveBeenCalled();
    expect(tx.inventoryTransaction.create).not.toHaveBeenCalled();
  });

  it('atomically decrements inventory and creates immutable prize evidence', async () => {
    const award = {
      id: 'award-1',
      eventId: 'event-1',
      teamId: 'team-1',
      awardName: '冠军奖',
      recipientNames: ['甲', '乙'],
      inventoryItemId: 'item-1',
      quantity: 2,
      note: '现场发放',
      status: EventPrizeStatus.ISSUED,
    };
    const tx = {
      eventPrizeAward: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue(award),
      },
      event: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'event-1',
          name: '金羽积分赛',
          status: EventStatus.COMPLETED,
          prizePool: { champion: '羽毛球两筒' },
        }),
      },
      eventTeam: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'team-1',
          name: '冠军队',
          status: RegistrationStatus.COMPLETED,
          finalRank: 1,
          playerAName: '甲',
          playerBName: '乙',
        }),
      },
      inventoryItem: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'item-1',
          sku: 'BALL-001',
          name: '比赛球',
          enabled: true,
          stock: 10,
          purchasePriceCents: 6_800,
          defaultLocationId: 'location-main',
          batchCode: null,
          expiresAt: null,
        }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      inventoryStockBalance: {
        findUnique: vi
          .fn()
          .mockResolvedValue({ id: 'balance-1', quantity: 10 }),
        findMany: vi.fn().mockResolvedValue([{ quantity: 10 }]),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      inventoryTransaction: {
        create: vi.fn().mockResolvedValue({ id: 'stock-tx-1' }),
      },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
    };
    const prisma = {
      eventPrizeAward: { findUnique: vi.fn().mockResolvedValue(null) },
      $transaction: transaction(tx),
    };
    const service = new EventsService(prisma as never);

    const result = await service.issuePrize(
      'event-1',
      issueDto(),
      eventManager,
    );
    expect(result).toMatchObject({
      id: award.id,
      awardName: award.awardName,
      recipientNames: award.recipientNames,
      quantity: award.quantity,
      note: award.note,
      status: award.status,
    });
    expect(JSON.stringify(result)).not.toMatch(
      /eventId|teamId|inventoryItemId|inventoryTransactionId|idempotencyKey|prizePoolSnapshot/,
    );
    expect(tx.inventoryItem.updateMany).toHaveBeenCalledWith({
      where: { id: 'item-1', stock: 10 },
      data: { stock: 8 },
    });
    expect(tx.inventoryStockBalance.updateMany).toHaveBeenCalledWith({
      where: { id: 'balance-1', quantity: 10 },
      data: { quantity: 8 },
    });
    expect(tx.inventoryTransaction.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        itemId: 'item-1',
        type: InventoryTxnType.EVENT_USAGE,
        quantity: -2,
        stockBefore: 10,
        stockAfter: 8,
        operatorId: eventManager.sub,
        idempotencyKey: 'EVENT_PRIZE:event-prize-key-1',
      }),
    });
    expect(tx.eventPrizeAward.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          eventId: 'event-1',
          teamId: 'team-1',
          finalRank: 1,
          recipientNames: ['甲', '乙'],
          inventoryTransactionId: 'stock-tx-1',
          prizePoolSnapshot: { champion: '羽毛球两筒' },
        }),
      }),
    );
    expect(tx.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'EVENT_PRIZE_ISSUED',
          objectId: 'award-1',
        }),
      }),
    );
  });

  it('returns an exact idempotent replay without opening another transaction', async () => {
    const existing = {
      id: 'award-1',
      eventId: 'event-1',
      teamId: 'team-1',
      awardName: '冠军奖',
      recipientNames: ['甲', '乙'],
      inventoryItemId: 'item-1',
      quantity: 2,
      note: '现场发放',
    };
    const prisma = {
      eventPrizeAward: { findUnique: vi.fn().mockResolvedValue(existing) },
      $transaction: vi.fn(),
    };
    const service = new EventsService(prisma as never);

    const replay = await service.issuePrize(
      'event-1',
      issueDto(),
      eventManager,
    );
    expect(replay).toMatchObject({
      id: existing.id,
      awardName: existing.awardName,
      recipientNames: existing.recipientNames,
      quantity: existing.quantity,
      note: existing.note,
    });
    expect(JSON.stringify(replay)).not.toMatch(
      /eventId|teamId|inventoryItemId|idempotencyKey/,
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
    await expect(
      service.issuePrize('event-1', issueDto({ quantity: 3 }), eventManager),
    ).rejects.toThrow('幂等键');
  });

  it('does not write a ledger row when prize inventory is insufficient', async () => {
    const tx = {
      eventPrizeAward: { findUnique: vi.fn().mockResolvedValue(null) },
      event: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'event-1',
          name: '赛事',
          status: EventStatus.COMPLETED,
          prizePool: null,
        }),
      },
      eventTeam: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'team-1',
          name: '冠军队',
          status: RegistrationStatus.COMPLETED,
          finalRank: 1,
          playerAName: '甲',
          playerBName: '乙',
        }),
      },
      inventoryItem: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'item-1',
          enabled: true,
          stock: 1,
          purchasePriceCents: 100,
        }),
        updateMany: vi.fn(),
      },
      inventoryTransaction: { create: vi.fn() },
      auditLog: { create: vi.fn() },
    };
    const service = new EventsService({
      eventPrizeAward: { findUnique: vi.fn().mockResolvedValue(null) },
      $transaction: transaction(tx),
    } as never);

    await expect(
      service.issuePrize('event-1', issueDto(), eventManager),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.inventoryItem.updateMany).not.toHaveBeenCalled();
    expect(tx.inventoryTransaction.create).not.toHaveBeenCalled();
  });

  it('signs for an issued prize exactly once without another stock movement', async () => {
    const current = {
      id: 'award-1',
      eventId: 'event-1',
      status: EventPrizeStatus.ISSUED,
      receivedByName: null,
      receiptIdempotencyKey: null,
      receiptNote: null,
    };
    const tx = {
      eventPrizeAward: {
        findFirst: vi.fn().mockImplementation(() => Promise.resolve(current)),
        updateMany: vi
          .fn()
          .mockImplementation(
            async ({ data }: { data: Record<string, unknown> }) => {
              Object.assign(current, data);
              return { count: 1 };
            },
          ),
        findUniqueOrThrow: vi
          .fn()
          .mockImplementation(() => Promise.resolve(current)),
      },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
    };
    const service = new EventsService({
      $transaction: transaction(tx),
    } as never);
    const dto: ReceiveEventPrizeDto = {
      receivedByName: '甲',
      idempotencyKey: 'event-receipt-key-1',
      note: '本人签收',
    };

    const first = await service.receivePrize(
      'event-1',
      'award-1',
      dto,
      warehouseOperator,
    );
    const second = await service.receivePrize(
      'event-1',
      'award-1',
      dto,
      warehouseOperator,
    );

    expect(first).toMatchObject({
      status: EventPrizeStatus.RECEIVED,
      receivedByName: '甲',
    });
    expect(second).toEqual(first);
    expect(JSON.stringify(second)).not.toMatch(
      /eventId|receiptIdempotencyKey|signedById/,
    );
    expect(tx.eventPrizeAward.updateMany).toHaveBeenCalledOnce();
    expect(tx.auditLog.create).toHaveBeenCalledOnce();
  });

  it('resolves a concurrent receipt retry to the already-signed record', async () => {
    const received = {
      id: 'award-1',
      eventId: 'event-1',
      status: EventPrizeStatus.RECEIVED,
      receivedByName: '甲',
      receiptIdempotencyKey: 'event-receipt-key-1',
      receiptNote: null,
    };
    const prisma = {
      $transaction: vi.fn().mockRejectedValue({ code: 'P2034' }),
      eventPrizeAward: {
        findFirst: vi.fn().mockResolvedValue(received),
        findUnique: vi.fn(),
      },
    };
    const service = new EventsService(prisma as never);

    const result = await service.receivePrize(
      'event-1',
      'award-1',
      {
        receivedByName: '甲',
        idempotencyKey: 'event-receipt-key-1',
      },
      warehouseOperator,
    );
    expect(result).toMatchObject({
      id: received.id,
      status: EventPrizeStatus.RECEIVED,
      receivedByName: '甲',
    });
    expect(JSON.stringify(result)).not.toMatch(
      /eventId|receiptIdempotencyKey/,
    );
    expect(prisma.eventPrizeAward.findUnique).not.toHaveBeenCalled();
  });
});
