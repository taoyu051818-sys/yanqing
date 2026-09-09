import { Module } from '@nestjs/common';
import { TrainingCatalogService } from './catalog/training-catalog.service.js';
import { TrainingStudentsService } from './students/training-students.service.js';
import { TrainingEnrollmentsService } from './enrollments/training-enrollments.service.js';
import { TrainingScheduleService } from './schedule/training-schedule.service.js';
import { TrainingAttendanceService } from './attendance/training-attendance.service.js';
import { TrainingConsumptionService } from './consumption/training-consumption.service.js';
import { TrainingCorrectionsService } from './corrections/training-corrections.service.js';
import { TrainingSettlementsService } from './settlements/training-settlements.service.js';
import { TrainingCatalogController } from './catalog/training-catalog.controller.js';
import { TrainingStudentsController } from './students/training-students.controller.js';
import { TrainingEnrollmentsController } from './enrollments/training-enrollments.controller.js';
import { TrainingScheduleController } from './schedule/training-schedule.controller.js';
import { TrainingAttendanceController } from './attendance/training-attendance.controller.js';
import { TrainingConsumptionController } from './consumption/training-consumption.controller.js';
import { TrainingCorrectionsController } from './corrections/training-corrections.controller.js';
import { TrainingSettlementsController } from './settlements/training-settlements.controller.js';
import {
  TrainingTrialsController,
  YouthTrainingRulesController,
} from './training-operations.controller.js';
import { TrainingTrialsService } from './training-trials.service.js';
import { YouthTrainingRulesService } from './youth-training-rules.service.js';

@Module({
  controllers: [
    TrainingCatalogController,
    TrainingStudentsController,
    TrainingEnrollmentsController,
    TrainingScheduleController,
    TrainingAttendanceController,
    TrainingConsumptionController,
    TrainingCorrectionsController,
    TrainingSettlementsController,
    TrainingTrialsController,
    YouthTrainingRulesController,
  ],
  providers: [
    TrainingCatalogService,
    TrainingStudentsService,
    TrainingEnrollmentsService,
    TrainingScheduleService,
    TrainingAttendanceService,
    TrainingConsumptionService,
    TrainingCorrectionsService,
    TrainingSettlementsService,
    TrainingTrialsService,
    YouthTrainingRulesService,
  ],
  exports: [
    TrainingCatalogService,
    TrainingStudentsService,
    TrainingEnrollmentsService,
    TrainingScheduleService,
    TrainingAttendanceService,
    TrainingConsumptionService,
    TrainingCorrectionsService,
    TrainingSettlementsService,
    TrainingTrialsService,
    YouthTrainingRulesService,
  ],
})
export class TrainingModule {}
