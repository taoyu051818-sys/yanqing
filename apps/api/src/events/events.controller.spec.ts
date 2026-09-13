import { EventCatalogController } from './catalog/event-catalog.controller.js';
import { EventInvitationsController } from './invitations/event-invitations.controller.js';
import { EventRegistrationController } from './registration/event-registration.controller.js';
import { EventCompetitionController } from './competition/event-competition.controller.js';
import { EventPrizesController } from './prizes/event-prizes.controller.js';

const controllerMethods = {
  list: EventCatalogController.prototype.list,
  detail: EventCatalogController.prototype.detail,
  managedList: EventCatalogController.prototype.managedList,
  managedDetail: EventCatalogController.prototype.managedDetail,
  create: EventCatalogController.prototype.create,
  publish: EventCatalogController.prototype.publish,
  cancel: EventCatalogController.prototype.cancel,
  createPartnerInvite: EventInvitationsController.prototype.createPartnerInvite,
  createTeamInvite: EventInvitationsController.prototype.createTeamInvite,
  previewTeamInvite: EventInvitationsController.prototype.previewTeamInvite,
  teamInviteContext: EventInvitationsController.prototype.teamInviteContext,
  acceptTeamInvite: EventInvitationsController.prototype.acceptTeamInvite,
  previewPartnerInvite:
    EventInvitationsController.prototype.previewPartnerInvite,
  myRegistration: EventRegistrationController.prototype.myRegistration,
  register: EventRegistrationController.prototype.register,
  promoteWaitlist: EventRegistrationController.prototype.promoteWaitlist,
  cancelRegistration: EventRegistrationController.prototype.cancelRegistration,
  checkIn: EventCompetitionController.prototype.checkIn,
  nextRound: EventCompetitionController.prototype.nextRound,
  correctPairings: EventCompetitionController.prototype.correctPairings,
  score: EventCompetitionController.prototype.score,
  correct: EventCompetitionController.prototype.correct,
  finish: EventCompetitionController.prototype.finish,
  prizes: EventPrizesController.prototype.prizes,
  issuePrize: EventPrizesController.prototype.issuePrize,
  receivePrize: EventPrizesController.prototype.receivePrize,
};
function createController(service: never) {
  const catalog = new EventCatalogController(service, service);
  const invitations = new EventInvitationsController(service);
  const registration = new EventRegistrationController(
    service,
    service,
    service,
  );
  const competition = new EventCompetitionController(service, service);
  const prizes = new EventPrizesController(service);
  return {
    list: catalog.list.bind(catalog),
    detail: catalog.detail.bind(catalog),
    managedList: catalog.managedList.bind(catalog),
    managedDetail: catalog.managedDetail.bind(catalog),
    create: catalog.create.bind(catalog),
    publish: catalog.publish.bind(catalog),
    cancel: catalog.cancel.bind(catalog),
    createPartnerInvite: invitations.createPartnerInvite.bind(invitations),
    createTeamInvite: invitations.createTeamInvite.bind(invitations),
    previewTeamInvite: invitations.previewTeamInvite.bind(invitations),
    teamInviteContext: invitations.teamInviteContext.bind(invitations),
    acceptTeamInvite: invitations.acceptTeamInvite.bind(invitations),
    previewPartnerInvite: invitations.previewPartnerInvite.bind(invitations),
    myRegistration: registration.myRegistration.bind(registration),
    register: registration.register.bind(registration),
    promoteWaitlist: registration.promoteWaitlist.bind(registration),
    cancelRegistration: registration.cancelRegistration.bind(registration),
    checkIn: competition.checkIn.bind(competition),
    nextRound: competition.nextRound.bind(competition),
    correctPairings: competition.correctPairings.bind(competition),
    score: competition.score.bind(competition),
    correct: competition.correct.bind(competition),
    finish: competition.finish.bind(competition),
    prizes: prizes.prizes.bind(prizes),
    issuePrize: prizes.issuePrize.bind(prizes),
    receivePrize: prizes.receivePrize.bind(prizes),
  };
}
import 'reflect-metadata';

import { describe, expect, it, vi } from 'vitest';

import type { AuthUser } from '../common/auth/auth-user.js';
import { IS_PUBLIC_KEY, ROLES_KEY } from '../common/auth/auth.decorators.js';
import { AppRole } from '../generated/prisma/enums.js';
import type {
  CreateEventDto,
  IssueEventPrizeDto,
  PublishEventDto,
  ReceiveEventPrizeDto,
} from './events.dto.js';

const actor: AuthUser = {
  sub: 'reviewer-1',
  displayName: '赛事审核员',
  roles: [AppRole.ADMIN],
};

describe('EventsController publish command', () => {
  it('allows public event browsing without opening registration or management routes', () => {
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, controllerMethods.detail)).toBe(
      true,
    );
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, controllerMethods.list)).toBe(true);
    for (const method of [
      'myRegistration',
      'register',
      'managedList',
      'managedDetail',
      'cancelRegistration',
    ] as const) {
      expect(
        Reflect.getMetadata(IS_PUBLIC_KEY, controllerMethods[method]),
      ).not.toBe(true);
    }
  });

  it('protects full management reads from ordinary members', () => {
    const roles = [
      AppRole.EVENT_MANAGER,
      AppRole.FRONT_DESK,
      AppRole.ADMIN,
      AppRole.SUPER_ADMIN,
    ];
    expect(
      Reflect.getMetadata(ROLES_KEY, controllerMethods.managedList),
    ).toEqual(roles);
    expect(
      Reflect.getMetadata(ROLES_KEY, controllerMethods.managedDetail),
    ).toEqual(roles);
  });

  it('delegates event creation with the authenticated operator', async () => {
    const events = {
      create: vi.fn().mockResolvedValue({ id: 'event-1', status: 'DRAFT' }),
    };
    const controller = createController(events as never);
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
    const controller = createController(events as never);
    const dto: PublishEventDto = { reason: '已完成审核' };

    await expect(controller.publish('event-1', dto, actor)).resolves.toEqual({
      id: 'event-1',
      status: 'OPEN',
    });
    expect(events.publish).toHaveBeenCalledWith('event-1', dto, actor);
  });

  it('protects the publish route with the same event-operations roles', () => {
    expect(Reflect.getMetadata(ROLES_KEY, controllerMethods.publish)).toEqual([
      AppRole.EVENT_MANAGER,
      AppRole.ADMIN,
      AppRole.SUPER_ADMIN,
    ]);
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
    const controller = createController(events as never);
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
      Reflect.getMetadata(ROLES_KEY, controllerMethods.promoteWaitlist),
    ).toEqual(eventManagerRoles);
    expect(Reflect.getMetadata(ROLES_KEY, controllerMethods.cancel)).toEqual(
      eventManagerRoles,
    );
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
    const controller = createController(events as never);
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
      Reflect.getMetadata(ROLES_KEY, controllerMethods.issuePrize),
    ).toEqual(prizeRoles);
    expect(
      Reflect.getMetadata(ROLES_KEY, controllerMethods.receivePrize),
    ).toEqual(prizeRoles);
    expect(Reflect.getMetadata(ROLES_KEY, controllerMethods.prizes)).toEqual(
      prizeRoles,
    );
  });
});
