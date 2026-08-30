import 'reflect-metadata';

import { describe, expect, it, vi } from 'vitest';

import type { AuthUser } from '../common/auth/auth-user.js';
import { ROLES_KEY } from '../common/auth/auth.decorators.js';
import { AppRole } from '../generated/prisma/enums.js';
import type {
  AttendanceActionDto,
  ConfirmTrainingConsumeDto,
  ConsumeTrainingDto,
  CreateTrainingConsumeCorrectionDto,
  DecideTrainingConsumeCorrectionDto,
  MakeupAttendanceDto,
} from './training.dto.js';
import { TrainingController } from './training.controller.js';

const actor: AuthUser = {
  sub: 'coach-1',
  displayName: '王教练',
  roles: [AppRole.COACH],
};

describe('TrainingController consumption commands', () => {
  it('exposes guardian self-service and staff-scoped student records', async () => {
    const training = {
      listStudents: vi.fn().mockResolvedValue([]),
      createStudent: vi.fn().mockResolvedValue({ id: 'student-1' }),
      updateStudent: vi
        .fn()
        .mockResolvedValue({ id: 'student-1', guardianConsentStatus: true }),
    };
    const controller = new TrainingController(training as never);
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
      Reflect.getMetadata(ROLES_KEY, TrainingController.prototype.allStudents),
    ).toEqual([AppRole.FRONT_DESK, AppRole.ADMIN, AppRole.SUPER_ADMIN]);
  });

  it('keeps the legacy consume route as a service delegation', async () => {
    const training = {
      consume: vi
        .fn()
        .mockResolvedValue({ workflowStatus: 'PENDING_CONFIRMATION' }),
    };
    const controller = new TrainingController(training as never);
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
    const controller = new TrainingController(training as never);
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
      Reflect.getMetadata(
        ROLES_KEY,
        TrainingController.prototype.confirmConsume,
      ),
    ).toEqual([AppRole.ADMIN, AppRole.SUPER_ADMIN]);
  });

  it('exposes attendance and makeup commands with the intended role boundaries', async () => {
    const training = {
      markAttendance: vi.fn().mockResolvedValue({ status: 'ATTENDED' }),
      scheduleMakeup: vi
        .fn()
        .mockResolvedValue({ workflowStatus: 'MAKEUP_SCHEDULED' }),
    };
    const controller = new TrainingController(training as never);
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
      Reflect.getMetadata(
        ROLES_KEY,
        TrainingController.prototype.markAttendance,
      ),
    ).toEqual([
      AppRole.COACH,
      AppRole.FRONT_DESK,
      AppRole.ADMIN,
      AppRole.SUPER_ADMIN,
    ]);
    expect(
      Reflect.getMetadata(
        ROLES_KEY,
        TrainingController.prototype.scheduleMakeup,
      ),
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
    const controller = new TrainingController(training as never);
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
        TrainingController.prototype.approveConsumeCorrection,
      ),
    ).toEqual([AppRole.ADMIN, AppRole.SUPER_ADMIN]);
    expect(
      Reflect.getMetadata(
        ROLES_KEY,
        TrainingController.prototype.rejectConsumeCorrection,
      ),
    ).toEqual([AppRole.ADMIN, AppRole.SUPER_ADMIN]);
  });
});
