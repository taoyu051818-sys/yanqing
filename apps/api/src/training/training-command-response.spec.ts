import { describe, expect, it } from 'vitest';

import {
  trainingAttendanceCommandResponse,
  trainingConsumeConfirmationResponse,
  trainingConsumeProposalResponse,
  trainingMakeupCommandResponse,
  trainingSessionCommandResponse,
} from './training-command-response.js';

const sensitiveFields = [
  'coachCostCents',
  'assistantCostCents',
  'materialCostCents',
  'coachCostAllocatedCents',
  'assistantCostAllocatedCents',
  'materialCostAllocatedCents',
  'operatorId',
  'idempotencyKey',
  'contractRateBps',
  'trainingPayableVenueCents',
  'class',
  'enrollment',
  'revenueRecognitions',
];

const expectNoPersistenceFields = (value: Record<string, unknown>) => {
  for (const field of sensitiveFields) expect(value).not.toHaveProperty(field);
};

describe('training command response projections', () => {
  it('returns the same minimal session response for a write and its relation-rich replay', () => {
    const persisted = {
      id: 'session-1',
      status: 'SCHEDULED',
      classId: 'class-1',
      coachCostCents: 20_000,
      assistantCostCents: 3_000,
      materialCostCents: 1_000,
      class: { id: 'class-1', coachId: 'coach-1' },
      attendances: [{ id: 'attendance-1', operatorId: 'coach-1' }],
    };
    const replay = {
      ...persisted,
      class: { ...persisted.class, commandHash: 'secret-command-hash' },
    };

    const first = trainingSessionCommandResponse(persisted);
    const repeated = trainingSessionCommandResponse(replay);

    expect(first).toEqual({ id: 'session-1', status: 'SCHEDULED' });
    expect(repeated).toEqual(first);
    expectNoPersistenceFields(first);
  });

  it('projects attendance, proposal and makeup results without operator or relations', () => {
    const attendance = {
      id: 'attendance-1',
      sessionId: 'session-1',
      enrollmentId: 'enrollment-1',
      status: 'ATTENDED',
      operatorId: 'coach-1',
      coachCostAllocatedCents: 2_000,
      session: { coachCostCents: 20_000 },
      enrollment: { product: { refundRule: { secret: true } } },
      revenueRecognitions: [{ idempotencyKey: 'secret-recognition-key' }],
    };

    expect(trainingAttendanceCommandResponse(attendance)).toEqual({
      id: 'attendance-1',
      sessionId: 'session-1',
      enrollmentId: 'enrollment-1',
      status: 'ATTENDED',
    });
    expect(trainingConsumeProposalResponse(attendance)).toEqual({
      id: 'attendance-1',
      sessionId: 'session-1',
      enrollmentId: 'enrollment-1',
      status: 'ATTENDED',
      workflowStatus: 'PENDING_CONFIRMATION',
    });
    expect(trainingMakeupCommandResponse(attendance, 'session-2')).toEqual({
      id: 'attendance-1',
      sessionId: 'session-1',
      enrollmentId: 'enrollment-1',
      status: 'ATTENDED',
      workflowStatus: 'MAKEUP_SCHEDULED',
      makeupSessionId: 'session-2',
    });
    expectNoPersistenceFields(trainingConsumeProposalResponse(attendance));
  });

  it('keeps only client-needed recognition economics on normal and replay responses', () => {
    const recognition = {
      id: 'recognition-1',
      attendanceId: 'attendance-1',
      enrollmentId: 'enrollment-1',
      type: 'CONSUME',
      sequence: 1,
      effectiveRevenueCents: 19_800,
      contractRateBps: 2_000,
      venueContributionCents: 3_960,
      venueFeeCents: 0,
      trainingPayableVenueCents: 0,
      idempotencyKey: 'secret-consume-key',
      reversedBy: null,
    };

    const first = trainingConsumeConfirmationResponse(recognition);
    const replay = trainingConsumeConfirmationResponse({
      ...recognition,
      reversedBy: { id: 'internal-reversal' },
    });

    expect(first).toEqual({
      id: 'recognition-1',
      type: 'CONSUME',
      sequence: 1,
      workflowStatus: 'CONFIRMED',
      effectiveRevenueCents: 19_800,
      venueContributionCents: 3_960,
      venueFeeCents: 0,
    });
    expect(replay).toEqual(first);
    expectNoPersistenceFields(first);
    expect(first).not.toHaveProperty('attendanceId');
    expect(first).not.toHaveProperty('enrollmentId');
  });
});
