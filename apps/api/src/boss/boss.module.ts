import { Module } from '@nestjs/common'
import { BossController } from './boss.controller.js'
import { BossService } from './boss.service.js'
import { BossBriefingService } from './briefing.service.js'
@Module({controllers:[BossController],providers:[BossService,BossBriefingService]})
export class BossModule {}
