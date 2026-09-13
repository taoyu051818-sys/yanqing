import { Module } from '@nestjs/common'

import { PrivacyController } from './privacy.controller.js'
import { PrivacyService } from './privacy.service.js'
import { AvatarCleanupService } from './avatar-cleanup.service.js'

@Module({
  controllers: [PrivacyController],
  providers: [PrivacyService, AvatarCleanupService],
})
export class PrivacyModule {}
