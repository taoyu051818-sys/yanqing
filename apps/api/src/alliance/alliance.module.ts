import { AllianceMerchantsService } from './merchants/alliance-merchants.service.js';
import { AllianceTemplatesService } from './templates/alliance-templates.service.js';
import { AllianceCouponsService } from './coupons/alliance-coupons.service.js';
import { AllianceSettlementsService } from './settlements/alliance-settlements.service.js';
import { Module } from '@nestjs/common';

import { AllianceController } from './alliance.controller.js';

@Module({
  controllers: [AllianceController],
  providers: [
    AllianceMerchantsService,
    AllianceTemplatesService,
    AllianceCouponsService,
    AllianceSettlementsService,
  ],
  exports: [
    AllianceMerchantsService,
    AllianceTemplatesService,
    AllianceCouponsService,
    AllianceSettlementsService,
  ],
})
export class AllianceModule {}
