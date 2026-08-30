import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import type { AuthUser } from '../common/auth/auth-user.js';
import { ROLES_KEY } from '../common/auth/auth.decorators.js';
import { AppRole, SettlementStatus } from '../generated/prisma/enums.js';
import { TrainingService } from './training.service.js';
import { TrainingController } from './training.controller.js';

const finance: AuthUser = {
  sub: 'finance-1',
  displayName: '制单财务',
  roles: [AppRole.FINANCE],
};
const admin: AuthUser = {
  sub: 'admin-1',
  displayName: '复核管理员',
  roles: [AppRole.ADMIN],
};

const settlement = (status = SettlementStatus.DRAFT) => ({
  id: 'training-settlement-1',
  periodStart: new Date('2026-08-01T16:00:00.000Z'),
  periodEnd: new Date('2026-08-02T16:00:00.000Z'),
  effectiveRevenueCents: 100_000,
  contractRateBps: 2_000,
  venueContributionCents: 20_000,
  venueFeeCents: 0,
  trainingPayableVenueCents: 0,
  coachCostCents: 20_000,
  assistantCostCents: 5_000,
  materialCostCents: 2_000,
  acquisitionCostCents: 0,
  marketingCostCents: 0,
  occupiedCourtHours: 4,
  cashContributionMarginCents: 73_000,
  status,
  confirmedById: null as string | null,
  confirmedAt: null as Date | null,
  createdAt: new Date('2026-08-03T00:00:00.000Z'),
  updatedAt: new Date('2026-08-03T00:00:00.000Z'),
});

function workflowPrisma(initialStatus = SettlementStatus.DRAFT) {
  const current = settlement(initialStatus);
  const audits: Array<Record<string, any>> = [
    {
      id: 'audit-created',
      actorId: finance.sub,
      action: 'TRAINING_SETTLEMENT_CREATED',
      objectType: 'TrainingSettlement',
      objectId: current.id,
      requestId: null,
      createdAt: new Date('2026-08-03T00:00:00.000Z'),
    },
  ];
  const tx = {
    trainingSettlement: {
      findUnique: vi
        .fn()
        .mockImplementation(() => Promise.resolve({ ...current })),
      updateMany: vi.fn().mockImplementation(({ where, data }) => {
        if (where.status !== current.status)
          return Promise.resolve({ count: 0 });
        Object.assign(current, data, { updatedAt: new Date() });
        return Promise.resolve({ count: 1 });
      }),
      findUniqueOrThrow: vi
        .fn()
        .mockImplementation(() => Promise.resolve({ ...current })),
    },
    reconciliationPeriod: { findFirst: vi.fn().mockResolvedValue(null) },
    auditLog: {
      findFirst: vi
        .fn()
        .mockImplementation(({ where }) =>
          Promise.resolve(
            audits.find(
              (audit) =>
                audit.objectType === where.objectType &&
                audit.objectId === where.objectId &&
                (!where.action || audit.action === where.action) &&
                (!where.requestId || audit.requestId === where.requestId),
            ) ?? null,
          ),
        ),
      create: vi.fn().mockImplementation(({ data }) => {
        const audit = {
          id: `audit-${audits.length + 1}`,
          createdAt: new Date(),
          ...data,
        };
        audits.push(audit);
        return Promise.resolve(audit);
      }),
    },
  };
  return {
    current,
    audits,
    tx,
    prisma: {
      $transaction: vi.fn(async (work: (client: typeof tx) => unknown) =>
        work(tx),
      ),
    },
  };
}

describe('TrainingService settlement state machine', () => {
  it('runs draft → pending → confirmed → settled with maker/checker and retry idempotency', async () => {
    const { prisma, tx, current, audits } = workflowPrisma();
    const service = new TrainingService(prisma as never);

    await expect(
      service.submitSettlement(
        current.id,
        { reason: '数据已核对', idempotencyKey: 'training-submit-1' },
        finance,
      ),
    ).resolves.toMatchObject({ status: SettlementStatus.PENDING_CONFIRMATION });
    await expect(
      service.confirmSettlement(
        current.id,
        { reason: '复核消课明细', idempotencyKey: 'training-confirm-1' },
        admin,
      ),
    ).resolves.toMatchObject({
      status: SettlementStatus.CONFIRMED,
      confirmedById: admin.sub,
    });
    await expect(
      service.settleSettlement(
        current.id,
        { reason: '付款凭证一致', idempotencyKey: 'training-settle-1' },
        admin,
      ),
    ).resolves.toMatchObject({ status: SettlementStatus.SETTLED });
    await expect(
      service.settleSettlement(
        current.id,
        {
          reason: '同一幂等键却更换付款结论',
          idempotencyKey: 'training-settle-1',
        },
        admin,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      service.settleSettlement(
        current.id,
        { reason: '付款凭证一致', idempotencyKey: 'training-settle-1' },
        admin,
      ),
    ).resolves.toMatchObject({ status: SettlementStatus.SETTLED });

    expect(tx.trainingSettlement.updateMany).toHaveBeenCalledTimes(3);
    expect(tx.auditLog.create).toHaveBeenCalledTimes(3);
    expect(audits.map((audit) => audit.action)).toEqual([
      'TRAINING_SETTLEMENT_CREATED',
      'TRAINING_SETTLEMENT_SUBMITTED',
      'TRAINING_SETTLEMENT_CONFIRMED',
      'TRAINING_SETTLEMENT_SETTLED',
    ]);
  });

  it('prevents the creator from confirming, settling, or returning the statement', async () => {
    const { prisma, tx, current } = workflowPrisma(
      SettlementStatus.PENDING_CONFIRMATION,
    );
    const service = new TrainingService(prisma as never);

    await expect(
      service.confirmSettlement(current.id, {}, finance),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      service.returnSettlement(current.id, { reason: '金额有误' }, finance),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(tx.trainingSettlement.updateMany).not.toHaveBeenCalled();
  });

  it('requires a reason for return/void and records a pending statement return', async () => {
    const { prisma, current, audits } = workflowPrisma(
      SettlementStatus.PENDING_CONFIRMATION,
    );
    const service = new TrainingService(prisma as never);

    await expect(
      service.returnSettlement(current.id, {}, admin),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.returnSettlement(
        current.id,
        { reason: '成本凭证缺失', idempotencyKey: 'training-return-1' },
        admin,
      ),
    ).resolves.toMatchObject({ status: SettlementStatus.DRAFT });
    expect(audits.at(-1)).toMatchObject({
      action: 'TRAINING_SETTLEMENT_RETURNED',
      reason: '成本凭证缺失',
      oldValue: { status: SettlementStatus.PENDING_CONFIRMATION },
      newValue: { status: SettlementStatus.DRAFT },
    });
  });

  it('allows periodic settlement after its source business days are locked', async () => {
    const { prisma, tx, current } = workflowPrisma();
    tx.reconciliationPeriod.findFirst.mockResolvedValue({
      businessDate: new Date('2026-08-01T16:00:00.000Z'),
      status: 'LOCKED',
    });
    const service = new TrainingService(prisma as never);

    await expect(
      service.submitSettlement(current.id, {}, finance),
    ).resolves.toMatchObject({ status: SettlementStatus.PENDING_CONFIRMATION });
    expect(tx.trainingSettlement.updateMany).toHaveBeenCalledOnce();
    expect(tx.auditLog.create).toHaveBeenCalledOnce();
    expect(tx.reconciliationPeriod.findFirst).not.toHaveBeenCalled();
  });

  it('denies service-level access to non-finance roles', async () => {
    const service = new TrainingService({} as never);
    await expect(
      service.listSettlements(
        {},
        { sub: 'coach-1', displayName: '教练', roles: [AppRole.COACH] },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('TrainingService settlement list', () => {
  it('filters by period/status and attaches immutable audit history and creator', async () => {
    const row = settlement(SettlementStatus.CONFIRMED);
    const prisma = {
      trainingSettlement: { findMany: vi.fn().mockResolvedValue([row]) },
      auditLog: {
        findMany: vi.fn().mockResolvedValue([
          {
            actorId: finance.sub,
            actor: { id: finance.sub, displayName: finance.displayName },
            action: 'TRAINING_SETTLEMENT_CREATED',
            objectId: row.id,
            oldValue: null,
            newValue: { status: SettlementStatus.DRAFT },
            reason: null,
            createdAt: row.createdAt,
          },
          {
            actorId: admin.sub,
            actor: { id: admin.sub, displayName: admin.displayName },
            action: 'TRAINING_SETTLEMENT_CONFIRMED',
            objectId: row.id,
            oldValue: { status: SettlementStatus.PENDING_CONFIRMATION },
            newValue: { status: SettlementStatus.CONFIRMED },
            reason: '复核通过',
            createdAt: new Date('2026-08-03T01:00:00.000Z'),
          },
        ]),
      },
    };
    const service = new TrainingService(prisma as never);

    const result = await service.listSettlements(
      {
        periodStart: '2026-08-01T00:00:00.000Z',
        periodEnd: '2026-08-31T23:59:59.999Z',
        status: SettlementStatus.CONFIRMED,
      },
      admin,
    );

    expect(prisma.trainingSettlement.findMany).toHaveBeenCalledWith({
      where: {
        status: SettlementStatus.CONFIRMED,
        periodStart: { gte: new Date('2026-08-01T00:00:00.000Z') },
        periodEnd: { lte: new Date('2026-08-31T23:59:59.999Z') },
      },
      orderBy: [{ periodEnd: 'desc' }, { createdAt: 'desc' }],
    });
    expect(result[0]).toMatchObject({
      id: row.id,
      createdById: finance.sub,
      createdBy: { displayName: finance.displayName },
      workflowHistory: [
        expect.objectContaining({ action: 'TRAINING_SETTLEMENT_CREATED' }),
        expect.objectContaining({
          action: 'TRAINING_SETTLEMENT_CONFIRMED',
          reason: '复核通过',
        }),
      ],
    });
  });
});

describe('TrainingController settlement contract', () => {
  it('delegates list and lifecycle commands behind finance/admin roles', async () => {
    const training = {
      listSettlements: vi.fn().mockResolvedValue([]),
      submitSettlement: vi
        .fn()
        .mockResolvedValue({ status: 'PENDING_CONFIRMATION' }),
      confirmSettlement: vi.fn().mockResolvedValue({ status: 'CONFIRMED' }),
      settleSettlement: vi.fn().mockResolvedValue({ status: 'SETTLED' }),
      returnSettlement: vi.fn().mockResolvedValue({ status: 'DRAFT' }),
      voidSettlement: vi.fn().mockResolvedValue({ status: 'VOID' }),
    };
    const controller = new TrainingController(training as never);
    const command = {
      reason: '核对凭证',
      idempotencyKey: 'settlement-command-1',
    };

    await controller.settlements({ status: SettlementStatus.DRAFT }, finance);
    await controller.submitSettlement('settlement-1', command, finance);
    await controller.confirmSettlement('settlement-1', command, admin);
    await controller.settleSettlement('settlement-1', command, admin);
    await controller.returnSettlement('settlement-1', command, admin);
    await controller.voidSettlement('settlement-1', command, finance);

    expect(training.listSettlements).toHaveBeenCalledWith(
      { status: SettlementStatus.DRAFT },
      finance,
    );
    expect(training.confirmSettlement).toHaveBeenCalledWith(
      'settlement-1',
      command,
      admin,
    );
    expect(
      Reflect.getMetadata(
        ROLES_KEY,
        TrainingController.prototype.confirmSettlement,
      ),
    ).toEqual([AppRole.FINANCE, AppRole.ADMIN, AppRole.SUPER_ADMIN]);
  });
});
