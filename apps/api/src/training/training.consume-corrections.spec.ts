import { ConflictException, ForbiddenException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import type { AuthUser } from '../common/auth/auth-user.js';
import {
  AccountType,
  AppRole,
  AttendanceStatus,
  OrderStatus,
  TrainingAudience,
  TrainingConsumeCorrectionStatus,
  TrainingEnrollmentStatus,
  TrainingRecognitionType,
  Prisma,
} from '../generated/prisma/client.js';
import { TrainingService } from './training.service.js';

const coach: AuthUser = {
  sub: 'coach-1',
  displayName: '教练',
  roles: [AppRole.COACH],
};
const admin: AuthUser = {
  sub: 'admin-1',
  displayName: '管理员',
  roles: [AppRole.ADMIN],
};
const transaction = (tx: Record<string, unknown>) =>
  vi.fn(async (work: (client: Record<string, unknown>) => unknown) =>
    work({
      reconciliationPeriod: { findFirst: vi.fn().mockResolvedValue(null) },
      ...tx,
    }),
  );

const positiveRecognition = {
  id: 'recognition-1',
  attendanceId: 'attendance-1',
  enrollmentId: 'enrollment-1',
  type: TrainingRecognitionType.CONSUME,
  sequence: 1,
  effectiveRevenueCents: 19_800,
  contractRateBps: 2_000,
  venueContributionCents: 3_960,
  venueFeeCents: 0,
  trainingPayableVenueCents: 0,
  settlementId: null,
  idempotencyKey: 'consume-original-1',
  reversedBy: null,
};

const correctionFixture = (overrides: Record<string, unknown> = {}) => ({
  id: 'correction-1',
  recognitionId: positiveRecognition.id,
  attendanceId: 'attendance-1',
  status: TrainingConsumeCorrectionStatus.REQUESTED,
  reason: '误将请假学员确认消课',
  requestedById: coach.sub,
  reviewedById: null,
  reviewReason: null,
  requestedAt: new Date('2026-08-20T10:05:00Z'),
  reviewedAt: null,
  requestIdempotencyKey: 'correction-secret-request-key',
  reversalRecognitionId: null,
  decisionIdempotencyKey: null,
  recognition: positiveRecognition,
  reversalRecognition: null,
  attendance: {
    id: 'attendance-1',
    status: AttendanceStatus.ATTENDED,
    consumedSessions: 1,
    confirmedRevenueCents: 19_800,
    growthPointsAwarded: 1,
    checkedInAt: new Date('2026-08-20T10:00:00Z'),
    session: {
      startsAt: new Date('2026-08-20T09:00:00Z'),
      endsAt: new Date('2026-08-20T10:00:00Z'),
    },
    enrollment: {
      id: 'enrollment-1',
      buyerId: 'member-1',
      status: TrainingEnrollmentStatus.COMPLETED,
      consumedSessions: 10,
      confirmedRevenueCents: 198_000,
      prepaidBalanceCents: 0,
      refundedCents: 0,
      product: { audience: TrainingAudience.YOUTH },
    },
  },
  ...overrides,
});

describe('Training consume corrections', () => {
  it('creates an immutable correction request and replays its idempotency key', async () => {
    const correction = correctionFixture();
    const tx = {
      trainingRevenueRecognition: {
        findUnique: vi.fn().mockResolvedValue({
          ...positiveRecognition,
          attendance: {
            session: { class: { coachId: coach.sub, assistantId: null } },
          },
        }),
      },
      trainingConsumeCorrection: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue(correction),
      },
      auditLog: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({}),
      },
    };
    const findUnique = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValue(correction);
    const prisma = {
      trainingConsumeCorrection: { findUnique },
      $transaction: transaction(tx),
    };
    const service = new TrainingService(prisma as never);
    const command = {
      recognitionId: positiveRecognition.id,
      reason: correction.reason,
      idempotencyKey: 'correction-request-1',
    };

    await expect(
      service.requestConsumeCorrection(command, coach),
    ).resolves.toMatchObject({ id: correction.id, status: correction.status });
    await expect(
      service.requestConsumeCorrection(command, coach),
    ).resolves.toMatchObject({ id: correction.id, status: correction.status });
    expect(tx.trainingConsumeCorrection.create).toHaveBeenCalledOnce();
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorId: coach.sub,
        action: 'TRAINING_CONSUME_CORRECTION_REQUESTED',
        reason: correction.reason,
      }),
    });
  });

  it('enforces maker/checker separation before any reversal mutation', async () => {
    const correction = correctionFixture({ requestedById: admin.sub });
    const tx = {
      trainingConsumeCorrection: {
        findUnique: vi.fn().mockResolvedValue(correction),
      },
      trainingRevenueRecognition: { create: vi.fn() },
      trainingEnrollment: { updateMany: vi.fn() },
      trainingAttendance: { updateMany: vi.fn() },
    };
    const service = new TrainingService({
      trainingConsumeCorrection: {
        findUnique: vi.fn().mockResolvedValue(null),
      },
      $transaction: transaction(tx),
    } as never);

    await expect(
      service.approveConsumeCorrection(
        correction.id,
        { idempotencyKey: 'correction-decision-1' },
        admin,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(tx.trainingRevenueRecognition.create).not.toHaveBeenCalled();
    expect(tx.trainingEnrollment.updateMany).not.toHaveBeenCalled();
  });

  it('scopes coach correction lists and rejects a foreign class correction request', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const service = new TrainingService({
      trainingConsumeCorrection: {
        findMany,
        findUnique: vi.fn().mockResolvedValue(null),
      },
      $transaction: transaction({
        trainingRevenueRecognition: {
          findUnique: vi.fn().mockResolvedValue({
            ...positiveRecognition,
            attendance: {
              session: { class: { coachId: 'other-coach', assistantId: null } },
            },
          }),
        },
      }),
    } as never);

    await service.listConsumeCorrections(coach);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          attendance: {
            session: {
              class: {
                OR: [{ coachId: coach.sub }, { assistantId: coach.sub }],
              },
            },
          },
        },
      }),
    );
    await expect(
      service.requestConsumeCorrection(
        {
          recognitionId: positiveRecognition.id,
          reason: '申请冲正误消课',
          idempotencyKey: 'foreign-correction-1',
        },
        coach,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('returns correction workflow fields without ledger idempotency or cost evidence', async () => {
    const raw = correctionFixture({
      recognition: {
        ...positiveRecognition,
        createdAt: new Date('2026-08-20T10:00:00Z'),
      },
      requestedBy: { id: coach.sub, displayName: coach.displayName },
      reviewedBy: null,
    });
    const service = new TrainingService({
      trainingConsumeCorrection: {
        findMany: vi.fn().mockResolvedValue([raw]),
      },
    } as never);

    const [view] = await service.listConsumeCorrections(coach);

    expect(view).toMatchObject({
      id: raw.id,
      recognition: {
        id: positiveRecognition.id,
        effectiveRevenueCents: positiveRecognition.effectiveRevenueCents,
      },
      requestedBy: { displayName: coach.displayName },
    });
    expect(view).not.toHaveProperty('requestIdempotencyKey');
    expect(view.recognition).not.toHaveProperty('idempotencyKey');
    expect(view.recognition).not.toHaveProperty('contractRateBps');
    expect(view.recognition).not.toHaveProperty('venueContributionCents');
  });

  it('does not replay a request idempotency key across actors', async () => {
    const correction = correctionFixture();
    const service = new TrainingService({
      trainingConsumeCorrection: {
        findUnique: vi.fn().mockResolvedValue(correction),
      },
    } as never);

    await expect(
      service.requestConsumeCorrection(
        {
          recognitionId: correction.recognitionId,
          reason: correction.reason,
          idempotencyKey: 'correction-request-1',
        },
        admin,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('resolves a same-command P2002 race but rejects a second active request', async () => {
    const correction = correctionFixture();
    const p2002 = new Prisma.PrismaClientKnownRequestError('unique conflict', {
      code: 'P2002',
      clientVersion: 'test',
    });
    const sameKeyFind = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValue(correction);
    const replayService = new TrainingService({
      trainingConsumeCorrection: {
        findUnique: sameKeyFind,
        findFirst: vi.fn(),
      },
      $transaction: vi.fn().mockRejectedValue(p2002),
    } as never);
    await expect(
      replayService.requestConsumeCorrection(
        {
          recognitionId: correction.recognitionId,
          reason: correction.reason,
          idempotencyKey: 'correction-request-1',
        },
        coach,
      ),
    ).resolves.toMatchObject({ id: correction.id, status: correction.status });

    const activeService = new TrainingService({
      trainingConsumeCorrection: {
        findUnique: vi.fn().mockResolvedValue(null),
        findFirst: vi.fn().mockResolvedValue(correction),
      },
      $transaction: vi.fn().mockRejectedValue(p2002),
    } as never);
    await expect(
      activeService.requestConsumeCorrection(
        {
          recognitionId: correction.recognitionId,
          reason: correction.reason,
          idempotencyKey: 'different-request-key',
        },
        coach,
      ),
    ).rejects.toThrow('已有待处理或已批准');
  });

  it('posts signed reversal, rolls balances back and debits youth growth points atomically', async () => {
    const correction = correctionFixture();
    const reversal = {
      id: 'recognition-reversal-1',
      attendanceId: 'attendance-1',
      enrollmentId: 'enrollment-1',
      type: TrainingRecognitionType.REVERSAL,
      sequence: 2,
      effectiveRevenueCents: -19_800,
      venueContributionCents: -3_960,
      venueFeeCents: 0,
      trainingPayableVenueCents: 0,
      reversalOfId: positiveRecognition.id,
      settlementId: null,
    };
    const tx = {
      trainingConsumeCorrection: {
        findUnique: vi.fn().mockResolvedValue(correction),
        update: vi.fn().mockResolvedValue({
          ...correction,
          status: TrainingConsumeCorrectionStatus.APPROVED,
          reversalRecognition: reversal,
        }),
      },
      trainingRevenueRecognition: {
        aggregate: vi.fn().mockResolvedValue({ _max: { sequence: 1 } }),
        create: vi.fn().mockResolvedValue(reversal),
      },
      trainingEnrollment: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      trainingAttendance: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      account: {
        findUnique: vi
          .fn()
          .mockResolvedValue({ id: 'growth-1', balance: 5, version: 2 }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      accountTransaction: {
        create: vi.fn().mockResolvedValue({ id: 'growth-reversal-1' }),
      },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
    };
    const service = new TrainingService({
      trainingConsumeCorrection: {
        findUnique: vi.fn().mockResolvedValue(null),
      },
      $transaction: transaction(tx),
    } as never);

    await service.approveConsumeCorrection(
      correction.id,
      {
        reason: '查看请假凭证确认误消',
        idempotencyKey: 'correction-decision-2',
      },
      admin,
    );

    expect(tx.trainingRevenueRecognition.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        type: TrainingRecognitionType.REVERSAL,
        sequence: 2,
        reversalOfId: positiveRecognition.id,
        effectiveRevenueCents: -19_800,
        venueContributionCents: -3_960,
        venueFeeCents: 0,
        trainingPayableVenueCents: 0,
      }),
    });
    expect(tx.trainingEnrollment.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        id: 'enrollment-1',
        consumedSessions: 10,
      }),
      data: expect.objectContaining({
        consumedSessions: { decrement: 1 },
        confirmedRevenueCents: { decrement: 19_800 },
        prepaidBalanceCents: { increment: 19_800 },
        status: TrainingEnrollmentStatus.ACTIVE,
      }),
    });
    expect(tx.trainingAttendance.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        id: 'attendance-1',
        consumedSessions: 1,
      }),
      data: expect.objectContaining({
        status: AttendanceStatus.ATTENDED,
        consumedSessions: 0,
        confirmedRevenueCents: 0,
        growthPointsAwarded: 0,
      }),
    });
    expect(tx.account.findUnique).toHaveBeenCalledWith({
      where: {
        userId_type: { userId: 'member-1', type: AccountType.GROWTH_POINTS },
      },
    });
    expect(tx.accountTransaction.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        amount: -1,
        balanceBefore: 5,
        balanceAfter: 4,
        reasonCode: 'TRAINING_GROWTH_REVERSAL',
      }),
    });
  });

  it('rejects a correction after its recognition entered a settlement', async () => {
    const correction = correctionFixture({
      recognition: {
        ...positiveRecognition,
        settlementId: 'settlement-closed-1',
      },
    });
    const tx = {
      trainingConsumeCorrection: {
        findUnique: vi.fn().mockResolvedValue(correction),
      },
      trainingRevenueRecognition: {
        aggregate: vi.fn(),
        create: vi.fn(),
      },
    };
    const service = new TrainingService({
      trainingConsumeCorrection: { findUnique: vi.fn().mockResolvedValue(null) },
      $transaction: transaction(tx),
    } as never);

    await expect(
      service.approveConsumeCorrection(
        correction.id,
        { idempotencyKey: 'correction-settled-decision-1' },
        admin,
      ),
    ).rejects.toThrow('已进入结算单')
    expect(tx.trainingRevenueRecognition.aggregate).not.toHaveBeenCalled()
    expect(tx.trainingRevenueRecognition.create).not.toHaveBeenCalled()
  });

  it('rejects a correction in a locked business day before writing reversal', async () => {
    const correction = correctionFixture();
    const tx = {
      trainingConsumeCorrection: {
        findUnique: vi.fn().mockResolvedValue(correction),
      },
      reconciliationPeriod: {
        findFirst: vi.fn().mockResolvedValue({
          businessDate: new Date('2026-08-19T16:00:00.000Z'),
        }),
      },
      trainingRevenueRecognition: {
        aggregate: vi.fn(),
        create: vi.fn(),
      },
    };
    const service = new TrainingService({
      trainingConsumeCorrection: { findUnique: vi.fn().mockResolvedValue(null) },
      $transaction: transaction(tx),
    } as never);

    await expect(
      service.approveConsumeCorrection(
        correction.id,
        { idempotencyKey: 'correction-locked-decision-1' },
        admin,
      ),
    ).rejects.toThrow('不能批准消课冲正')
    expect(tx.trainingRevenueRecognition.aggregate).not.toHaveBeenCalled()
    expect(tx.trainingRevenueRecognition.create).not.toHaveBeenCalled()
  });

  it.each([
    [OrderStatus.COMPLETED, OrderStatus.PAID],
    [OrderStatus.PARTIALLY_REFUNDED, OrderStatus.PARTIALLY_REFUNDED],
    [OrderStatus.REFUND_PENDING, OrderStatus.REFUND_PENDING],
  ])(
    'reopens a completed training order from %s as %s when the final consume is reversed',
    async (orderStatus, expectedStatus) => {
      const base = correctionFixture();
      const completedAt = new Date('2026-08-20T12:00:00.000Z');
      const correction = correctionFixture({
        attendance: {
          ...base.attendance,
          growthPointsAwarded: 0,
          enrollment: {
            ...base.attendance.enrollment,
            refundedCents:
              orderStatus === OrderStatus.COMPLETED ? 0 : 1_000,
            product: { audience: TrainingAudience.ADULT },
            order: {
              id: 'order-training-1',
              status: orderStatus,
              completedAt,
            },
          },
        },
      });
      const reversal = {
        id: 'recognition-reversal-1',
        effectiveRevenueCents: -19_800,
        venueContributionCents: -3_960,
      };
      const orderUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
      const auditCreate = vi.fn().mockResolvedValue({});
      const tx = {
        trainingConsumeCorrection: {
          findUnique: vi.fn().mockResolvedValue(correction),
          update: vi.fn().mockResolvedValue({
            ...correction,
            status: TrainingConsumeCorrectionStatus.APPROVED,
          }),
        },
        trainingRevenueRecognition: {
          aggregate: vi.fn().mockResolvedValue({ _max: { sequence: 1 } }),
          create: vi.fn().mockResolvedValue(reversal),
        },
        trainingEnrollment: {
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        },
        trainingAttendance: {
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        },
        order: {
          updateMany: orderUpdateMany,
          findUnique: vi.fn(),
        },
        auditLog: { create: auditCreate },
      };
      const service = new TrainingService({
        trainingConsumeCorrection: {
          findUnique: vi.fn().mockResolvedValue(null),
        },
        $transaction: transaction(tx),
      } as never);

      await service.approveConsumeCorrection(
        correction.id,
        {
          reason: '复核确认最后一节误消',
          idempotencyKey: `correction-reopen-${orderStatus}`,
        },
        admin,
      );

      expect(orderUpdateMany).toHaveBeenCalledWith({
        where: {
          id: 'order-training-1',
          status: orderStatus,
          completedAt,
        },
        data: {
          status: expectedStatus,
          completedAt: null,
        },
      });
      expect(
        auditCreate.mock.calls.filter(
          ([call]) => call.data.action === 'ORDER_FULFILLMENT_REOPENED',
        ),
      ).toHaveLength(1);
    },
  );

  it('rejects a correction without creating any reversal ledger row', async () => {
    const correction = correctionFixture();
    const rejected = {
      ...correction,
      status: TrainingConsumeCorrectionStatus.REJECTED,
      decisionIdempotencyKey: 'correction-reject-1',
    };
    const tx = {
      trainingConsumeCorrection: {
        findUnique: vi.fn().mockResolvedValue(correction),
        update: vi.fn().mockResolvedValue(rejected),
      },
      trainingRevenueRecognition: { create: vi.fn() },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
    };
    const service = new TrainingService({
      trainingConsumeCorrection: {
        findUnique: vi.fn().mockResolvedValue(null),
      },
      $transaction: transaction(tx),
    } as never);

    await expect(
      service.rejectConsumeCorrection(
        correction.id,
        { reason: '证据不足', idempotencyKey: 'correction-reject-1' },
        admin,
      ),
    ).resolves.toMatchObject({ id: rejected.id, status: rejected.status });
    expect(tx.trainingRevenueRecognition.create).not.toHaveBeenCalled();
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'TRAINING_CONSUME_CORRECTION_REJECTED',
        oldValue: { status: TrainingConsumeCorrectionStatus.REQUESTED },
        newValue: { status: TrainingConsumeCorrectionStatus.REJECTED },
      }),
    });
  });

  it('binds a decision idempotency key to one correction and one action', async () => {
    const used = correctionFixture({
      id: 'other-correction',
      status: TrainingConsumeCorrectionStatus.REJECTED,
      decisionIdempotencyKey: 'shared-decision-key',
    });
    const runTransaction = vi.fn();
    const service = new TrainingService({
      trainingConsumeCorrection: {
        findUnique: vi.fn().mockResolvedValue(used),
      },
      $transaction: runTransaction,
    } as never);

    await expect(
      service.approveConsumeCorrection(
        'correction-1',
        { idempotencyKey: 'shared-decision-key' },
        admin,
      ),
    ).rejects.toThrow('已用于其他申请或动作');
    expect(runTransaction).not.toHaveBeenCalled();
  });

  it('replays a correction decision only for the same checker and reason', async () => {
    const decided = correctionFixture({
      status: TrainingConsumeCorrectionStatus.REJECTED,
      decisionIdempotencyKey: 'correction-exact-decision-1',
      reviewedById: admin.sub,
      reviewReason: '证据不足，驳回申请',
    });
    const runTransaction = vi.fn();
    const service = new TrainingService({
      trainingConsumeCorrection: {
        findUnique: vi.fn().mockResolvedValue(decided),
      },
      $transaction: runTransaction,
    } as never);

    await expect(
      service.rejectConsumeCorrection(
        decided.id,
        {
          reason: decided.reviewReason as string,
          idempotencyKey: 'correction-exact-decision-1',
        },
        admin,
      ),
    ).resolves.toMatchObject({ id: decided.id, status: decided.status });
    await expect(
      service.rejectConsumeCorrection(
        decided.id,
        {
          reason: '同一幂等键却更换复核原因',
          idempotencyKey: 'correction-exact-decision-1',
        },
        admin,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(runTransaction).not.toHaveBeenCalled();
  });

  it('naturally reports a prior-period reversal as negative current-period revenue', async () => {
    const service = new TrainingService({
      trainingRevenueRecognition: {
        findMany: vi.fn().mockResolvedValue([
          {
            type: TrainingRecognitionType.REVERSAL,
            effectiveRevenueCents: -19_800,
            venueContributionCents: -3_960,
            contractRateBps: 2_000,
          },
        ]),
      },
      trainingSession: { findMany: vi.fn().mockResolvedValue([]) },
      trainingEnrollment: {
        aggregate: vi.fn().mockResolvedValue({ _sum: {} }),
      },
    } as never);

    const summary = await service.financialSummary(
      new Date('2026-09-01'),
      new Date('2026-10-01'),
    );
    expect(summary).toMatchObject({
      effectiveRevenueCents: -19_800,
      venueContractContributionCents: -3_960,
      venueFeeCents: 0,
      trainingPayableFromVenueCents: 0,
      consumeCount: 0,
      reversalCount: 1,
    });
  });

  it('rounds venue contribution from net revenue, not the sum of rounded rows', async () => {
    const service = new TrainingService({
      trainingRevenueRecognition: {
        findMany: vi.fn().mockResolvedValue([
          {
            type: TrainingRecognitionType.CONSUME,
            effectiveRevenueCents: 3,
            venueContributionCents: 1,
            contractRateBps: 2_000,
          },
          {
            type: TrainingRecognitionType.CONSUME,
            effectiveRevenueCents: 3,
            venueContributionCents: 1,
            contractRateBps: 2_000,
          },
        ]),
      },
      trainingSession: { findMany: vi.fn().mockResolvedValue([]) },
      trainingEnrollment: {
        aggregate: vi.fn().mockResolvedValue({ _sum: {} }),
      },
    } as never);

    const summary = await service.financialSummary(
      new Date('2026-09-01'),
      new Date('2026-10-01'),
    );
    expect(summary.effectiveRevenueCents).toBe(6);
    expect(summary.venueContractContributionCents).toBe(1);
  });

  it('allows the same attendance to be confirmed again at the next sequence after reversal', async () => {
    const attendance = {
      id: 'attendance-1',
      sessionId: 'session-1',
      enrollmentId: 'enrollment-1',
      status: AttendanceStatus.ATTENDED,
      consumedSessions: 0,
      confirmedRevenueCents: 0,
      growthPointsAwarded: 0,
      feedback: null,
      operatorId: coach.sub,
      session: {
        startsAt: new Date(Date.now() - 60 * 60_000),
        endsAt: new Date(Date.now() - 10 * 60_000),
        class: {},
      },
      enrollment: {
        id: 'enrollment-1',
        buyerId: 'member-1',
        status: TrainingEnrollmentStatus.ACTIVE,
        consumedSessions: 9,
        totalSessions: 10,
        confirmedRevenueCents: 178_200,
        prepaidBalanceCents: 19_800,
        refundedCents: 0,
        product: { audience: TrainingAudience.YOUTH, unitRevenueCents: 19_800 },
      },
      revenueRecognitions: [
        {
          ...positiveRecognition,
          reversedBy: { id: 'recognition-reversal-1' },
        },
        {
          id: 'recognition-reversal-1',
          type: TrainingRecognitionType.REVERSAL,
          sequence: 2,
          reversedBy: null,
        },
      ],
    };
    const tx = {
      trainingAttendance: {
        findUnique: vi.fn().mockResolvedValue(attendance),
        update: vi.fn().mockResolvedValue({}),
      },
      trainingEnrollment: { update: vi.fn().mockResolvedValue({}) },
      trainingRevenueRecognition: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({
          id: 'recognition-2',
          type: TrainingRecognitionType.CONSUME,
          sequence: 3,
        }),
      },
      systemParameter: {
        findFirst: vi.fn().mockResolvedValue({ value: 2_000 }),
      },
      reconciliationPeriod: {
        findFirst: vi.fn().mockResolvedValue(null),
      },
      account: {
        upsert: vi
          .fn()
          .mockResolvedValue({ id: 'growth-1', balance: 4, version: 3 }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      accountTransaction: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({ id: 'growth-credit-2' }),
      },
      auditLog: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({}),
      },
    };
    const service = new TrainingService({
      $transaction: transaction(tx),
    } as never);

    await service.confirmConsume(
      'session-1',
      { enrollmentId: 'enrollment-1', idempotencyKey: 'consume-again-1' },
      admin,
    );
    expect(tx.trainingRevenueRecognition.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        attendanceId: 'attendance-1',
        type: TrainingRecognitionType.CONSUME,
        sequence: 3,
        effectiveRevenueCents: 19_800,
        venueFeeCents: 0,
        trainingPayableVenueCents: 0,
        idempotencyKey: 'consume-again-1',
      }),
    });
    expect(tx.accountTransaction.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        amount: 1,
        balanceBefore: 4,
        balanceAfter: 5,
        idempotencyKey: 'GROWTH:attendance-1:3',
      }),
    });
  });
});
