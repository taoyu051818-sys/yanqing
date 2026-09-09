import type { PrismaService } from '../../src/database/prisma.service.js';
import type { YouthTrainingRulesService } from '../../src/training/youth-training-rules.service.js';
import { TrainingCatalogService } from '../../src/training/catalog/training-catalog.service.js';
import { TrainingStudentsService } from '../../src/training/students/training-students.service.js';
import { TrainingEnrollmentsService } from '../../src/training/enrollments/training-enrollments.service.js';
import { TrainingScheduleService } from '../../src/training/schedule/training-schedule.service.js';
import { TrainingAttendanceService } from '../../src/training/attendance/training-attendance.service.js';
import { TrainingConsumptionService } from '../../src/training/consumption/training-consumption.service.js';
import { TrainingCorrectionsService } from '../../src/training/corrections/training-corrections.service.js';
import { TrainingSettlementsService } from '../../src/training/settlements/training-settlements.service.js';

/** Test-only composition for existing cross-domain business scenarios. */
export class TrainingService {
  private readonly catalog: TrainingCatalogService;
  private readonly students: TrainingStudentsService;
  private readonly enrollments: TrainingEnrollmentsService;
  private readonly schedule: TrainingScheduleService;
  private readonly attendance: TrainingAttendanceService;
  private readonly consumption: TrainingConsumptionService;
  private readonly corrections: TrainingCorrectionsService;
  private readonly settlements: TrainingSettlementsService;
  constructor(prisma: PrismaService, youthRules?: YouthTrainingRulesService) {
    this.catalog = new TrainingCatalogService(prisma, youthRules);
    this.students = new TrainingStudentsService(prisma);
    this.enrollments = new TrainingEnrollmentsService(prisma, youthRules);
    this.schedule = new TrainingScheduleService(prisma);
    this.attendance = new TrainingAttendanceService(prisma);
    this.consumption = new TrainingConsumptionService(prisma);
    this.corrections = new TrainingCorrectionsService(prisma);
    this.settlements = new TrainingSettlementsService(prisma);
  }
  listProducts(...args: Parameters<TrainingCatalogService['listProducts']>) {
    return this.catalog.listProducts(...args);
  }
  createProduct(...args: Parameters<TrainingCatalogService['createProduct']>) {
    return this.catalog.createProduct(...args);
  }
  updateProduct(...args: Parameters<TrainingCatalogService['updateProduct']>) {
    return this.catalog.updateProduct(...args);
  }
  createClass(...args: Parameters<TrainingCatalogService['createClass']>) {
    return this.catalog.createClass(...args);
  }
  listStudents(...args: Parameters<TrainingStudentsService['listStudents']>) {
    return this.students.listStudents(...args);
  }
  createStudent(...args: Parameters<TrainingStudentsService['createStudent']>) {
    return this.students.createStudent(...args);
  }
  updateStudent(...args: Parameters<TrainingStudentsService['updateStudent']>) {
    return this.students.updateStudent(...args);
  }
  listEnrollments(
    ...args: Parameters<TrainingEnrollmentsService['listEnrollments']>
  ) {
    return this.enrollments.listEnrollments(...args);
  }
  purchase(...args: Parameters<TrainingEnrollmentsService['purchase']>) {
    return this.enrollments.purchase(...args);
  }
  listSessions(...args: Parameters<TrainingScheduleService['listSessions']>) {
    return this.schedule.listSessions(...args);
  }
  createSession(...args: Parameters<TrainingScheduleService['createSession']>) {
    return this.schedule.createSession(...args);
  }
  completeSession(
    ...args: Parameters<TrainingScheduleService['completeSession']>
  ) {
    return this.schedule.completeSession(...args);
  }
  markAttendance(
    ...args: Parameters<TrainingAttendanceService['markAttendance']>
  ) {
    return this.attendance.markAttendance(...args);
  }
  scheduleMakeup(
    ...args: Parameters<TrainingAttendanceService['scheduleMakeup']>
  ) {
    return this.attendance.scheduleMakeup(...args);
  }
  consume(...args: Parameters<TrainingConsumptionService['consume']>) {
    return this.consumption.consume(...args);
  }
  proposeConsume(
    ...args: Parameters<TrainingConsumptionService['proposeConsume']>
  ) {
    return this.consumption.proposeConsume(...args);
  }
  confirmConsume(
    ...args: Parameters<TrainingConsumptionService['confirmConsume']>
  ) {
    return this.consumption.confirmConsume(...args);
  }
  listConsumeCorrections(
    ...args: Parameters<TrainingCorrectionsService['listConsumeCorrections']>
  ) {
    return this.corrections.listConsumeCorrections(...args);
  }
  requestConsumeCorrection(
    ...args: Parameters<TrainingCorrectionsService['requestConsumeCorrection']>
  ) {
    return this.corrections.requestConsumeCorrection(...args);
  }
  approveConsumeCorrection(
    ...args: Parameters<TrainingCorrectionsService['approveConsumeCorrection']>
  ) {
    return this.corrections.approveConsumeCorrection(...args);
  }
  rejectConsumeCorrection(
    ...args: Parameters<TrainingCorrectionsService['rejectConsumeCorrection']>
  ) {
    return this.corrections.rejectConsumeCorrection(...args);
  }
  financialSummary(
    ...args: Parameters<TrainingSettlementsService['financialSummary']>
  ) {
    return this.settlements.financialSummary(...args);
  }
  createSettlement(
    ...args: Parameters<TrainingSettlementsService['createSettlement']>
  ) {
    return this.settlements.createSettlement(...args);
  }
  listSettlements(
    ...args: Parameters<TrainingSettlementsService['listSettlements']>
  ) {
    return this.settlements.listSettlements(...args);
  }
  submitSettlement(
    ...args: Parameters<TrainingSettlementsService['submitSettlement']>
  ) {
    return this.settlements.submitSettlement(...args);
  }
  confirmSettlement(
    ...args: Parameters<TrainingSettlementsService['confirmSettlement']>
  ) {
    return this.settlements.confirmSettlement(...args);
  }
  settleSettlement(
    ...args: Parameters<TrainingSettlementsService['settleSettlement']>
  ) {
    return this.settlements.settleSettlement(...args);
  }
  returnSettlement(
    ...args: Parameters<TrainingSettlementsService['returnSettlement']>
  ) {
    return this.settlements.returnSettlement(...args);
  }
  voidSettlement(
    ...args: Parameters<TrainingSettlementsService['voidSettlement']>
  ) {
    return this.settlements.voidSettlement(...args);
  }
}
