import type { PrismaService } from '../../src/database/prisma.service.js';
import { EventCatalogService } from '../../src/events/catalog/event-catalog.service.js';
import { EventCancellationService } from '../../src/events/catalog/event-cancellation.service.js';
import { EventInvitationsService } from '../../src/events/invitations/event-invitations.service.js';
import { EventRegistrationService } from '../../src/events/registration/event-registration.service.js';
import { EventParticipationService } from '../../src/events/registration/event-participation.service.js';
import { EventWithdrawalService } from '../../src/events/registration/event-withdrawal.service.js';
import { EventCompetitionService } from '../../src/events/competition/event-competition.service.js';
import { EventPrizesService } from '../../src/events/prizes/event-prizes.service.js';

/** Test-only composition for existing cross-domain business scenarios. */
export class EventsService {
  private readonly catalog: EventCatalogService;
  private readonly cancellation: EventCancellationService;
  private readonly invitations: EventInvitationsService;
  private readonly registration: EventRegistrationService;
  private readonly participation: EventParticipationService;
  private readonly withdrawal: EventWithdrawalService;
  private readonly competition: EventCompetitionService;
  private readonly prizes: EventPrizesService;
  constructor(prisma: PrismaService) {
    this.catalog = new EventCatalogService(prisma);
    this.cancellation = new EventCancellationService(prisma);
    this.invitations = new EventInvitationsService(prisma);
    this.registration = new EventRegistrationService(prisma);
    this.participation = new EventParticipationService(prisma);
    this.withdrawal = new EventWithdrawalService(prisma);
    this.competition = new EventCompetitionService(prisma);
    this.prizes = new EventPrizesService(prisma);
  }
  list(...args: Parameters<EventCatalogService['list']>) {
    return this.catalog.list(...args);
  }
  detail(...args: Parameters<EventCatalogService['detail']>) {
    return this.catalog.detail(...args);
  }
  managedList(...args: Parameters<EventCatalogService['managedList']>) {
    return this.catalog.managedList(...args);
  }
  managedDetail(...args: Parameters<EventCatalogService['managedDetail']>) {
    return this.catalog.managedDetail(...args);
  }
  create(...args: Parameters<EventCatalogService['create']>) {
    return this.catalog.create(...args);
  }
  publish(...args: Parameters<EventCatalogService['publish']>) {
    return this.catalog.publish(...args);
  }
  cancel(...args: Parameters<EventCancellationService['cancel']>) {
    return this.cancellation.cancel(...args);
  }
  createTeamInvite(
    ...args: Parameters<EventInvitationsService['createTeamInvite']>
  ) {
    return this.invitations.createTeamInvite(...args);
  }
  previewTeamInvite(
    ...args: Parameters<EventInvitationsService['previewTeamInvite']>
  ) {
    return this.invitations.previewTeamInvite(...args);
  }
  acceptTeamInvite(
    ...args: Parameters<EventInvitationsService['acceptTeamInvite']>
  ) {
    return this.invitations.acceptTeamInvite(...args);
  }
  createPartnerInvite(
    ...args: Parameters<EventInvitationsService['createPartnerInvite']>
  ) {
    return this.invitations.createPartnerInvite(...args);
  }
  previewPartnerInvite(
    ...args: Parameters<EventInvitationsService['previewPartnerInvite']>
  ) {
    return this.invitations.previewPartnerInvite(...args);
  }
  register(...args: Parameters<EventRegistrationService['register']>) {
    return this.registration.register(...args);
  }
  myRegistration(
    ...args: Parameters<EventParticipationService['myRegistration']>
  ) {
    return this.participation.myRegistration(...args);
  }
  promoteWaitlist(
    ...args: Parameters<EventParticipationService['promoteWaitlist']>
  ) {
    return this.participation.promoteWaitlist(...args);
  }
  checkIn(...args: Parameters<EventParticipationService['checkIn']>) {
    return this.participation.checkIn(...args);
  }
  cancelRegistration(
    ...args: Parameters<EventWithdrawalService['cancelRegistration']>
  ) {
    return this.withdrawal.cancelRegistration(...args);
  }
  startNextRound(
    ...args: Parameters<EventCompetitionService['startNextRound']>
  ) {
    return this.competition.startNextRound(...args);
  }
  correctPairings(
    ...args: Parameters<EventCompetitionService['correctPairings']>
  ) {
    return this.competition.correctPairings(...args);
  }
  submitScore(...args: Parameters<EventCompetitionService['submitScore']>) {
    return this.competition.submitScore(...args);
  }
  correctScore(...args: Parameters<EventCompetitionService['correctScore']>) {
    return this.competition.correctScore(...args);
  }
  finish(...args: Parameters<EventCompetitionService['finish']>) {
    return this.competition.finish(...args);
  }
  listPrizeAwards(...args: Parameters<EventPrizesService['listPrizeAwards']>) {
    return this.prizes.listPrizeAwards(...args);
  }
  issuePrize(...args: Parameters<EventPrizesService['issuePrize']>) {
    return this.prizes.issuePrize(...args);
  }
  receivePrize(...args: Parameters<EventPrizesService['receivePrize']>) {
    return this.prizes.receivePrize(...args);
  }
}
