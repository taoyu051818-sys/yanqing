import { Module } from '@nestjs/common'

import { ReferralsController } from './referrals.controller.js'
import { ReferralsService } from './referrals.service.js'

@Module({ controllers: [ReferralsController], providers: [ReferralsService] })
export class ReferralsModule {}
