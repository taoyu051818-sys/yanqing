import { ConflictException, ForbiddenException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import type { AuthUser } from '../common/auth/auth-user.js';
import {
  AppRole,
  TrainingAudience,
  TrainingSessionStatus,
} from '../generated/prisma/enums.js';
import type {
  CreateTrainingClassDto,
  CreateTrainingProductDto,
  CreateTrainingSessionDto,
} from './training.dto.js';
import { TrainingService } from './training.service.js';

const admin: AuthUser = {
  sub: 'admin-audit-1',
  displayName: '培训管理员',
  roles: [AppRole.ADMIN],
};

const member: AuthUser = {
  sub: 'member-audit-1',
  displayName: '普通会员',
  roles: [AppRole.MEMBER],
};

const runner = (tx: Record<string, unknown>) =>
  vi.fn(async (work: (value: Record<string, unknown>) => unknown) => work(tx));

describe('TrainingService configuration audit', () => {
  it('creates a product and its complete audit in one transaction, then replays the exact command once', async () => {
    const dto: CreateTrainingProductDto = {
      code: 'AUDIT-PRODUCT-1',
      name: '审计课包',
      audience: TrainingAudience.ADULT,
      totalSessions: 10,
      validityDays: 120,
      priceCents: 98_000,
      refundRule: { beforeStart: 'FULL' },
      reason: '新增秋季培训产品',
      creationIdempotencyKey: 'training-product-create-1',
    };
    const product = {
      id: 'product-audit-1',
      code: dto.code,
      name: dto.name,
      audience: dto.audience,
      totalSessions: dto.totalSessions,
      validityDays: dto.validityDays,
      priceCents: dto.priceCents,
      unitRevenueCents: 9_800,
      refundRule: dto.refundRule,
      enabled: true,
    };
    let storedAudit: Record<string, unknown> | null = null;
    const auditFind = vi.fn().mockImplementation(() => storedAudit);
    const auditCreate = vi.fn().mockImplementation(({ data }) => {
      storedAudit = data;
      return Promise.resolve(data);
    });
    const productCreate = vi.fn().mockResolvedValue(product);
    const tx = {
      trainingProduct: {
        create: productCreate,
        findUniqueOrThrow: vi.fn().mockResolvedValue(product),
      },
      auditLog: { findFirst: auditFind, create: auditCreate },
    };
    const transaction = runner(tx);
    const prisma = {
      auditLog: { findFirst: auditFind },
      trainingProduct: { findUnique: vi.fn().mockResolvedValue(product) },
      $transaction: transaction,
    };
    const service = new TrainingService(prisma as never);

    await expect(service.createProduct(dto, admin)).resolves.toBe(product);
    await expect(service.createProduct(dto, admin)).resolves.toBe(product);

    expect(transaction).toHaveBeenCalledOnce();
    expect(productCreate).toHaveBeenCalledOnce();
    expect(auditCreate).toHaveBeenCalledOnce();
    expect(auditCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorId: admin.sub,
        actorRole: AppRole.ADMIN,
        action: 'TRAINING_PRODUCT_CREATED',
        objectType: 'TrainingProduct',
        objectId: product.id,
        oldValue: { exists: false },
        reason: dto.reason,
        requestId: dto.creationIdempotencyKey,
        newValue: expect.objectContaining({
          commandHash: expect.stringMatching(/^[0-9a-f]{64}$/),
          unitRevenueCents: 9_800,
          enabled: true,
        }),
      }),
    });

    await expect(
      service.createProduct({ ...dto, name: '被篡改的重放命令' }, admin),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(transaction).toHaveBeenCalledOnce();
    expect(auditCreate).toHaveBeenCalledOnce();
  });

  it('writes a full class snapshot with actor and reason inside the business transaction', async () => {
    const dto: CreateTrainingClassDto = {
      code: 'AUDIT-CLASS-1',
      productId: 'product-audit-1',
      name: '周末进阶班',
      coachId: 'coach-1',
      schedule: { weekday: 6, startsAt: '10:00' },
      capacity: 12,
      coachCostCents: 20_000,
      assistantCostCents: 3_000,
      materialCostCents: 1_000,
      reason: '新学期排班',
      creationIdempotencyKey: 'training-class-create-1',
    };
    const trainingClass = {
      id: 'class-audit-1',
      ...dto,
      reason: undefined,
      creationIdempotencyKey: undefined,
      assistantId: null,
      active: true,
    };
    const auditCreate = vi.fn().mockResolvedValue({});
    const tx = {
      trainingClass: {
        create: vi.fn().mockResolvedValue(trainingClass),
        findUniqueOrThrow: vi.fn(),
      },
      auditLog: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: auditCreate,
      },
    };
    const prisma = {
      auditLog: { findFirst: vi.fn().mockResolvedValue(null) },
      $transaction: runner(tx),
    };

    await expect(
      new TrainingService(prisma as never).createClass(dto, admin),
    ).resolves.toBe(trainingClass);
    expect(tx.trainingClass.create).toHaveBeenCalledOnce();
    expect(auditCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorId: admin.sub,
        action: 'TRAINING_CLASS_CREATED',
        objectType: 'TrainingClass',
        objectId: trainingClass.id,
        oldValue: { exists: false },
        reason: dto.reason,
        requestId: dto.creationIdempotencyKey,
        newValue: expect.objectContaining({
          commandHash: expect.stringMatching(/^[0-9a-f]{64}$/),
          coachCostCents: 20_000,
          active: true,
        }),
      }),
    });
  });

  it('enforces configuration roles even when the controller guard is bypassed', async () => {
    const service = new TrainingService({ $transaction: vi.fn() } as never);
    await expect(
      service.createProduct(
        {
          code: 'NO-PERMISSION',
          name: '无权限产品',
          audience: TrainingAudience.ADULT,
          totalSessions: 1,
          validityDays: 1,
          priceCents: 1,
          refundRule: {},
        },
        member,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('TrainingService session audit', () => {
  it('creates the session, court occupancy and one audit atomically, then rejects a changed replay', async () => {
    const dto: CreateTrainingSessionDto = {
      classId: 'class-audit-1',
      startsAt: '2099-09-01T02:00:00.000Z',
      endsAt: '2099-09-01T03:00:00.000Z',
      courtIds: ['court-2', 'court-1'],
      note: '双场教学',
      reason: '发布第一周课表',
      creationIdempotencyKey: 'training-session-create-1',
    };
    const trainingClass = {
      id: dto.classId,
      active: true,
      coachId: 'coach-1',
      assistantId: null,
      coachCostCents: 20_000,
      assistantCostCents: 3_000,
      materialCostCents: 1_000,
      enrollments: [{ id: 'enrollment-1' }],
    };
    const session = {
      id: 'session-audit-1',
      classId: dto.classId,
      startsAt: new Date(dto.startsAt),
      endsAt: new Date(dto.endsAt),
      status: TrainingSessionStatus.SCHEDULED,
      courtCount: 2,
      occupiedCourtHours: 2,
      coachCostCents: trainingClass.coachCostCents,
      assistantCostCents: trainingClass.assistantCostCents,
      materialCostCents: trainingClass.materialCostCents,
      note: dto.note,
      attendances: [{ id: 'attendance-1' }],
    };
    let storedAudit: Record<string, unknown> | null = null;
    const auditFind = vi.fn().mockImplementation(() => storedAudit);
    const auditCreate = vi.fn().mockImplementation(({ data }) => {
      storedAudit = data;
      return Promise.resolve(data);
    });
    const sessionCreate = vi.fn().mockResolvedValue(session);
    const tx = {
      trainingClass: { findUnique: vi.fn().mockResolvedValue(trainingClass) },
      trainingSession: {
        create: sessionCreate,
        findUniqueOrThrow: vi.fn().mockResolvedValue(session),
      },
      courtClosure: { findFirst: vi.fn().mockResolvedValue(null) },
      courtBooking: {
        findFirst: vi.fn().mockResolvedValue(null),
        createMany: vi.fn().mockResolvedValue({ count: 2 }),
      },
      auditLog: { findFirst: auditFind, create: auditCreate },
    };
    const transaction = runner(tx);
    const prisma = {
      auditLog: { findFirst: auditFind },
      trainingSession: { findUnique: vi.fn().mockResolvedValue(session) },
      $transaction: transaction,
    };
    const service = new TrainingService(prisma as never);

    await expect(service.createSession(dto, admin)).resolves.toBe(session);
    await expect(service.createSession(dto, admin)).resolves.toBe(session);

    expect(transaction).toHaveBeenCalledOnce();
    expect(sessionCreate).toHaveBeenCalledOnce();
    expect(tx.courtClosure.findFirst).toHaveBeenCalledWith({
      where: {
        courtId: { in: ['court-1', 'court-2'] },
        status: 'ACTIVE',
        startsAt: { lt: new Date(dto.endsAt) },
        endsAt: { gt: new Date(dto.startsAt) },
      },
      select: { id: true, courtId: true, reason: true },
    });
    expect(tx.courtBooking.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({ courtId: 'court-1' }),
        expect.objectContaining({ courtId: 'court-2' }),
      ],
    });
    expect(auditCreate).toHaveBeenCalledOnce();
    expect(auditCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorId: admin.sub,
        action: 'TRAINING_SESSION_CREATED',
        objectType: 'TrainingSession',
        objectId: session.id,
        oldValue: { exists: false },
        reason: dto.reason,
        requestId: dto.creationIdempotencyKey,
        newValue: expect.objectContaining({
          commandHash: expect.stringMatching(/^[0-9a-f]{64}$/),
          courtIds: ['court-1', 'court-2'],
          status: TrainingSessionStatus.SCHEDULED,
          venueFeeCents: 0,
        }),
      }),
    });

    await expect(
      service.createSession({ ...dto, courtIds: ['court-3'] }, admin),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(transaction).toHaveBeenCalledOnce();
  });

  it('rejects a new training session when any selected court overlaps an active closure', async () => {
    const dto: CreateTrainingSessionDto = {
      classId: 'class-closure-1',
      startsAt: '2099-09-02T02:00:00.000Z',
      endsAt: '2099-09-02T03:00:00.000Z',
      courtIds: ['court-1'],
      reason: '排定封场期间课次',
      creationIdempotencyKey: 'training-session-closure-1',
    };
    const sessionCreate = vi.fn();
    const tx = {
      trainingClass: {
        findUnique: vi.fn().mockResolvedValue({
          id: dto.classId,
          active: true,
          coachId: 'coach-1',
          assistantId: null,
          coachCostCents: 0,
          assistantCostCents: 0,
          materialCostCents: 0,
          enrollments: [],
        }),
      },
      trainingSession: { create: sessionCreate },
      courtClosure: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'closure-1',
          courtId: 'court-1',
          reason: '场地维护',
        }),
      },
      courtBooking: { findFirst: vi.fn(), createMany: vi.fn() },
      auditLog: { findFirst: vi.fn().mockResolvedValue(null), create: vi.fn() },
    };
    const service = new TrainingService({
      auditLog: { findFirst: vi.fn().mockResolvedValue(null) },
      $transaction: runner(tx),
    } as never);

    await expect(service.createSession(dto, admin)).rejects.toThrow(
      '所选场地已封场：场地维护',
    );
    expect(tx.courtBooking.findFirst).not.toHaveBeenCalled();
    expect(sessionCreate).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });

  it('audits a session completion with old/new state and replays the exact status command without another audit', async () => {
    const session = {
      id: 'session-audit-1',
      status: TrainingSessionStatus.SCHEDULED,
      class: { coachId: 'coach-1', assistantId: null },
    };
    let storedAudit: Record<string, unknown> | null = null;
    const auditFind = vi.fn().mockImplementation(() => storedAudit);
    const auditCreate = vi.fn().mockImplementation(({ data }) => {
      storedAudit = data;
      return Promise.resolve(data);
    });
    const update = vi.fn().mockImplementation(() => {
      session.status = TrainingSessionStatus.COMPLETED;
      return Promise.resolve({ ...session });
    });
    const tx = {
      trainingSession: {
        findUnique: vi.fn().mockImplementation(() => ({ ...session })),
        update,
      },
      trainingAttendance: { count: vi.fn().mockResolvedValue(0) },
      auditLog: { findFirst: auditFind, create: auditCreate },
    };
    const transaction = runner(tx);
    const service = new TrainingService({ $transaction: transaction } as never);
    const command = {
      reason: '核对全部签到结果后结课',
      idempotencyKey: 'training-session-complete-1',
    };

    await expect(
      service.completeSession(session.id, admin, command),
    ).resolves.toMatchObject({ status: TrainingSessionStatus.COMPLETED });
    await expect(
      service.completeSession(session.id, admin, command),
    ).resolves.toMatchObject({ status: TrainingSessionStatus.COMPLETED });

    expect(update).toHaveBeenCalledOnce();
    expect(auditCreate).toHaveBeenCalledOnce();
    expect(auditCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorId: admin.sub,
        action: 'TRAINING_SESSION_COMPLETED',
        objectType: 'TrainingSession',
        objectId: session.id,
        oldValue: { status: TrainingSessionStatus.SCHEDULED },
        newValue: expect.objectContaining({
          commandHash: expect.stringMatching(/^[0-9a-f]{64}$/),
          status: TrainingSessionStatus.COMPLETED,
        }),
        reason: command.reason,
        requestId: command.idempotencyKey,
      }),
    });

    await expect(
      service.completeSession(session.id, admin, {
        ...command,
        reason: '不同的重放原因',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(update).toHaveBeenCalledOnce();
    expect(auditCreate).toHaveBeenCalledOnce();
  });
});
