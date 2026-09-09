import { TrainingCatalogController } from './catalog/training-catalog.controller.js';
import { TrainingStudentsController } from './students/training-students.controller.js';
import { TrainingEnrollmentsController } from './enrollments/training-enrollments.controller.js';
import { TrainingScheduleController } from './schedule/training-schedule.controller.js';
import { TrainingAttendanceController } from './attendance/training-attendance.controller.js';
import { TrainingConsumptionController } from './consumption/training-consumption.controller.js';
import { TrainingCorrectionsController } from './corrections/training-corrections.controller.js';
import { TrainingSettlementsController } from './settlements/training-settlements.controller.js';

const controllerMethods = {
  products: TrainingCatalogController.prototype.products,
  createProduct: TrainingCatalogController.prototype.createProduct,
  updateProduct: TrainingCatalogController.prototype.updateProduct,
  createClass: TrainingCatalogController.prototype.createClass,
  students: TrainingStudentsController.prototype.students,
  allStudents: TrainingStudentsController.prototype.allStudents,
  createStudent: TrainingStudentsController.prototype.createStudent,
  updateStudent: TrainingStudentsController.prototype.updateStudent,
  purchase: TrainingEnrollmentsController.prototype.purchase,
  myEnrollments: TrainingEnrollmentsController.prototype.myEnrollments,
  allEnrollments: TrainingEnrollmentsController.prototype.allEnrollments,
  sessions: TrainingScheduleController.prototype.sessions,
  createSession: TrainingScheduleController.prototype.createSession,
  complete: TrainingScheduleController.prototype.complete,
  markAttendance: TrainingAttendanceController.prototype.markAttendance,
  scheduleMakeup: TrainingAttendanceController.prototype.scheduleMakeup,
  consume: TrainingConsumptionController.prototype.consume,
  confirmConsume: TrainingConsumptionController.prototype.confirmConsume,
  consumeCorrections:
    TrainingCorrectionsController.prototype.consumeCorrections,
  requestConsumeCorrection:
    TrainingCorrectionsController.prototype.requestConsumeCorrection,
  approveConsumeCorrection:
    TrainingCorrectionsController.prototype.approveConsumeCorrection,
  rejectConsumeCorrection:
    TrainingCorrectionsController.prototype.rejectConsumeCorrection,
  summary: TrainingSettlementsController.prototype.summary,
  settlement: TrainingSettlementsController.prototype.settlement,
  settlements: TrainingSettlementsController.prototype.settlements,
  submitSettlement: TrainingSettlementsController.prototype.submitSettlement,
  confirmSettlement: TrainingSettlementsController.prototype.confirmSettlement,
  settleSettlement: TrainingSettlementsController.prototype.settleSettlement,
  returnSettlement: TrainingSettlementsController.prototype.returnSettlement,
  voidSettlement: TrainingSettlementsController.prototype.voidSettlement,
};
function createController(service: never) {
  const catalog = new TrainingCatalogController(service);
  const students = new TrainingStudentsController(service);
  const enrollments = new TrainingEnrollmentsController(service);
  const schedule = new TrainingScheduleController(service);
  const attendance = new TrainingAttendanceController(service);
  const consumption = new TrainingConsumptionController(service);
  const corrections = new TrainingCorrectionsController(service);
  const settlements = new TrainingSettlementsController(service);
  return {
    products: catalog.products.bind(catalog),
    createProduct: catalog.createProduct.bind(catalog),
    updateProduct: catalog.updateProduct.bind(catalog),
    createClass: catalog.createClass.bind(catalog),
    students: students.students.bind(students),
    allStudents: students.allStudents.bind(students),
    createStudent: students.createStudent.bind(students),
    updateStudent: students.updateStudent.bind(students),
    purchase: enrollments.purchase.bind(enrollments),
    myEnrollments: enrollments.myEnrollments.bind(enrollments),
    allEnrollments: enrollments.allEnrollments.bind(enrollments),
    sessions: schedule.sessions.bind(schedule),
    createSession: schedule.createSession.bind(schedule),
    complete: schedule.complete.bind(schedule),
    markAttendance: attendance.markAttendance.bind(attendance),
    scheduleMakeup: attendance.scheduleMakeup.bind(attendance),
    consume: consumption.consume.bind(consumption),
    confirmConsume: consumption.confirmConsume.bind(consumption),
    consumeCorrections: corrections.consumeCorrections.bind(corrections),
    requestConsumeCorrection:
      corrections.requestConsumeCorrection.bind(corrections),
    approveConsumeCorrection:
      corrections.approveConsumeCorrection.bind(corrections),
    rejectConsumeCorrection:
      corrections.rejectConsumeCorrection.bind(corrections),
    summary: settlements.summary.bind(settlements),
    settlement: settlements.settlement.bind(settlements),
    settlements: settlements.settlements.bind(settlements),
    submitSettlement: settlements.submitSettlement.bind(settlements),
    confirmSettlement: settlements.confirmSettlement.bind(settlements),
    settleSettlement: settlements.settleSettlement.bind(settlements),
    returnSettlement: settlements.returnSettlement.bind(settlements),
    voidSettlement: settlements.voidSettlement.bind(settlements),
  };
}
import 'reflect-metadata';

import { describe, expect, it, vi } from 'vitest';

import type { AuthUser } from '../common/auth/auth-user.js';
import { ROLES_KEY } from '../common/auth/auth.decorators.js';
import { AppRole } from '../generated/prisma/enums.js';
import type {
  AttendanceActionDto,
  ConfirmTrainingConsumeDto,
  ConsumeTrainingDto,
  CreateTrainingClassDto,
  CreateTrainingConsumeCorrectionDto,
  CreateTrainingProductDto,
  CreateTrainingSessionDto,
  DecideTrainingConsumeCorrectionDto,
  MakeupAttendanceDto,
  TrainingSessionActionDto,
} from './training.dto.js';

const actor: AuthUser = {
  sub: 'coach-1',
  displayName: '王教练',
  roles: [AppRole.COACH],
};

describe('TrainingController consumption commands', () => {
  it('passes the authenticated actor into audited product, class, session and completion commands', async () => {
    const training = {
      createProduct: vi.fn().mockResolvedValue({ id: 'product-1' }),
      createClass: vi.fn().mockResolvedValue({ id: 'class-1' }),
      createSession: vi.fn().mockResolvedValue({ id: 'session-1' }),
      completeSession: vi
        .fn()
        .mockResolvedValue({ id: 'session-1', status: 'COMPLETED' }),
    };
    const controller = createController(training as never);
    const product: CreateTrainingProductDto = {
      code: 'PRODUCT-1',
      name: '培训产品',
      audience: 'ADULT' as never,
      totalSessions: 10,
      validityDays: 120,
      priceCents: 100_000,
      refundRule: {},
    };
    const trainingClass: CreateTrainingClassDto = {
      code: 'CLASS-1',
      productId: 'product-1',
      name: '培训班',
      schedule: {},
      capacity: 10,
      coachCostCents: 0,
      assistantCostCents: 0,
      materialCostCents: 0,
    };
    const session: CreateTrainingSessionDto = {
      classId: 'class-1',
      startsAt: '2099-01-01T01:00:00.000Z',
      endsAt: '2099-01-01T02:00:00.000Z',
      courtIds: ['court-1'],
    };
    const completion: TrainingSessionActionDto = {
      reason: '全部出勤已处理',
      idempotencyKey: 'session-complete-1',
    };

    await controller.createProduct(product, actor);
    await controller.createClass(trainingClass, actor);
    await controller.createSession(session, actor);
    await controller.complete('session-1', actor, completion);

    expect(training.createProduct).toHaveBeenCalledWith(product, actor);
    expect(training.createClass).toHaveBeenCalledWith(trainingClass, actor);
    expect(training.createSession).toHaveBeenCalledWith(session, actor);
    expect(training.completeSession).toHaveBeenCalledWith(
      'session-1',
      actor,
      completion,
    );
    expect(
      Reflect.getMetadata(ROLES_KEY, controllerMethods.createProduct),
    ).toEqual([AppRole.ADMIN, AppRole.SUPER_ADMIN]);
    expect(
      Reflect.getMetadata(ROLES_KEY, controllerMethods.createClass),
    ).toEqual([AppRole.ADMIN, AppRole.SUPER_ADMIN]);
  });

  it('exposes guardian self-service and staff-scoped student records', async () => {
    const training = {
      listStudents: vi.fn().mockResolvedValue([]),
      createStudent: vi.fn().mockResolvedValue({ id: 'student-1' }),
      updateStudent: vi
        .fn()
        .mockResolvedValue({ id: 'student-1', guardianConsentStatus: true }),
    };
    const controller = createController(training as never);
    const create = { displayName: '小羽', guardianConsentStatus: true };
    const update = { guardianConsentStatus: true };

    await expect(controller.students(actor)).resolves.toEqual([]);
    await expect(controller.allStudents(actor, 'guardian-1')).resolves.toEqual(
      [],
    );
    await expect(controller.createStudent(create, actor)).resolves.toEqual({
      id: 'student-1',
    });
    await expect(
      controller.updateStudent('student-1', update, actor),
    ).resolves.toEqual({
      id: 'student-1',
      guardianConsentStatus: true,
    });
    expect(training.listStudents).toHaveBeenNthCalledWith(1, actor);
    expect(training.listStudents).toHaveBeenNthCalledWith(
      2,
      actor,
      true,
      'guardian-1',
    );
    expect(
      Reflect.getMetadata(ROLES_KEY, controllerMethods.allStudents),
    ).toEqual([AppRole.FRONT_DESK, AppRole.ADMIN, AppRole.SUPER_ADMIN]);
  });

  it('keeps the legacy consume route as a service delegation', async () => {
    const training = {
      consume: vi
        .fn()
        .mockResolvedValue({ workflowStatus: 'PENDING_CONFIRMATION' }),
    };
    const controller = createController(training as never);
    const dto: ConsumeTrainingDto = {
      enrollmentId: 'enrollment-1',
      attendanceStatus: 'PRESENT',
    };

    await expect(controller.consume('session-1', dto, actor)).resolves.toEqual({
      workflowStatus: 'PENDING_CONFIRMATION',
    });
    expect(training.consume).toHaveBeenCalledWith('session-1', dto, actor);
  });

  it('exposes a checker-only confirmation command and delegates it unchanged', async () => {
    const training = {
      confirmConsume: vi.fn().mockResolvedValue({ id: 'recognition-1' }),
    };
    const controller = createController(training as never);
    const dto: ConfirmTrainingConsumeDto = {
      enrollmentId: 'enrollment-1',
      reason: '核对签到表',
    };

    await expect(
      controller.confirmConsume('session-1', dto, actor),
    ).resolves.toEqual({
      id: 'recognition-1',
    });
    expect(training.confirmConsume).toHaveBeenCalledWith(
      'session-1',
      dto,
      actor,
    );
    expect(
      Reflect.getMetadata(ROLES_KEY, controllerMethods.confirmConsume),
    ).toEqual([AppRole.ADMIN, AppRole.SUPER_ADMIN]);
  });

  it('exposes attendance and makeup commands with the intended role boundaries', async () => {
    const training = {
      markAttendance: vi.fn().mockResolvedValue({ status: 'ATTENDED' }),
      scheduleMakeup: vi
        .fn()
        .mockResolvedValue({ workflowStatus: 'MAKEUP_SCHEDULED' }),
    };
    const controller = createController(training as never);
    const attendance: AttendanceActionDto = {
      enrollmentId: 'enrollment-1',
      status: 'ATTENDED',
    };
    const makeup: MakeupAttendanceDto = {
      enrollmentId: 'enrollment-1',
      makeupSessionId: 'session-2',
    };

    await expect(
      controller.markAttendance('session-1', attendance, actor),
    ).resolves.toEqual({ status: 'ATTENDED' });
    await expect(
      controller.scheduleMakeup('session-1', makeup, actor),
    ).resolves.toEqual({ workflowStatus: 'MAKEUP_SCHEDULED' });
    expect(training.markAttendance).toHaveBeenCalledWith(
      'session-1',
      attendance,
      actor,
    );
    expect(training.scheduleMakeup).toHaveBeenCalledWith(
      'session-1',
      makeup,
      actor,
    );
    expect(
      Reflect.getMetadata(ROLES_KEY, controllerMethods.markAttendance),
    ).toEqual([
      AppRole.COACH,
      AppRole.FRONT_DESK,
      AppRole.ADMIN,
      AppRole.SUPER_ADMIN,
    ]);
    expect(
      Reflect.getMetadata(ROLES_KEY, controllerMethods.scheduleMakeup),
    ).toEqual([AppRole.COACH, AppRole.ADMIN, AppRole.SUPER_ADMIN]);
  });

  it('exposes correction request and checker-only decision commands', async () => {
    const training = {
      listConsumeCorrections: vi.fn().mockResolvedValue([]),
      requestConsumeCorrection: vi
        .fn()
        .mockResolvedValue({ id: 'correction-1', status: 'REQUESTED' }),
      approveConsumeCorrection: vi
        .fn()
        .mockResolvedValue({ id: 'correction-1', status: 'APPROVED' }),
      rejectConsumeCorrection: vi
        .fn()
        .mockResolvedValue({ id: 'correction-1', status: 'REJECTED' }),
    };
    const controller = createController(training as never);
    const request: CreateTrainingConsumeCorrectionDto = {
      recognitionId: 'recognition-1',
      reason: '误消课',
      idempotencyKey: 'correction-request-1',
    };
    const decision: DecideTrainingConsumeCorrectionDto = {
      reason: '复核记录',
      idempotencyKey: 'correction-decision-1',
    };

    await controller.consumeCorrections(actor);
    await controller.requestConsumeCorrection(request, actor);
    await controller.approveConsumeCorrection('correction-1', decision, actor);
    await controller.rejectConsumeCorrection('correction-1', decision, actor);
    expect(training.listConsumeCorrections).toHaveBeenCalledWith(actor);
    expect(training.requestConsumeCorrection).toHaveBeenCalledWith(
      request,
      actor,
    );
    expect(training.approveConsumeCorrection).toHaveBeenCalledWith(
      'correction-1',
      decision,
      actor,
    );
    expect(training.rejectConsumeCorrection).toHaveBeenCalledWith(
      'correction-1',
      decision,
      actor,
    );
    expect(
      Reflect.getMetadata(
        ROLES_KEY,
        controllerMethods.approveConsumeCorrection,
      ),
    ).toEqual([AppRole.ADMIN, AppRole.SUPER_ADMIN]);
    expect(
      Reflect.getMetadata(ROLES_KEY, controllerMethods.rejectConsumeCorrection),
    ).toEqual([AppRole.ADMIN, AppRole.SUPER_ADMIN]);
  });
});
