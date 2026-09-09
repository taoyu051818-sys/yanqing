import { Module } from '@nestjs/common';
import { EventCatalogService } from './catalog/event-catalog.service.js';
import { EventCancellationService } from './catalog/event-cancellation.service.js';
import { EventInvitationsService } from './invitations/event-invitations.service.js';
import { EventRegistrationService } from './registration/event-registration.service.js';
import { EventParticipationService } from './registration/event-participation.service.js';
import { EventWithdrawalService } from './registration/event-withdrawal.service.js';
import { EventCompetitionService } from './competition/event-competition.service.js';
import { EventPrizesService } from './prizes/event-prizes.service.js';
import { EventCatalogController } from './catalog/event-catalog.controller.js';
import { EventInvitationsController } from './invitations/event-invitations.controller.js';
import { EventRegistrationController } from './registration/event-registration.controller.js';
import { EventCompetitionController } from './competition/event-competition.controller.js';
import { EventPrizesController } from './prizes/event-prizes.controller.js';

@Module({
  controllers: [
    EventCatalogController,
    EventInvitationsController,
    EventRegistrationController,
    EventCompetitionController,
    EventPrizesController,
  ],
  providers: [
    EventCatalogService,
    EventCancellationService,
    EventInvitationsService,
    EventRegistrationService,
    EventParticipationService,
    EventWithdrawalService,
    EventCompetitionService,
    EventPrizesService,
  ],
  exports: [
    EventCatalogService,
    EventCancellationService,
    EventInvitationsService,
    EventRegistrationService,
    EventParticipationService,
    EventWithdrawalService,
    EventCompetitionService,
    EventPrizesService,
  ],
})
export class EventsModule {}
