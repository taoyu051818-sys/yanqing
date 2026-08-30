import 'reflect-metadata';

import { describe, expect, it, vi } from 'vitest';

import type { AuthUser } from '../common/auth/auth-user.js';
import { ROLES_KEY } from '../common/auth/auth.decorators.js';
import { AppRole } from '../generated/prisma/enums.js';
import type {
  CreateEventDto,
  IssueEventPrizeDto,
  PublishEventDto,
  ReceiveEventPrizeDto,
} from './events.dto.js';
import { EventsController } from './events.controller.js';

const actor: AuthUser = {
  sub: 'reviewer-1',
  displayName: '赛事审核员',
  roles: [AppRole.ADMIN],
};

describe('EventsController publish command', () => {
  it('delegates event creation with the authenticated operator', async () => {
    const events = {
      create: vi.fn().mockResolvedValue({ id: 'event-1', status: 'DRAFT' }),
    };
    const controller = new EventsController(events as never);
    const dto = {
      code: 'EV-01',
      name: '测试赛事',
      startsAt: '2099-08-30T10:00:00.000Z',
      registrationEndsAt: '2099-08-30T09:00:00.000Z',
      capacityPeople: 48,
      minimumPeople: 24,
      totalRounds: 5,
      feeCents: 9_900,
    } as CreateEventDto;

    await controller.create(dto, actor);

    expect(events.create).toHaveBeenCalledWith(dto, actor);
  });

  it('delegates publish with the event id, body and actor', async () => {
    const events = {
      publish: vi.fn().mockResolvedValue({ id: 'event-1', status: 'OPEN' }),
    };
    const controller = new EventsController(events as never);
    const dto: PublishEventDto = { reason: '已完成审核' };

    await expect(controller.publish('event-1', dto, actor)).resolves.toEqual({
      id: 'event-1',
      status: 'OPEN',
    });
    expect(events.publish).toHaveBeenCalledWith('event-1', dto, actor);
  });

  it('protects the publish route with the same event-operations roles', () => {
    expect(
      Reflect.getMetadata(ROLES_KEY, EventsController.prototype.publish),
    ).toEqual([AppRole.EVENT_MANAGER, AppRole.ADMIN, AppRole.SUPER_ADMIN]);
  });
});

describe('EventsController reverse event workflow', () => {
  const eventManagerRoles = [
    AppRole.EVENT_MANAGER,
    AppRole.ADMIN,
    AppRole.SUPER_ADMIN,
  ];

  it('delegates FIFO retry and idempotent cancellation with the authenticated actor', async () => {
    const events = {
      promoteWaitlist: vi.fn().mockResolvedValue({ promotions: [] }),
      cancel: vi.fn().mockResolvedValue({ event: { status: 'CANCELLED' } }),
      cancelRegistration: vi.fn().mockResolvedValue({ outcome: 'CANCELLED' }),
    };
    const controller = new EventsController(events as never);
    const cancelDto = {
      reason: '场馆临时停电',
      idempotencyKey: 'event-cancel-command-1',
    };

    await controller.promoteWaitlist('event-1', actor);
    await controller.cancel('event-1', cancelDto, actor);
    await controller.cancelRegistration('event-1', cancelDto, actor);

    expect(events.promoteWaitlist).toHaveBeenCalledWith('event-1', actor);
    expect(events.cancel).toHaveBeenCalledWith('event-1', cancelDto, actor);
    expect(events.cancelRegistration).toHaveBeenCalledWith(
      'event-1',
      cancelDto,
      actor,
    );
  });

  it('protects promotion and cancellation with event-management roles', () => {
    expect(
      Reflect.getMetadata(
        ROLES_KEY,
        EventsController.prototype.promoteWaitlist,
      ),
    ).toEqual(eventManagerRoles);
    expect(
      Reflect.getMetadata(ROLES_KEY, EventsController.prototype.cancel),
    ).toEqual(eventManagerRoles);
  });
});

describe('EventsController prize commands', () => {
  const prizeRoles = [
    AppRole.EVENT_MANAGER,
    AppRole.FRONT_DESK,
    AppRole.ADMIN,
    AppRole.SUPER_ADMIN,
  ];

  it('delegates issue and receipt with immutable command bodies', async () => {
    const events = {
      issuePrize: vi.fn().mockResolvedValue({ id: 'award-1' }),
      receivePrize: vi
        .fn()
        .mockResolvedValue({ id: 'award-1', status: 'RECEIVED' }),
    };
    const controller = new EventsController(events as never);
    const issue: IssueEventPrizeDto = {
      teamId: 'team-1',
      awardName: '冠军奖',
      inventoryItemId: 'item-1',
      quantity: 2,
      idempotencyKey: 'event-prize-key-1',
    };
    const receipt: ReceiveEventPrizeDto = {
      receivedByName: '甲',
      idempotencyKey: 'event-receipt-key-1',
    };

    await controller.issuePrize('event-1', issue, actor);
    await controller.receivePrize('event-1', 'award-1', receipt, actor);

    expect(events.issuePrize).toHaveBeenCalledWith('event-1', issue, actor);
    expect(events.receivePrize).toHaveBeenCalledWith(
      'event-1',
      'award-1',
      receipt,
      actor,
    );
  });

  it('shares prize issue and receipt only with event/inventory operators and admins', () => {
    expect(
      Reflect.getMetadata(ROLES_KEY, EventsController.prototype.issuePrize),
    ).toEqual(prizeRoles);
    expect(
      Reflect.getMetadata(ROLES_KEY, EventsController.prototype.receivePrize),
    ).toEqual(prizeRoles);
    expect(
      Reflect.getMetadata(ROLES_KEY, EventsController.prototype.prizes),
    ).toEqual(prizeRoles);
  });
});
