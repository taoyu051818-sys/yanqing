import { describe, expect, it, vi } from 'vitest';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';

import type { AuthUser } from '../common/auth/auth-user.js';
import {
  AppRole,
  AttendanceStatus,
  TrainingAudience,
  TrainingEnrollmentStatus,
  TrainingSessionStatus,
} from '../generated/prisma/enums.js';
import type {
  AttendanceActionDto,
  ConsumeTrainingDto,
  MakeupAttendanceDto,
} from './training.dto.js';
import { TrainingService } from './training.service.js';
import { orderCreationCommandHash } from '../orders/order-creation-idempotency.js';

const coach: AuthUser = {
  sub: 'coach-1',
  displayName: '王教练',
  roles: [AppRole.COACH],
};

const administrator: AuthUser = {
  sub: 'admin-1',
  displayName: '培训主管',
  roles: [AppRole.ADMIN],
};

const guardian: AuthUser = {
  sub: 'guardian-1',
  displayName: '学员家长',
  roles: [AppRole.MEMBER],
};

const attendanceFixture = (overrides: Record<string, unknown> = {}) => ({
  id: 'attendance-1',
  sessionId: 'session-1',
  enrollmentId: 'enrollment-1',
  status: AttendanceStatus.ATTENDED,
  consumedSessions: 0,
  confirmedRevenueCents: 0,
  feedback: null,
  operatorId: null,
  checkedInAt: new Date('2026-08-29T10:00:00.000Z'),
  consumedAt: null,
  revenueRecognitions: [],
  session: {
    startsAt: new Date('2026-08-29T10:00:00.000Z'),
    class: { name: '成人进阶班' },
  },
  enrollment: {
    id: 'enrollment-1',
    buyerId: 'member-1',
    status: TrainingEnrollmentStatus.ACTIVE,
    consumedSessions: 0,
    totalSessions: 10,
    prepaidBalanceCents: 19_800,
    product: {
      unitRevenueCents: 19_800,
      audience: TrainingAudience.ADULT,
    },
  },
  ...overrides,
});

const txRunner = (tx: Record<string, unknown>) =>
  vi.fn(async (work: (value: Record<string, unknown>) => unknown) => work(tx));

const consumePrisma = (attendance = attendanceFixture()) => {
  const updatedAttendance = { ...attendance };
  const tx = {
    trainingAttendance: {
      findUnique: vi.fn().mockResolvedValue(attendance),
      update: vi
        .fn()
        .mockImplementation(({ data }: { data: Record<string, unknown> }) => {
          Object.assign(updatedAttendance, data);
          return Promise.resolve(updatedAttendance);
        }),
    },
    trainingEnrollment: {
      update: vi.fn().mockResolvedValue({}),
    },
    trainingRevenueRecognition: {
      create: vi.fn().mockResolvedValue({
        id: 'recognition-1',
        attendanceId: attendance.id,
      }),
    },
    account: {
      findUnique: vi.fn().mockResolvedValue(null),
      update: vi.fn(),
    },
    accountTransaction: {
      create: vi.fn(),
    },
    systemParameter: {
      findFirst: vi.fn().mockResolvedValue({ value: 2_000 }),
    },
    auditLog: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({}),
    },
  };
  return {
    tx,
    prisma: { $transaction: txRunner(tx) },
    updatedAttendance,
  };
};

describe('TrainingService financial ledger', () => {
  it('recognizes consumed revenue, preserves cost categories, and never charges a venue fee', async () => {
    const prisma = {
      trainingRevenueRecognition: {
        findMany: vi.fn().mockResolvedValue([
          { effectiveRevenueCents: 100_000, contractRateBps: 2_000 },
          { effectiveRevenueCents: 50_000, contractRateBps: 2_000 },
        ]),
      },
      trainingSession: {
        findMany: vi.fn().mockResolvedValue([
          {
            coachCostCents: 20_000,
            assistantCostCents: 5_000,
            materialCostCents: 3_000,
            occupiedCourtHours: 4,
          },
        ]),
      },
      trainingEnrollment: {
        aggregate: vi.fn().mockResolvedValue({
          _sum: { prepaidBalanceCents: 400_000, refundedCents: 10_000 },
        }),
      },
    };
    const result = await new TrainingService(prisma as never).financialSummary(
      new Date('2026-08-01'),
      new Date('2026-09-01'),
    );
    expect(result.effectiveRevenueCents).toBe(150_000);
    expect(result.venueContractContributionCents).toBe(30_000);
    expect(result.venueFeeCents).toBe(0);
    expect(result.trainingPayableFromVenueCents).toBe(0);
    expect(result.coachCostCents).toBe(20_000);
    expect(result.assistantCostCents).toBe(5_000);
    expect(result.materialCostCents).toBe(3_000);
    expect(result.occupiedCourtHours).toBe(4);
  });
});

describe('TrainingService guardian and student records', () => {
  it('lets a guardian create an authorized child profile with an audit trail', async () => {
    const createdAt = new Date('2026-08-30T00:00:00.000Z');
    const student = {
      id: 'student-1',
      guardianId: guardian.sub,
      displayName: '小羽',
      birthMonth: new Date('2014-05-01T00:00:00.000Z'),
      guardianConsentStatus: true,
      authorizationNote: '监护人通过小程序确认授权',
      guardian: { id: guardian.sub, displayName: guardian.displayName },
      createdAt,
      updatedAt: createdAt,
    };
    const tx = {
      user: { findFirst: vi.fn().mockResolvedValue({ id: guardian.sub }) },
      student: { create: vi.fn().mockResolvedValue(student) },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
    };
    const prisma = { $transaction: txRunner(tx) };
    const service = new TrainingService(prisma as never);

    await expect(
      service.createStudent(
        {
          displayName: ' 小羽 ',
          birthMonth: '2014-05-01T00:00:00.000Z',
          guardianConsentStatus: true,
        },
        guardian,
      ),
    ).resolves.toBe(student);

    expect(tx.student.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        guardianId: guardian.sub,
        displayName: '小羽',
        birthMonth: new Date('2014-05-01T00:00:00.000Z'),
        guardianConsentStatus: true,
        authorizationNote: '监护人通过小程序确认授权',
      }),
      include: { guardian: { select: { id: true, displayName: true } } },
    });
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorId: guardian.sub,
        action: 'TRAINING_STUDENT_CREATED',
        objectId: student.id,
      }),
    });
  });

  it('prevents a member from creating or listing another guardian’s child profile', async () => {
    const service = new TrainingService({} as never);

    await expect(
      service.createStudent(
        {
          displayName: '他人学员',
          guardianId: 'guardian-2',
          guardianConsentStatus: false,
        },
        guardian,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.listStudents(guardian, true)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('requires staff to record authorization evidence when acting for a guardian', async () => {
    const service = new TrainingService({} as never);

    await expect(
      service.createStudent(
        {
          displayName: '线下登记学员',
          guardianId: 'guardian-2',
          guardianConsentStatus: true,
        },
        administrator,
      ),
    ).rejects.toThrow('必须填写授权凭证说明');
  });

  it('rechecks ownership before updating a student record', async () => {
    const tx = {
      student: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'student-2',
          guardianId: 'guardian-2',
          displayName: '其他学员',
          birthMonth: null,
          guardianConsentStatus: false,
          authorizationNote: null,
          guardian: { id: 'guardian-2', displayName: '其他家长' },
        }),
        update: vi.fn(),
      },
      auditLog: { create: vi.fn() },
    };
    const service = new TrainingService({
      $transaction: txRunner(tx),
    } as never);

    await expect(
      service.updateStudent(
        'student-2',
        { guardianConsentStatus: true },
        guardian,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(tx.student.update).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });
});

describe('TrainingService class seat reservations', () => {
  const product = {
    id: 'product-1',
    name: '成人进阶班课包',
    audience: TrainingAudience.ADULT,
    totalSessions: 10,
    validityDays: 120,
    priceCents: 100_000,
    unitRevenueCents: 10_000,
    refundRule: {},
    enabled: true,
  };
  const trainingClass = {
    id: 'class-1',
    productId: product.id,
    active: true,
    capacity: 4,
  };

  function purchasePrisma(
    occupiedSeats: number,
    sameLearner: object | null = null,
  ) {
    const tx = {
      trainingClass: { findFirst: vi.fn().mockResolvedValue(trainingClass) },
      trainingEnrollment: {
        findFirst: vi.fn().mockResolvedValue(sameLearner),
        count: vi.fn().mockResolvedValue(occupiedSeats),
      },
      order: {
        create: vi.fn().mockResolvedValue({
          id: 'order-1',
          orderNo: 'TR001',
          trainingEnrollment: { id: 'enrollment-1' },
          items: [],
        }),
      },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
    };
    return {
      tx,
      prisma: {
        trainingProduct: { findUnique: vi.fn().mockResolvedValue(product) },
        trainingClass: { findFirst: vi.fn().mockResolvedValue(trainingClass) },
        $transaction: txRunner(tx),
      },
    };
  }

  it('reserves an available class seat for a bounded payment window', async () => {
    const { prisma, tx } = purchasePrisma(3);
    const service = new TrainingService(prisma as never);

    await expect(
      service.purchase(
        {
          productId: product.id,
          classId: trainingClass.id,
          sourceChannel: 'MINI_PROGRAM' as never,
        },
        guardian,
      ),
    ).resolves.toMatchObject({ id: 'order-1' });

    expect(tx.order.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          parameterSnapshot: expect.objectContaining({
            classId: trainingClass.id,
            seatReservedUntil: expect.any(String),
          }),
          trainingEnrollment: {
            create: expect.objectContaining({
              classId: trainingClass.id,
              seatReservedUntil: expect.any(Date),
            }),
          },
        }),
      }),
    );
  });

  it('rejects full classes and duplicate active reservations before creating an order', async () => {
    const full = purchasePrisma(trainingClass.capacity);
    await expect(
      new TrainingService(full.prisma as never).purchase(
        {
          productId: product.id,
          classId: trainingClass.id,
          sourceChannel: 'MINI_PROGRAM' as never,
        },
        guardian,
      ),
    ).rejects.toThrow('班级名额已满');
    expect(full.tx.order.create).not.toHaveBeenCalled();

    const duplicate = purchasePrisma(1, { id: 'enrollment-existing' });
    await expect(
      new TrainingService(duplicate.prisma as never).purchase(
        {
          productId: product.id,
          classId: trainingClass.id,
          sourceChannel: 'MINI_PROGRAM' as never,
        },
        guardian,
      ),
    ).rejects.toThrow('已报名本班');
    expect(duplicate.tx.trainingEnrollment.count).not.toHaveBeenCalled();
    expect(duplicate.tx.order.create).not.toHaveBeenCalled();
  });
});

describe('TrainingService consumption workflow', () => {
  const dto: ConsumeTrainingDto = {
    enrollmentId: 'enrollment-1',
    feedback: '已到场，完成本次训练',
    attendanceStatus: 'PRESENT',
  };

  it('lets a coach submit a recommendation without posting financial entries', async () => {
    const { prisma, tx } = consumePrisma();
    const service = new TrainingService(prisma as never);

    const result = await service.consume('session-1', dto, coach);

    expect(result).toMatchObject({
      workflowStatus: 'PENDING_CONFIRMATION',
      proposedById: coach.sub,
    });
    expect(tx.trainingAttendance.update).toHaveBeenCalledWith({
      where: { id: 'attendance-1' },
      data: { operatorId: coach.sub, feedback: dto.feedback },
    });
    expect(tx.trainingEnrollment.update).not.toHaveBeenCalled();
    expect(tx.trainingRevenueRecognition.create).not.toHaveBeenCalled();
    expect(tx.account.update).not.toHaveBeenCalled();
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'TRAINING_CONSUME_PROPOSED',
        objectId: 'attendance-1',
      }),
    });
  });

  it('makes a repeated proposal by the same coach idempotent', async () => {
    const { prisma, tx } = consumePrisma(
      attendanceFixture({ operatorId: coach.sub, feedback: '已提交' }),
    );
    const service = new TrainingService(prisma as never);

    const result = await service.proposeConsume('session-1', dto, coach);

    expect(result).toMatchObject({
      workflowStatus: 'PENDING_CONFIRMATION',
      proposedById: coach.sub,
    });
    expect(tx.trainingAttendance.update).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });

  it('allows an administrator to confirm once and records maker/checker audit data', async () => {
    const { prisma, tx, updatedAttendance } = consumePrisma(
      attendanceFixture({ operatorId: coach.sub, feedback: '教练建议' }),
    );
    const service = new TrainingService(prisma as never);

    const result = await service.confirmConsume(
      'session-1',
      { enrollmentId: 'enrollment-1', reason: '核对签到表' },
      administrator,
    );

    expect(result).toMatchObject({
      id: 'recognition-1',
      attendanceId: 'attendance-1',
    });
    expect(updatedAttendance).toMatchObject({
      status: AttendanceStatus.ATTENDED,
      consumedSessions: 1,
      operatorId: administrator.sub,
    });
    expect(tx.trainingEnrollment.update).toHaveBeenCalledWith({
      where: { id: 'enrollment-1' },
      data: expect.objectContaining({
        consumedSessions: 1,
        confirmedRevenueCents: { increment: 19_800 },
        prepaidBalanceCents: { decrement: 19_800 },
      }),
    });
    expect(tx.trainingRevenueRecognition.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        attendanceId: 'attendance-1',
        effectiveRevenueCents: 19_800,
        venueContributionCents: 3_960,
        venueFeeCents: 0,
      }),
    });
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorId: administrator.sub,
        action: 'TRAINING_CONSUME_CONFIRMED',
        oldValue: expect.objectContaining({ proposedById: coach.sub }),
        reason: '核对签到表',
      }),
    });
  });

  it('keeps a partially refunded enrollment serviceable until its remaining prepaid balance is consumed', async () => {
    const base = attendanceFixture();
    const { prisma, tx } = consumePrisma(
      attendanceFixture({
        operatorId: coach.sub,
        enrollment: {
          ...base.enrollment,
          status: TrainingEnrollmentStatus.PARTIALLY_REFUNDED,
          prepaidBalanceCents: 30_000,
        },
      }),
    );
    const service = new TrainingService(prisma as never);

    await expect(
      service.confirmConsume(
        'session-1',
        { enrollmentId: 'enrollment-1', reason: '核对剩余课时' },
        administrator,
      ),
    ).resolves.toMatchObject({ id: 'recognition-1' });
    expect(tx.trainingEnrollment.update).toHaveBeenCalledWith({
      where: { id: 'enrollment-1' },
      data: expect.objectContaining({
        status: TrainingEnrollmentStatus.PARTIALLY_REFUNDED,
      }),
    });
  });

  it('rejects administrator confirmation when no coach proposal exists', async () => {
    const { prisma, tx } = consumePrisma();
    const service = new TrainingService(prisma as never);

    await expect(
      service.consume('session-1', dto, administrator),
    ).rejects.toThrow('必须先由教练提交消课建议');
    expect(tx.trainingRevenueRecognition.create).not.toHaveBeenCalled();
    expect(tx.trainingEnrollment.update).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });

  it('rejects a configured training contract rate other than the locked 20 percent', async () => {
    const { prisma, tx } = consumePrisma(
      attendanceFixture({ operatorId: coach.sub }),
    );
    tx.systemParameter.findFirst.mockResolvedValue({ value: 2_500 });
    const service = new TrainingService(prisma as never);

    await expect(
      service.confirmConsume(
        'session-1',
        { enrollmentId: 'enrollment-1' },
        administrator,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.trainingRevenueRecognition.create).not.toHaveBeenCalled();
    expect(tx.trainingEnrollment.update).not.toHaveBeenCalled();
  });

  it('returns the immutable active recognition on a confirmation retry', async () => {
    const { prisma, tx } = consumePrisma(
      attendanceFixture({
        operatorId: coach.sub,
        revenueRecognitions: [
          {
            id: 'recognition-1',
            type: 'CONSUME',
            sequence: 1,
            reversedBy: null,
          },
        ],
      }),
    );
    const service = new TrainingService(prisma as never);

    await expect(
      service.confirmConsume(
        'session-1',
        { enrollmentId: 'enrollment-1' },
        administrator,
      ),
    ).resolves.toMatchObject({ id: 'recognition-1', type: 'CONSUME' });
    expect(tx.trainingAttendance.update).not.toHaveBeenCalled();
    expect(tx.trainingEnrollment.update).not.toHaveBeenCalled();
    expect(tx.trainingRevenueRecognition.create).not.toHaveBeenCalled();
  });

  it('accepts only an exact keyed consume-confirmation replay and never duplicates its audit', async () => {
    const reason = '核对签到表后确认';
    const idempotencyKey = 'consume-confirm-exact-1';
    const recognition = {
      id: 'recognition-1',
      attendanceId: 'attendance-1',
      type: 'CONSUME',
      sequence: 1,
      idempotencyKey,
      reversedBy: null,
    };
    const { prisma, tx } = consumePrisma(
      attendanceFixture({
        operatorId: coach.sub,
        revenueRecognitions: [recognition],
      }),
    );
    const commandHash = orderCreationCommandHash({
      kind: 'TRAINING_CONSUME_CONFIRMED',
      sessionId: 'session-1',
      enrollmentId: 'enrollment-1',
      feedback: null,
      reason,
    });
    tx.auditLog.findFirst.mockResolvedValue({
      actorId: administrator.sub,
      action: 'TRAINING_CONSUME_CONFIRMED',
      objectType: 'TrainingAttendance',
      objectId: 'attendance-1',
      newValue: { commandHash },
    });
    const service = new TrainingService(prisma as never);

    await expect(
      service.confirmConsume(
        'session-1',
        { enrollmentId: 'enrollment-1', reason, idempotencyKey },
        administrator,
      ),
    ).resolves.toBe(recognition);
    await expect(
      service.confirmConsume(
        'session-1',
        {
          enrollmentId: 'enrollment-1',
          reason: '同一幂等键却更换确认原因',
          idempotencyKey,
        },
        administrator,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(tx.trainingAttendance.update).not.toHaveBeenCalled();
    expect(tx.trainingRevenueRecognition.create).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });

  it('enforces maker/checker separation when a proposal was submitted by the approver account', async () => {
    const { prisma, tx } = consumePrisma(
      attendanceFixture({ operatorId: administrator.sub }),
    );
    const service = new TrainingService(prisma as never);

    await expect(
      service.confirmConsume(
        'session-1',
        { enrollmentId: 'enrollment-1' },
        administrator,
      ),
    ).rejects.toThrow('提交人与确认人不能是同一账号');
    expect(tx.trainingAttendance.update).not.toHaveBeenCalled();
    expect(tx.trainingEnrollment.update).not.toHaveBeenCalled();
    expect(tx.trainingRevenueRecognition.create).not.toHaveBeenCalled();
  });

  it.each([
    TrainingSessionStatus.COMPLETED,
    TrainingSessionStatus.CANCELLED,
  ])('rejects new consume work after the session reaches %s', async (status) => {
    const closedSession = {
      status,
      startsAt: new Date('2026-08-29T10:00:00.000Z'),
      class: { name: '成人进阶班', coachId: coach.sub, assistantId: null },
    };
    const proposal = consumePrisma(attendanceFixture({ session: closedSession }));
    const confirmation = consumePrisma(
      attendanceFixture({ session: closedSession, operatorId: coach.sub }),
    );

    await expect(
      new TrainingService(proposal.prisma as never).proposeConsume(
        'session-1',
        dto,
        coach,
      ),
    ).rejects.toThrow('已结束或已取消的课次不能继续消课');
    await expect(
      new TrainingService(confirmation.prisma as never).confirmConsume(
        'session-1',
        { enrollmentId: 'enrollment-1' },
        administrator,
      ),
    ).rejects.toThrow('已结束或已取消的课次不能继续消课');
    expect(proposal.tx.trainingAttendance.update).not.toHaveBeenCalled();
    expect(confirmation.tx.trainingRevenueRecognition.create).not.toHaveBeenCalled();
  });

  it('rejects non-coach/non-approver actors and never opens a transaction', async () => {
    const { prisma } = consumePrisma();
    const service = new TrainingService(prisma as never);
    const frontDesk: AuthUser = {
      sub: 'front-desk-1',
      displayName: '前台',
      roles: [AppRole.FRONT_DESK],
    };

    await expect(
      service.consume('session-1', dto, frontDesk),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      service.confirmConsume(
        'session-1',
        { enrollmentId: 'enrollment-1' },
        coach,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('keeps a session open while an attended learner is not yet consumed', async () => {
    const count = vi.fn().mockResolvedValue(1);
    const tx = {
      trainingAttendance: { count },
      trainingSession: { update: vi.fn() },
      auditLog: { create: vi.fn() },
    };
    const prisma = { $transaction: txRunner(tx) };
    const service = new TrainingService(prisma as never);

    await expect(service.completeSession('session-1', coach)).rejects.toThrow(
      '仍有学员未完成点名或消课',
    );
    expect(count).toHaveBeenCalledWith({
      where: {
        sessionId: 'session-1',
        OR: [
          {
            status: {
              in: [
                AttendanceStatus.PENDING,
                AttendanceStatus.LEAVE,
                AttendanceStatus.MAKEUP_REQUIRED,
              ],
            },
          },
          {
            status: AttendanceStatus.ATTENDED,
            consumedSessions: 0,
          },
        ],
      },
    });
    expect(tx.trainingSession.update).not.toHaveBeenCalled();
  });
});

describe('TrainingService attendance workflow', () => {
  const attendanceAction: AttendanceActionDto = {
    enrollmentId: 'enrollment-1',
    status: AttendanceStatus.ATTENDED,
    feedback: '到场训练',
  };

  const attendancePrisma = (overrides: Record<string, unknown> = {}) => {
    const attendance = attendanceFixture({
      status: AttendanceStatus.PENDING,
      checkedInAt: null,
      session: {
        startsAt: new Date('2026-08-29T10:00:00.000Z'),
        classId: 'class-1',
        class: { name: '成人进阶班', coachId: coach.sub, assistantId: null },
      },
      ...overrides,
    });
    const updated = { ...attendance };
    const tx = {
      trainingAttendance: {
        findUnique: vi.fn().mockResolvedValue(attendance),
        update: vi
          .fn()
          .mockImplementation(({ data }: { data: Record<string, unknown> }) => {
            Object.assign(updated, data);
            return Promise.resolve(updated);
          }),
      },
      trainingSession: { findUnique: vi.fn() },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
    };
    return { prisma: { $transaction: txRunner(tx) }, tx, attendance, updated };
  };

  it('records attendance without creating a revenue recognition', async () => {
    const { prisma, tx, updated } = attendancePrisma();
    const result = await new TrainingService(prisma as never).markAttendance(
      'session-1',
      attendanceAction,
      coach,
    );
    expect(result).toMatchObject({
      status: AttendanceStatus.ATTENDED,
      operatorId: null,
    });
    expect(updated.operatorId).toBeNull();
    expect(updated.checkedInAt).toBeInstanceOf(Date);
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: 'TRAINING_ATTENDANCE_MARKED' }),
    });
  });

  it('turns an approved leave into a makeup-required record and requires a reason', async () => {
    const { prisma, tx, updated } = attendancePrisma();
    await expect(
      new TrainingService(prisma as never).markAttendance(
        'session-1',
        {
          enrollmentId: 'enrollment-1',
          status: AttendanceStatus.LEAVE,
        },
        coach,
      ),
    ).rejects.toThrow('必须填写原因');

    const result = await new TrainingService(prisma as never).markAttendance(
      'session-1',
      {
        enrollmentId: 'enrollment-1',
        status: AttendanceStatus.LEAVE,
        reason: '家长提前请假',
      },
      coach,
    );
    expect(result).toMatchObject({ status: AttendanceStatus.MAKEUP_REQUIRED });
    expect(updated.status).toBe(AttendanceStatus.MAKEUP_REQUIRED);
    expect(tx.auditLog.create).toHaveBeenCalled();
  });

  it('assigns a leave record to a later session without consuming another lesson', async () => {
    const { prisma, tx, updated } = attendancePrisma({
      status: AttendanceStatus.MAKEUP_REQUIRED,
    });
    const target = {
      id: 'session-2',
      classId: 'class-1',
      startsAt: new Date('2026-09-01T10:00:00.000Z'),
      status: 'SCHEDULED',
      class: { coachId: coach.sub, assistantId: null },
      attendances: [
        { id: 'target-attendance', status: AttendanceStatus.PENDING },
      ],
    };
    tx.trainingSession.findUnique.mockResolvedValue(target);
    const dto: MakeupAttendanceDto = {
      enrollmentId: 'enrollment-1',
      makeupSessionId: 'session-2',
      reason: '安排下周补课',
    };
    const result = await new TrainingService(prisma as never).scheduleMakeup(
      'session-1',
      dto,
      coach,
    );
    expect(result).toMatchObject({
      workflowStatus: 'MAKEUP_SCHEDULED',
      targetAttendanceId: 'target-attendance',
    });
    expect(updated.status).toBe(AttendanceStatus.MADE_UP);
    expect(tx.trainingAttendance.update).toHaveBeenCalled();
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: 'TRAINING_MAKEUP_SCHEDULED' }),
    });
  });

  it("does not let a coach operate another coach's class", async () => {
    const { prisma } = attendancePrisma({
      session: {
        startsAt: new Date('2026-08-29T10:00:00.000Z'),
        class: { name: '其他班', coachId: 'other-coach', assistantId: null },
      },
    });
    await expect(
      new TrainingService(prisma as never).markAttendance(
        'session-1',
        attendanceAction,
        coach,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
