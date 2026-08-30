import { Module } from '@nestjs/common'

import { TrainingController } from './training.controller.js'
import { TrainingService } from './training.service.js'
import {
  TrainingTrialsController,
  YouthTrainingRulesController,
} from './training-operations.controller.js'
import { TrainingTrialsService } from './training-trials.service.js'
import { YouthTrainingRulesService } from './youth-training-rules.service.js'

@Module({
  controllers: [
    TrainingController,
    TrainingTrialsController,
    YouthTrainingRulesController,
  ],
  providers: [TrainingService, TrainingTrialsService, YouthTrainingRulesService],
  exports: [TrainingService, TrainingTrialsService, YouthTrainingRulesService],
})
export class TrainingModule {}
